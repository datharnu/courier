import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pqSign } from "@qorechain/qoresign";
import { fetchKemKey } from "@qorechain/qoreseal/network";
import {
  bytesToHex,
  encodeAbiParameters,
  encodeDeployData,
  encodeFunctionData,
  hexToBytes,
  toFunctionSelector,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { TESTNET, qorechainDiana } from "haven-pq-kit/network";
import { broadcast, evmClient, loadAccount, loadSealKeys, sendScopedContractTx, withEvmWindow } from "./lib/chain.js";
import { prekeyPath, writePrivate } from "./lib/secrets.js";
import { bundleHash, createBundle } from "../src/ts/bundle.js";

const DEPLOYER = "spike";
const ACCOUNT_NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;
const OWNER = process.argv[2] ?? "steward-vendor";
if (!ACCOUNT_NAME.test(OWNER)) throw new Error("bad account name");
if (OWNER === "steward-agent") throw new Error("refusing steward-agent");
const FUND_UQOR = 1_000_000n;
const MIN_OWNER_UQOR = 600_000n;
const REPORT = "deployments/prekey-directory.json";
const BUNDLE_OUT = `deployments/bundles/${OWNER}.json`;
const SECRETS_OUT = prekeyPath(OWNER);
/** A few minutes under the contract's 7-day cap, so block time drift cannot push it over. */
const TTL = 7 * 24 * 60 * 60 - 600;
const SIGNATURE_INVALID = toFunctionSelector("SignatureInvalid()");
/** A window's value cap also pays gas. The deploy needed 43,097 uqor. */
const DEPLOY_CAP_UQOR = "5000000";
const PUBLISH_CAP_UQOR = "200000";

const ABI = [
  {
    type: "function",
    name: "publish",
    stateMutability: "nonpayable",
    inputs: [
      { name: "bundleHash", type: "bytes32" },
      { name: "expiry", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "current",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [
      { name: "hash", type: "bytes32" },
      { name: "expiry", type: "uint256" },
      { name: "live", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "signingMessage",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "bundleHash", type: "bytes32" },
      { name: "expiry", type: "uint256" },
    ],
    outputs: [{ type: "bytes" }],
  },
] as const;

type Report = {
  network: string;
  directory?: Address;
  deployer?: string;
  fundHash?: string;
  deploy?: { openHash: string; createHash: Hex; gasUsed: number; closeHash: string };
  publish?: {
    owner: string;
    ownerEvm: Address;
    bundleHash: Hex;
    expiry: number;
    openHash: string;
    publishHash: Hex;
    gasUsed: number;
    closeHash: string;
  };
  readBack?: { hash: Hex; expiry: number; live: boolean };
  refusedForgedSignature?: string;
};

function bank(address: string): Promise<bigint> {
  return fetch(`${TESTNET.rest}/cosmos/bank/v1beta1/balances/${address}`, { headers: { "user-agent": "haven" } })
    .then((res) => res.json() as Promise<{ balances: { denom: string; amount: string }[] }>)
    .then((body) => BigInt(body.balances.find((coin) => coin.denom === "uqor")?.amount ?? "0"));
}

function save(report: Report): void {
  writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
}

async function main(): Promise<void> {
  if (OWNER === "steward-vendor") {
    await publishVendor();
    return;
  }
  await publishMember();
}

async function publishMember(): Promise<void> {
  const directoryReport = JSON.parse(readFileSync(REPORT, "utf8")) as Report;
  if (!directoryReport.directory) throw new Error("deploy the directory first: npm run deploy:directory");
  const directory = directoryReport.directory;
  const ownPath = `deployments/prekeys-${OWNER}.json`;
  const now = Math.floor(Date.now() / 1000);
  if (existsSync(ownPath)) {
    const existing = JSON.parse(readFileSync(ownPath, "utf8")) as MemberReport;
    if (existing.readBack?.live && existing.readBack.expiry >= now) {
      console.log(JSON.stringify(existing, null, 2));
      return;
    }
  }

  const client = evmClient();
  const owner = await loadAccount(OWNER);
  const ownerEvm = owner.evm.toLowerCase() as Address;
  const sealKeys = loadSealKeys(OWNER);
  const registry = await fetchKemKey({ rest: TESTNET.rest, address: owner.cosmos });
  if (!registry.registered || !registry.publicKey) throw new Error(`${owner.cosmos} has no KEM key on chain`);
  const registryHex = bytesToHex(registry.publicKey);
  if (registryHex !== bytesToHex(sealKeys.mlkemPublicKey)) {
    throw new Error("the registry KEM key is not the key derived for this account");
  }

  const member: MemberReport = { network: TESTNET.chainId, directory, owner: owner.cosmos, ownerEvm };
  if ((await bank(owner.cosmos)) < MIN_OWNER_UQOR) {
    const deployer = await loadAccount(DEPLOYER);
    member.fundHash = await broadcast(
      deployer,
      [
        {
          typeUrl: "/cosmos.bank.v1beta1.MsgSend",
          value: {
            fromAddress: deployer.cosmos,
            toAddress: owner.cosmos,
            amount: [{ denom: "uqor", amount: FUND_UQOR.toString() }],
          },
        },
      ],
      "hybrid",
    );
    console.log(`funded ${owner.cosmos}: ${member.fundHash}`);
  }

  const { bundle, secrets } = createBundle(sealKeys.mlkemPublicKey, now + TTL);
  if (bundle.identityKem !== registryHex) throw new Error("bundle identity KEM is not the registry key");
  const hash = bundleHash(bundle) as Hex;
  const expiry = BigInt(bundle.expiry);
  const local = encodeAbiParameters(
    [{ type: "uint256" }, { type: "address" }, { type: "address" }, { type: "bytes32" }, { type: "uint256" }],
    [BigInt(qorechainDiana.id), directory, ownerEvm, hash, expiry],
  );
  const onChain = await client.readContract({
    address: directory,
    abi: ABI,
    functionName: "signingMessage",
    args: [ownerEvm, hash, expiry],
  });
  if (onChain.toLowerCase() !== local.toLowerCase()) throw new Error("signingMessage differs from the local encoding");

  writePrivate(
    SECRETS_OUT,
    `${JSON.stringify(
      {
        owner: owner.cosmos,
        bundleHash: hash,
        expiry: bundle.expiry,
        signedPrekey: bytesToHex(secrets.signedPrekey),
        lastResortKem: bytesToHex(secrets.lastResortKem),
        oneTime: secrets.oneTime.map((entry) => ({ kem: bytesToHex(entry.kem), x25519: bytesToHex(entry.x25519) })),
        used: [],
      },
      null,
      2,
    )}\n`,
  );
  mkdirSync("deployments/bundles", { recursive: true });
  writeFileSync(BUNDLE_OUT, `${JSON.stringify(bundle)}\n`);

  const signatureBytes = pqSign(owner.pqc.secretKey, hexToBytes(local));
  const forged = signatureBytes.slice();
  forged[100] ^= 0x01;
  const signature = bytesToHex(signatureBytes);
  const data = encodeFunctionData({ abi: ABI, functionName: "publish", args: [hash, expiry, signature] });
  const { result, openHash, closeHash } = await withEvmWindow(
    OWNER,
    { txs: 1, maxValueUqor: PUBLISH_CAP_UQOR, targets: [directory], blocks: 200 },
    async (account) => {
      let refused = "accepted";
      try {
        await client.call({
          account: ownerEvm,
          to: directory,
          data: encodeFunctionData({ abi: ABI, functionName: "publish", args: [hash, expiry, bytesToHex(forged)] }),
        });
      } catch (error) {
        const err = error as { cause?: { data?: Hex; cause?: { data?: Hex } } };
        refused = err.cause?.data ?? err.cause?.cause?.data ?? "no revert data";
      }
      if (refused !== SIGNATURE_INVALID) {
        throw new Error(`a forged signature was not refused with SignatureInvalid: ${refused}`);
      }
      member.refusedForgedSignature = `eth_call reverted with SignatureInvalid() ${SIGNATURE_INVALID}`;
      const publishHash = await sendScopedContractTx({ account, to: directory, data });
      const receipt = await client.waitForTransactionReceipt({ hash: publishHash });
      return { publishHash, gasUsed: Number(receipt.gasUsed) };
    },
  );

  const [readHash, readExpiry, live] = await client.readContract({
    address: directory,
    abi: ABI,
    functionName: "current",
    args: [ownerEvm],
  });
  member.bundleHash = hash;
  member.expiry = bundle.expiry;
  member.openHash = openHash;
  member.publishHash = result.publishHash;
  member.gasUsed = result.gasUsed;
  member.closeHash = closeHash;
  member.readBack = { hash: readHash, expiry: Number(readExpiry), live };
  writeFileSync(ownPath, `${JSON.stringify(member, null, 2)}\n`);
  if (readHash !== hash || Number(readExpiry) !== bundle.expiry || !live) {
    throw new Error("read-back does not match the published bundle");
  }
  console.log(JSON.stringify(member, null, 2));
  console.log(`bundle ${BUNDLE_OUT}, secrets ~/.haven/courier/${OWNER}.prekeys.json (0600)`);
}

type MemberReport = {
  network: string;
  directory: Address;
  owner: string;
  ownerEvm: Address;
  fundHash?: string;
  bundleHash?: Hex;
  expiry?: number;
  openHash?: string;
  publishHash?: Hex;
  gasUsed?: number;
  closeHash?: string;
  readBack?: { hash: Hex; expiry: number; live: boolean };
  refusedForgedSignature?: string;
};

async function publishVendor(): Promise<void> {
  const report: Report = existsSync(REPORT)
    ? (JSON.parse(readFileSync(REPORT, "utf8")) as Report)
    : { network: TESTNET.chainId };
  const client = evmClient();
  const owner = await loadAccount(OWNER);
  const ownerEvm = owner.evm.toLowerCase() as Address;

  const sealKeys = loadSealKeys(OWNER);
  const registry = await fetchKemKey({ rest: TESTNET.rest, address: owner.cosmos });
  if (!registry.registered || !registry.publicKey) throw new Error(`${owner.cosmos} has no KEM key on chain`);
  const registryHex = bytesToHex(registry.publicKey);
  if (registryHex !== bytesToHex(sealKeys.mlkemPublicKey)) {
    throw new Error("the registry KEM key is not the key derived for this account");
  }

  if (!report.directory) {
    const artifact = JSON.parse(readFileSync("out/PrekeyDirectory.sol/PrekeyDirectory.json", "utf8")) as {
      abi: unknown[];
      bytecode: { object: Hex };
    };
    const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: [] });
    const { result, openHash, closeHash } = await withEvmWindow(
      DEPLOYER,
      { txs: 1, maxValueUqor: DEPLOY_CAP_UQOR, blocks: 200 },
      async (account) => {
        const signer = privateKeyToAccount(account.privateKey as Hex);
        const nonce = await client.getTransactionCount({ address: signer.address, blockTag: "pending" });
        const gasPrice = await client.getGasPrice();
        const gas = await client.estimateGas({ account: signer, data });
        const signed = await signer.signTransaction({
          chainId: qorechainDiana.id,
          nonce,
          gas,
          maxFeePerGas: gasPrice,
          maxPriorityFeePerGas: gasPrice,
          data,
          type: "eip1559",
        });
        const createHash = await client.sendRawTransaction({ serializedTransaction: signed });
        const created = await client.waitForTransactionReceipt({ hash: createHash });
        if (created.status !== "success" || !created.contractAddress) throw new Error(`deploy failed: ${createHash}`);
        return { createHash, address: created.contractAddress, gasUsed: Number(created.gasUsed), deployer: account.evm };
      },
    );
    report.directory = result.address.toLowerCase() as Address;
    report.deployer = result.deployer;
    report.deploy = { openHash, createHash: result.createHash, gasUsed: result.gasUsed, closeHash };
    save(report);
    console.log(`directory ${report.directory}`);
  }
  const directory = report.directory;

  if ((await bank(owner.cosmos)) < MIN_OWNER_UQOR) {
    const deployer = await loadAccount(DEPLOYER);
    report.fundHash = await broadcast(
      deployer,
      [
        {
          typeUrl: "/cosmos.bank.v1beta1.MsgSend",
          value: {
            fromAddress: deployer.cosmos,
            toAddress: owner.cosmos,
            amount: [{ denom: "uqor", amount: FUND_UQOR.toString() }],
          },
        },
      ],
      "hybrid",
    );
    save(report);
    console.log(`funded ${owner.cosmos}: ${report.fundHash}`);
  }

  const now = Math.floor(Date.now() / 1000);
  const { bundle, secrets } = createBundle(sealKeys.mlkemPublicKey, now + TTL);
  if (bundle.identityKem !== registryHex) throw new Error("bundle identity KEM is not the registry key");
  const hash = bundleHash(bundle) as Hex;
  const expiry = BigInt(bundle.expiry);

  const local = encodeAbiParameters(
    [{ type: "uint256" }, { type: "address" }, { type: "address" }, { type: "bytes32" }, { type: "uint256" }],
    [BigInt(qorechainDiana.id), directory, ownerEvm, hash, expiry],
  );
  const onChain = await client.readContract({
    address: directory,
    abi: ABI,
    functionName: "signingMessage",
    args: [ownerEvm, hash, expiry],
  });
  if (onChain.toLowerCase() !== local.toLowerCase()) throw new Error("signingMessage differs from the local encoding");

  writePrivate(
    SECRETS_OUT,
    `${JSON.stringify(
      {
        owner: owner.cosmos,
        bundleHash: hash,
        expiry: bundle.expiry,
        signedPrekey: bytesToHex(secrets.signedPrekey),
        lastResortKem: bytesToHex(secrets.lastResortKem),
        oneTime: secrets.oneTime.map((entry) => ({ kem: bytesToHex(entry.kem), x25519: bytesToHex(entry.x25519) })),
        used: [],
      },
      null,
      2,
    )}\n`,
  );
  mkdirSync("deployments/bundles", { recursive: true });
  writeFileSync(BUNDLE_OUT, `${JSON.stringify(bundle)}\n`);

  const signatureBytes = pqSign(owner.pqc.secretKey, hexToBytes(local));
  const forged = signatureBytes.slice();
  forged[100] ^= 0x01;
  const signature = bytesToHex(signatureBytes);
  const data = encodeFunctionData({ abi: ABI, functionName: "publish", args: [hash, expiry, signature] });
  const { result, openHash, closeHash } = await withEvmWindow(
    OWNER,
    { txs: 1, maxValueUqor: PUBLISH_CAP_UQOR, targets: [directory], blocks: 200 },
    async (account) => {
      // eth_estimateGas on this RPC drops revert data; eth_call keeps it.
      let refused = "accepted";
      try {
        await client.call({
          account: ownerEvm,
          to: directory,
          data: encodeFunctionData({ abi: ABI, functionName: "publish", args: [hash, expiry, bytesToHex(forged)] }),
        });
      } catch (error) {
        const err = error as { cause?: { data?: Hex; cause?: { data?: Hex } } };
        refused = err.cause?.data ?? err.cause?.cause?.data ?? "no revert data";
      }
      if (refused !== SIGNATURE_INVALID) {
        throw new Error(`a forged signature was not refused with SignatureInvalid: ${refused}`);
      }
      report.refusedForgedSignature = `eth_call reverted with SignatureInvalid() ${SIGNATURE_INVALID}`;
      const publishHash = await sendScopedContractTx({ account, to: directory, data });
      const receipt = await client.waitForTransactionReceipt({ hash: publishHash });
      return { publishHash, gasUsed: Number(receipt.gasUsed) };
    },
  );
  report.publish = {
    owner: owner.cosmos,
    ownerEvm,
    bundleHash: hash,
    expiry: bundle.expiry,
    openHash,
    publishHash: result.publishHash,
    gasUsed: result.gasUsed,
    closeHash,
  };

  const [readHash, readExpiry, live] = await client.readContract({
    address: directory,
    abi: ABI,
    functionName: "current",
    args: [ownerEvm],
  });
  report.readBack = { hash: readHash, expiry: Number(readExpiry), live };
  save(report);
  if (readHash !== hash || Number(readExpiry) !== bundle.expiry || !live) {
    throw new Error("read-back does not match the published bundle");
  }
  console.log(JSON.stringify(report, null, 2));
  console.log(`bundle ${BUNDLE_OUT}, secrets ~/.haven/courier/${OWNER}.prekeys.json (0600)`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
