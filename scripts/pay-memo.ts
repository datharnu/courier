import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { BinaryWriter } from "cosmjs-types/binary";
import { msg, qorechainRegistry, type EncodeObject } from "@qorechain/sdk";
import { classicalKeyFromPrivate } from "@qorechain/qoresign";
import { TESTNET } from "haven-pq-kit/network";
import { encodeFunctionData, hexToBytes, keccak256, toBytes, type Address, type Hex } from "viem";

import { bundleHash, type Bundle, type BundleSecrets } from "../src/ts/bundle.js";
import { testnetReader, toEvm } from "../src/ts/chain.js";
import { CourierClient, type Identity } from "../src/ts/client.js";
import { FUSD, STEWARD_GATE, ciphertextHash, signInvoice } from "../src/ts/invoice.js";
import { createRelay } from "../src/ts/relay.js";
import { broadcast, evmClient, loadAccount, loadSealKeys, sendScopedContractTx, withEvmWindow } from "./lib/chain.js";
import { prekeyPath, writePrivate } from "./lib/secrets.js";
import { serve } from "./lib/serve.js";

const PAYER = "spike";
const VENDOR = "steward-vendor";
const PORT = 8789;
const REPORT = "deployments/memo-payment.json";
/** 0.010000 fUSD, the size of Steward's recorded demo invoice. */
const WANTED = 10_000n;
/** Buy a little over that from pool 2 if the payer holds none. Hard stop, so a bad quote cannot spend more. */
const BUY = 12_000n;
const MAX_SPEND_UQOR = 400_000n;
const FUSD_DENOM = `erc20:${FUSD}`;
const CONVERT = "/cosmos.evm.erc20.v1.MsgConvertCoin";
const PAY_CAP_UQOR = "2000000";

const ERC20 = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

const MEMO_ABI = [
  {
    type: "function",
    name: "pay",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "payee", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "ciphertextHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "payment",
    stateMutability: "view",
    inputs: [
      { name: "payer", type: "address" },
      { name: "ciphertextHash", type: "bytes32" },
    ],
    outputs: [
      { name: "payee", type: "address" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "at", type: "uint256" },
    ],
  },
] as const;

type StoredPrekeys = {
  owner: string;
  bundleHash: string;
  expiry: number;
  signedPrekey: string;
  lastResortKem: string;
  oneTime: { kem: string; x25519: string }[];
  used: number[];
};

async function identity(name: string): Promise<Identity> {
  const account = await loadAccount(name);
  return {
    cosmos: account.cosmos,
    evm: toEvm(account.evm),
    mldsaSecret: account.pqc.secretKey,
    classicalKey: classicalKeyFromPrivate(hexToBytes(account.privateKey as Hex), "eth_secp256k1"),
    seal: loadSealKeys(name),
  };
}

function loadPrekeys(name: string): { stored: StoredPrekeys; secrets: BundleSecrets; used: Set<number> } {
  const stored = JSON.parse(readFileSync(prekeyPath(name), "utf8")) as StoredPrekeys;
  const bytes = (hex: string) => (hex ? hexToBytes(hex as Hex) : new Uint8Array());
  return {
    stored,
    secrets: {
      signedPrekey: bytes(stored.signedPrekey),
      lastResortKem: bytes(stored.lastResortKem),
      oneTime: stored.oneTime.map((entry) => ({ kem: bytes(entry.kem), x25519: bytes(entry.x25519) })),
    },
    used: new Set(stored.used),
  };
}

const ConvertCoin = {
  typeUrl: CONVERT,
  fromPartial(value: { coin?: { denom?: string; amount?: string }; receiver?: string; sender?: string }) {
    return {
      coin: { denom: value.coin?.denom ?? "", amount: value.coin?.amount ?? "0" },
      receiver: value.receiver ?? "",
      sender: value.sender ?? "",
    };
  },
  encode(
    message: { coin: { denom: string; amount: string }; receiver: string; sender: string },
    writer = new BinaryWriter(),
  ) {
    const coin = new BinaryWriter();
    coin.uint32(10).string(message.coin.denom);
    coin.uint32(18).string(message.coin.amount);
    writer.uint32(10).bytes(coin.finish());
    writer.uint32(18).string(message.receiver);
    writer.uint32(26).string(message.sender);
    return writer;
  },
  decode() {
    throw new Error("decode is unused");
  },
};

function quote(reserveIn: bigint, reserveOut: bigint, amountIn: bigint, feeBps: bigint): bigint {
  const net = (amountIn * (10_000n - feeBps)) / 10_000n;
  return (reserveOut * net) / (reserveIn + net);
}

/** uqor in for about `wantOut` fUSD base units, constant-product with the pool fee. */
function spendFor(reserveIn: bigint, reserveOut: bigint, wantOut: bigint, feeBps: bigint): bigint {
  if (wantOut >= reserveOut) throw new Error("the pool cannot fill this buy");
  const net = (wantOut * reserveIn) / (reserveOut - wantOut) + 1n;
  return (net * 10_000n) / (10_000n - feeBps) + 1n;
}

