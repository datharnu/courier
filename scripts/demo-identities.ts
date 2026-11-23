import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { ALGORITHM_ML_KEM_1024, deriveSealKeys, validateMlkemPublicKey } from "@qorechain/qoreseal";
import { fetchKemKey } from "@qorechain/qoreseal/network";
import {
  REGISTER_KEM_KEY_TYPE_URL,
  buildRegisterPqcKeyMsg,
  deriveUnifiedAccount,
  fetchPqcStatus,
  generateMnemonic,
  signProofOfPossession,
  type UnifiedAccount,
} from "@qorechain/sdk";
import { bytesToHex, hexToBytes, type Address, type Hex } from "viem";
import { TESTNET } from "haven-pq-kit/network";
import { CHAIN_ID, broadcast, evmClient, loadAccount } from "./lib/chain.js";
import { DEMO_FIXTURE, demoAccount, loadDemo } from "./lib/demo.js";
import { DIRECTORY_ABI, TTL, publishBundle } from "./lib/publish.js";
import { createBundle } from "../src/ts/bundle.js";
import { DEMO_CLIENT, DEMO_VENDOR, DEMO_WARNING, demoBundleHash, type DemoFixture } from "../apps/web/lib/try/demo-keys.js";

/**
 * The two public demo identities behind /app/try: `courier-demo-vendor` and `courier-demo-client`.
 * Their mnemonics and secret keys are committed in apps/web/fixtures/demo/identities.json ON PURPOSE.
 * Anyone can read them. They hold nothing and protect nothing.
 *
 *   npm run demo:identities                   # plan: reads the chain, prints each step and its cost, sends nothing
 *   npm run demo:identities -- --create       # writes the fixture (local key generation, no network). Never overwrites.
 *   npm run demo:identities -- --broadcast    # runs the missing steps below, paid from `spike` (~/.haven/spike.env)
 *
 * Steps, each skipped when the chain already shows it done:
 *   1. fund the client and the vendor from spike (bank send, hybrid-signed by spike)
 *   2. register each ML-DSA-87 key with proof of possession (the one classical transaction per account)
 *   3. register the vendor's ML-KEM-1024 identity key (hybrid-signed)
 *   4. publish the vendor's bundle hash to PrekeyDirectory (scoped EVM window, ML-DSA-87 signature)
 * Only the vendor publishes a bundle: the client starts the conversation, so the page needs only the
 * client's registered ML-DSA-87 key, which the vendor reads to check the first message's signature.
 * After the first publish, `npm run renew -- --send` keeps the vendor's bundle live.
 */

const DEPLOYER = "spike";
const REPORT = "deployments/demo-identities.json";
/** The fee scripts/lib/chain.ts lands every native transaction with. */
const NATIVE_FEE_UQOR = 180_000n;
/** About 281,000 gas at ~0.1125 uqor/gas (the directory deploy cost 43,097 uqor for 383,084 gas). */
const PUBLISH_GAS_UQOR = 32_000n;
const FUND: Record<"vendor" | "client", { below: bigint; amount: bigint }> = {
  // Two registrations (2 x 180,000), one publish (~392,000), and room for about three renewals.
  vendor: { below: 1_200_000n, amount: 2_000_000n },
  // One registration (180,000).
  client: { below: 300_000n, amount: 400_000n },
};

type Report = {
  network: string;
  directory: Address;
  warning: string;
  vendor: { cosmos: string; evm: string; fundHash?: string; mldsaHash?: string; kemHash?: string };
  client: { cosmos: string; evm: string; fundHash?: string; mldsaHash?: string };
  publish?: {
    bundleHash: Hex;
    expiry: number;
    openHash: string;
    publishHash: Hex;
    gasUsed: number;
    closeHash: string;
    readBack: { hash: Hex; expiry: number; live: boolean };
    refusedForgedSignature: string;
  };
};

type Step = { label: string; costUqor: bigint; payer: string; run: () => Promise<void> };