async function fusdBalance(evm: Address): Promise<bigint> {
  return evmClient().readContract({ address: FUSD, abi: ERC20, functionName: "balanceOf", args: [evm] });
}

/**
 * Spike was funded in QOR, so it holds no fUSD until it buys some. Pool 2 is uqor to fUSD.
 * The bank coin is then converted to the ERC-20 the contract can pull. Capped at 400,000 uqor.
 */
async function ensureFusd(evm: Address): Promise<{ balance: bigint; swapHash?: string; convertHash?: string }> {
  const have = await fusdBalance(evm);
  if (have >= WANTED) return { balance: have };

  const headers = { "user-agent": "haven" };
  const [poolsBody, paramsBody] = await Promise.all([
    fetch(`${TESTNET.rest}/qorechain/amm/v1/pools`, { headers }).then((res) => res.json()) as Promise<{
      pools: { id: string; token_a: string; token_b: string; reserve_a: string; reserve_b: string; status: string }[];
    }>,
    fetch(`${TESTNET.rest}/qorechain/amm/v1/params`, { headers }).then((res) => res.json()) as Promise<{
      params?: { swap_fee_bps?: string | number };
    }>,
  ]);
  const pool = poolsBody.pools.find((item) => item.id === "2" && item.status === "active");
  if (!pool || pool.token_a !== FUSD_DENOM || pool.token_b !== "uqor") throw new Error("pool 2 is not uqor/fUSD");
  const feeBps = BigInt(paramsBody.params?.swap_fee_bps ?? "0");
  const spend = spendFor(BigInt(pool.reserve_b), BigInt(pool.reserve_a), BUY, feeBps);
  if (spend > MAX_SPEND_UQOR) throw new Error(`buying ${BUY} fUSD wants ${spend} uqor, above the cap of ${MAX_SPEND_UQOR}`);
  const minOut = (quote(BigInt(pool.reserve_b), BigInt(pool.reserve_a), spend, feeBps) * 90n) / 100n;
  if (minOut < WANTED) throw new Error("the quote is below the invoice");

  const account = await loadAccount(PAYER);
  const swapHash = await broadcast(account, [
    msg.amm.swapExactIn({
      sender: account.cosmos,
      poolId: "2",
      tokenIn: { denom: "uqor", amount: spend.toString() },
      denomOut: FUSD_DENOM,
      minOut: minOut.toString(),
    }),
  ]);
  const after = (await fetch(
    `${TESTNET.rest}/cosmos/bank/v1beta1/balances/${account.cosmos}/by_denom?denom=${encodeURIComponent(FUSD_DENOM)}`,
    { headers },
  ).then((res) => res.json())) as { balance?: { amount?: string } };
  const bought = after.balance?.amount ?? "0";
  if (BigInt(bought) < WANTED) throw new Error(`the swap returned ${bought}, short of ${WANTED}`);
  const convertHash = await broadcast(
    account,
    [{ typeUrl: CONVERT, value: { coin: { denom: FUSD_DENOM, amount: bought }, receiver: evm, sender: account.cosmos } } satisfies EncodeObject],
    "hybrid",
    qorechainRegistry([[CONVERT, ConvertCoin]]),
  );
  let balance = 0n;
  for (let i = 0; i < 10 && balance < WANTED; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    balance = await fusdBalance(evm);
  }
  if (balance < WANTED) throw new Error(`converted fUSD did not arrive (balance ${balance})`);
  return { balance, swapHash, convertHash };
}

function savePrekeys(name: string, stored: StoredPrekeys, used: Set<number>): void {
  const next: StoredPrekeys = {
    ...stored,
    used: [...used].sort((a, b) => a - b),
    oneTime: stored.oneTime.map((entry, i) => (used.has(i) ? { kem: "", x25519: "" } : entry)),
  };
  writePrivate(prekeyPath(name), `${JSON.stringify(next, null, 2)}\n`);
}