function bank(address: string): Promise<bigint> {
  return fetch(`${TESTNET.rest}/cosmos/bank/v1beta1/balances/${address}`, { headers: { "user-agent": "courier" } })
    .then((res) => res.json() as Promise<{ balances?: { denom: string; amount: string }[] }>)
    .then((body) => BigInt(body.balances?.find((coin) => coin.denom === "uqor")?.amount ?? "0"));
}

function qor(uqor: bigint): string {
  return `${(Number(uqor) / 1_000_000).toFixed(3)} QOR`;
}

function sameBytes(a: string | Uint8Array | undefined, b: Uint8Array): boolean {
  if (a === undefined) return false;
  const bytes = typeof a === "string" ? hexToBytes((a.startsWith("0x") ? a : `0x${a}`) as Hex) : a;
  return bytes.length === b.length && bytes.every((byte, i) => byte === b[i]);
}

async function create(): Promise<void> {
  if (existsSync(DEMO_FIXTURE)) throw new Error(`${DEMO_FIXTURE} exists. Refusing to replace the published demo identities.`);
  const { directory } = JSON.parse(readFileSync("deployments/prekey-directory.json", "utf8")) as { directory: string };
  const vendorMnemonic = generateMnemonic(256);
  const clientMnemonic = generateMnemonic(256);
  const vendor = await deriveUnifiedAccount(vendorMnemonic);
  const client = await deriveUnifiedAccount(clientMnemonic);
  const vendorSeal = deriveSealKeys({ mnemonic: vendorMnemonic, index: 0 });
  const clientSeal = deriveSealKeys({ mnemonic: clientMnemonic, index: 0 });
  // The expiry is set at publish time; createBundle needs one to validate the shape.
  const { bundle, secrets } = createBundle(vendorSeal.mlkemPublicKey, 1);
  const fixture: DemoFixture = {
    warning: DEMO_WARNING,
    network: "qorechain-diana",
    directory: directory.toLowerCase(),
    vendor: {
      name: DEMO_VENDOR,
      mnemonic: vendorMnemonic,
      cosmos: vendor.cosmos,
      evm: vendor.evm.toLowerCase(),
      identityKem: bytesToHex(vendorSeal.mlkemPublicKey),
      identityX25519Public: bytesToHex(vendorSeal.x25519PublicKey),
      identityX25519Secret: bytesToHex(vendorSeal.x25519SecretKey),
      prekeys: {
        signedPrekey: bundle.signedPrekey,
        lastResortKem: bundle.lastResortKem,
        oneTime: bundle.oneTime,
        secrets: {
          signedPrekey: bytesToHex(secrets.signedPrekey),
          lastResortKem: bytesToHex(secrets.lastResortKem),
          oneTime: secrets.oneTime.map((entry) => ({ kem: bytesToHex(entry.kem), x25519: bytesToHex(entry.x25519) })),
        },
      },
    },
    client: {
      name: DEMO_CLIENT,
      mnemonic: clientMnemonic,
      cosmos: client.cosmos,
      evm: client.evm.toLowerCase(),
      mldsaPublic: bytesToHex(client.pqc.publicKey),
      mldsaSecret: bytesToHex(client.pqc.secretKey),
      identityX25519Public: bytesToHex(clientSeal.x25519PublicKey),
      identityX25519Secret: bytesToHex(clientSeal.x25519SecretKey),
    },
  };
  mkdirSync("apps/web/fixtures/demo", { recursive: true });
  writeFileSync(DEMO_FIXTURE, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`wrote ${DEMO_FIXTURE}. ${DEMO_WARNING}`);
  console.log(`vendor ${fixture.vendor.cosmos} / ${fixture.vendor.evm}`);
  console.log(`client ${fixture.client.cosmos} / ${fixture.client.evm}`);
  console.log("next: npm run demo:identities (plan), then npm run demo:identities -- --broadcast");
}

function loadReport(fixture: DemoFixture): Report {
  if (existsSync(REPORT)) return JSON.parse(readFileSync(REPORT, "utf8")) as Report;
  return {
    network: TESTNET.chainId,
    directory: fixture.directory as Address,
    warning: DEMO_WARNING,
    vendor: { cosmos: fixture.vendor.cosmos, evm: fixture.vendor.evm },
    client: { cosmos: fixture.client.cosmos, evm: fixture.client.evm },
  };
}

async function plan(fixture: DemoFixture, accounts: { vendor: UnifiedAccount; client: UnifiedAccount }, report: Report): Promise<Step[]> {
  const steps: Step[] = [];
  const save = () => writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  const spike = () => loadAccount(DEPLOYER);

  for (const role of ["client", "vendor"] as const) {
    const account = accounts[role];
    const balance = await bank(account.cosmos);
    const pqc = await fetchPqcStatus({ rest: TESTNET.rest, address: account.cosmos });
    console.log(`${fixture[role].name.padEnd(20)} ${account.cosmos} balance ${qor(balance)} · ML-DSA-87 ${pqc.registered ? "registered" : "not registered"}`);
    if (pqc.registered && !sameBytes(pqc.pubkey, account.pqc.publicKey)) {
      throw new Error(`${account.cosmos} already has a different ML-DSA key; this script does not rotate keys`);
    }
    const fund = FUND[role];
    // Registration spends from the account, so fund first when it is short, even if only the publish is left.
    if (balance < fund.below) {
      steps.push({
        label: `fund ${fixture[role].name} with ${qor(fund.amount)} from ${DEPLOYER}`,
        costUqor: fund.amount + NATIVE_FEE_UQOR,
        payer: DEPLOYER,
        run: async () => {
          const deployer = await spike();
          const hash = await broadcast(
            deployer,
            [{ typeUrl: "/cosmos.bank.v1beta1.MsgSend", value: { fromAddress: deployer.cosmos, toAddress: account.cosmos, amount: [{ denom: "uqor", amount: fund.amount.toString() }] } }],
            "hybrid",
          );
          report[role].fundHash = hash;
          save();
          console.log(`  funded ${account.cosmos}: ${hash}`);
        },
      });
    }
    if (!pqc.registered) {
      steps.push({
        label: `register ${fixture[role].name}'s ML-DSA-87 key with proof of possession (classical-signed)`,
        costUqor: NATIVE_FEE_UQOR,
        payer: fixture[role].name,
        run: async () => {
          const proof = signProofOfPossession({ chainId: CHAIN_ID, account: account.cosmos, algorithmId: 1, keypair: account.pqc });
          const hash = await broadcast(
            account,
            [buildRegisterPqcKeyMsg(account.cosmos, { pqcKeypair: account.pqc, ecdsaPubkey: hexToBytes(account.publicKey as Hex), proofOfPossession: proof, keyType: "hybrid" })],
            "classical",
          );
          report[role].mldsaHash = hash;
          save();
          console.log(`  ML-DSA-87 registered ${account.cosmos}: ${hash}`);
        },
      });
    }
  }

  const vendor = accounts.vendor;
  const kem = await fetchKemKey({ rest: TESTNET.rest, address: vendor.cosmos });
  const identityKem = hexToBytes(fixture.vendor.identityKem as Hex);
  validateMlkemPublicKey(identityKem);
  console.log(`${DEMO_VENDOR.padEnd(20)} ML-KEM-1024 identity key ${kem.registered ? "registered" : "not registered"}`);
  if (kem.registered && !sameBytes(kem.publicKey, identityKem)) {
    throw new Error(`${vendor.cosmos} already publishes a different KEM key; this script does not replace it`);
  }
  if (!kem.registered) {
    steps.push({
      label: `register ${DEMO_VENDOR}'s ML-KEM-1024 identity key (hybrid-signed)`,
      costUqor: NATIVE_FEE_UQOR,
      payer: DEMO_VENDOR,
      run: async () => {
        const hash = await broadcast(vendor, [{ typeUrl: REGISTER_KEM_KEY_TYPE_URL, value: { sender: vendor.cosmos, algorithmId: ALGORITHM_ML_KEM_1024, publicKey: identityKem } }], "hybrid");
        report.vendor.kemHash = hash;
        save();
        console.log(`  ML-KEM-1024 registered ${vendor.cosmos}: ${hash}`);
      },
    });
  }

  const client = evmClient();
  const [hash, expiry, live] = await client.readContract({ address: fixture.directory as Address, abi: DIRECTORY_ABI, functionName: "current", args: [fixture.vendor.evm as Address] });
  const now = Number((await client.getBlock()).timestamp);
  const state = Number(expiry) === 0 ? "never published" : live ? `live until ${new Date(Number(expiry) * 1000).toISOString()}` : "EXPIRED";
  console.log(`${DEMO_VENDOR.padEnd(20)} PrekeyDirectory.current: ${state}${Number(expiry) > 0 ? ` (${hash.slice(0, 10)}…)` : ""}`);
  if (!live || Number(expiry) - now < 48 * 3600) {
    steps.push({
      label: `publish ${DEMO_VENDOR}'s bundle hash to PrekeyDirectory ${fixture.directory}`,
      costUqor: 2n * NATIVE_FEE_UQOR + PUBLISH_GAS_UQOR,
      payer: DEMO_VENDOR,
      run: async () => {
        const at = Number((await client.getBlock()).timestamp) + TTL;
        const bundleHash = demoBundleHash(fixture, at) as Hex;
        const published = await publishBundle({ directory: fixture.directory as Address, owner: vendor, hash: bundleHash, expiry: at });
        report.publish = { bundleHash, expiry: at, ...published };
        save();
        if (published.readBack.hash !== bundleHash || !published.readBack.live) throw new Error("read-back does not match the published bundle");
        console.log(`  published ${bundleHash} until ${new Date(at * 1000).toISOString()} in ${published.publishHash}`);
      },
    });
  }
  return steps;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  for (const arg of args) if (!["--create", "--broadcast", "--plan"].includes(arg)) throw new Error(`unknown argument ${arg}`);
  if (args.includes("--create")) {
    await create();
    return;
  }
  if (!existsSync(DEMO_FIXTURE)) {
    console.log(`${DEMO_FIXTURE} does not exist. Create the identities first: npm run demo:identities -- --create`);
    return;
  }
  const send = args.includes("--broadcast");
  const fixture = loadDemo();
  const accounts = { vendor: await demoAccount(fixture, "vendor"), client: await demoAccount(fixture, "client") };
  const report = loadReport(fixture);
  console.log(`${send ? "BROADCAST" : "PLAN (sends nothing)"} · ${DEMO_WARNING}`);
  const spikeBalance = await bank("qor143f0ghn8slqguwez73087dvq8lqnuuukqdu9fl");
  console.log(`${DEPLOYER.padEnd(20)} qor143f0ghn8slqguwez73087dvq8lqnuuukqdu9fl balance ${qor(spikeBalance)}`);
  const steps = await plan(fixture, accounts, report);
  if (steps.length === 0) {
    console.log("nothing to do: both identities are registered and the vendor's bundle is live for more than 48 hours.");
    return;
  }
  const byPayer = new Map<string, bigint>();
  steps.forEach((step, i) => {
    console.log(`${i + 1}. ${step.label} · about ${qor(step.costUqor)} from ${step.payer}`);
    byPayer.set(step.payer, (byPayer.get(step.payer) ?? 0n) + step.costUqor);
  });
  console.log(`total: ${[...byPayer].map(([payer, cost]) => `${qor(cost)} from ${payer}`).join(", ")} (funding moves QOR from spike to the demo accounts, which then pay their own fees)`);
  if (!send) {
    console.log("to run these steps: npm run demo:identities -- --broadcast");
    return;
  }
  for (const step of steps) {
    console.log(`→ ${step.label}`);
    await step.run();
  }
  console.log(`recorded in ${REPORT}. /app/try now reads the live bundle hash. Keep it live with npm run renew -- --send.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