async function main(): Promise<void> {
  if (existsSync(REPORT)) throw new Error(`${REPORT} already records a payment. It is left as it is.`);
  const deployed = JSON.parse(readFileSync("deployments/memo-pay.json", "utf8")) as { memoPay?: Address };
  if (!deployed.memoPay) throw new Error("MemoPay is not deployed. Run npm run deploy:memopay");
  const memoPay = deployed.memoPay;
  const { directory } = JSON.parse(readFileSync("deployments/prekey-directory.json", "utf8")) as { directory: string };

  const client = evmClient();
  const payer = await identity(PAYER);
  const vendor = await identity(VENDOR);
  const funded = await ensureFusd(payer.evm as Address);
  const amount = WANTED;
  if (funded.balance < amount) throw new Error(`${PAYER} holds ${funded.balance} fUSD, short of ${amount}. Nothing was sent.`);

  const chain = testnetReader({ client, directory });
  const { stored, secrets, used } = loadPrekeys(VENDOR);
  const bundle = JSON.parse(readFileSync(`deployments/bundles/${VENDOR}.json`, "utf8")) as Bundle;
  const onChain = await chain.directory(vendor.evm);
  if (bundleHash(bundle) !== onChain.hash || stored.bundleHash !== onChain.hash) {
    throw new Error("the local bundle is not the one on chain; run npm run deploy:directory");
  }
  if (!onChain.live) throw new Error("the bundle on chain has expired; run npm run deploy:directory");

  const domain = `127.0.0.1:${PORT}`;
  const server = await serve(createRelay({ chain, domain, uri: `http://${domain}` }), PORT);
  try {
    const spike = new CourierClient({ relay: `http://${domain}`, chain, identity: payer });
    const seller = new CourierClient({ relay: `http://${domain}`, chain, identity: vendor });
    seller.usePrekeys({ bundle, secrets, used });
    await spike.publishCard();
    await seller.publishCard();
    await seller.publishBundle();

    const opened = await spike.start(vendor.evm, { t: "text", body: "Ready for the invoice." });
    const hello = await seller.receive();
    savePrekeys(VENDOR, stored, used);
    if (!hello[0]?.ok) throw new Error(`the vendor refused the opening message: ${hello[0]?.ok === false ? hello[0].code : "missing"}`);

    const memo = `INV-0007. Pay the registered payout. ${new Date().toISOString()}`;
    const invoice = signInvoice(vendor.mldsaSecret, {
      gate: STEWARD_GATE,
      vendor: vendor.evm,
      payee: vendor.evm,
      token: FUSD,
      amount: amount.toString(),
      invoiceId: keccak256(toBytes(`courier.memo.${memo}`)),
      dueDate: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
      memo,
    });
    const posted = await seller.send(opened.conversationId, { t: "invoice", ...invoice });
    const got = await spike.receive();
    const item = got[0];
    if (!item?.ok || item.payload.t !== "invoice") {
      throw new Error(`the invoice was refused (${item && !item.ok ? item.code : "missing"}). Nothing was paid.`);
    }
    if (item.ciphertextHash !== posted.ciphertextHash || ciphertextHash(posted.ciphertext) !== posted.ciphertextHash) {
      throw new Error("the ciphertext hash does not match. Nothing was paid.");
    }

    const payData = encodeFunctionData({
      abi: MEMO_ABI,
      functionName: "pay",
      args: [FUSD, vendor.evm as Address, amount, posted.ciphertextHash],
    });
    if (payData.length !== 2 + (4 + 32 * 4) * 2) throw new Error("the payment calldata is not four words");

    const { result, openHash, closeHash } = await withEvmWindow(
      PAYER,
      { txs: 2, maxValueUqor: PAY_CAP_UQOR, targets: [FUSD, memoPay], blocks: 200 },
      async (account) => {
        const approveData = encodeFunctionData({ abi: ERC20, functionName: "approve", args: [memoPay, amount] });
        const approveHash = await sendScopedContractTx({ account, to: FUSD, data: approveData });
        const payHash = await sendScopedContractTx({ account, to: memoPay, data: payData });
        return { approveHash, payHash };
      },
    );

    const readBack = await client.readContract({
      address: memoPay,
      abi: MEMO_ABI,
      functionName: "payment",
      args: [payer.evm as Address, posted.ciphertextHash],
    });
    const [payee, token, paid, at] = readBack;
    if (payee.toLowerCase() !== vendor.evm || token.toLowerCase() !== FUSD.toLowerCase() || paid !== amount || at === 0n) {
      throw new Error("the chain read-back does not match the payment");
    }

    const report = {
      network: chain.chainId,
      ranAt: new Date().toISOString(),
      memoPay,
      token: FUSD,
      gate: STEWARD_GATE,
      payer: payer.evm,
      payee: vendor.evm,
      amount: amount.toString(),
      invoiceId: invoice.invoiceId,
      memoHash: invoice.memoHash,
      ciphertextHash: posted.ciphertextHash,
      ciphertext: posted.ciphertext,
      conversationId: opened.conversationId,
      calldata: payData,
      swapHash: funded.swapHash,
      convertHash: funded.convertHash,
      openHash,
      approveHash: result.approveHash,
      payHash: result.payHash,
      closeHash,
      readBack: { payee, token, amount: paid.toString(), at: at.toString() },
      note: "The memo text is not in the transaction. It is inside the ciphertext. The payer and the vendor can open it. Anyone else can check the hash and nothing more. Paying here does not mark the invoice used in PayGate.",
    };
    writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`paid ${amount} base units, hash ${posted.ciphertextHash}, tx ${result.payHash}`);
  } finally {
    server.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
