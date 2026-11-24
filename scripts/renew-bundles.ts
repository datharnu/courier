import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { fetchKemKey } from "@qorechain/qoreseal/network";
import type { UnifiedAccount } from "@qorechain/sdk";
import { bytesToHex, hexToBytes, type Address, type Hex } from "viem";
import { TESTNET } from "haven-pq-kit/network";
import { broadcast, evmClient, loadAccount, loadSealKeys } from "./lib/chain.js";
import { demoAccount, loadDemo } from "./lib/demo.js";
import { DIRECTORY_ABI, TTL, publishBundle } from "./lib/publish.js";
import { prekeyPath, writePrivate } from "./lib/secrets.js";
import { bundleHash, createBundle } from "../src/ts/bundle.js";
import { DEMO_VENDOR, demoBundle } from "./lib/web-demo-keys.js";

/**
 * Renews the project's PrekeyDirectory bundles before they expire.
 *
 *   npm run renew                      # dry run: reads current() and balances, sends nothing, needs no keys
 *   npm run renew -- --within 72       # dry run with a 72-hour window (default 48)
 *   npm run renew -- --send            # publishes a fresh bundle for each owner inside the window
 *   npm run renew -- --send courier-carol
 *
 * The contract accepts a new publish at any time with an expiry up to 7 days ahead, so renewing early
 * leaves no gap. The recorded first publishes (`deployments/prekey-directory.json`,
 * `deployments/prekeys-courier-carol.json`) are never rewritten: each renewal is appended to
 * `deployments/renewals.json`, which `npm run evidence` then re-checks with the rest.
 * The previous public bundle is kept in `deployments/bundles/archive/` so its hash stays checkable.
 *
 * `courier-demo-vendor` is the public demo identity behind /app/try. Its keys are in
 * `apps/web/fixtures/demo/identities.json` (public on purpose), not in ~/.haven, and a renewal
 * republishes the same prekeys with a new expiry, so no file in the repository changes except
 * `deployments/renewals.json`.
 */

const OWNERS = ["steward-vendor", "courier-carol", DEMO_VENDOR] as const;
const DEPLOYER = "spike";
const ACCOUNT_NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;
const FUND_UQOR = 1_000_000n;
const MIN_OWNER_UQOR = 600_000n;
const RENEWALS = "deployments/renewals.json";
const ABI = DIRECTORY_ABI;

type Renewal = {
  owner: string;
  ownerEvm: Address;
  previous: { hash: Hex; expiry: number; live: boolean };
  fundHash?: string;
  bundleHash: Hex;
  expiry: number;
  openHash: string;
  publishHash: Hex;
  gasUsed: number;
  closeHash: string;
  readBack: { hash: Hex; expiry: number; live: boolean };
  refusedForgedSignature: string;
  at: string;
};

type Renewals = { network: string; directory: Address; renewals: Renewal[] };

type Status = {
  name: string;
  cosmos: string;
  evm: Address;
  hash: Hex;
  expiry: number;
  live: boolean;
  hoursLeft: number;
  balance: bigint;
  due: boolean;
};

function parseArgs(argv: string[]): { send: boolean; within: number; names: string[] } {
  let send = false;
  let within = 48;
  const names: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--send") send = true;
    else if (arg === "--dry-run") send = false;
    else if (arg === "--within") {
      within = Number(argv[++i]);
      if (!Number.isFinite(within) || within <= 0 || within > 7 * 24) throw new Error("--within is hours, 1 to 168");
    } else if (ACCOUNT_NAME.test(arg)) names.push(arg);
    else throw new Error(`unknown argument ${arg}`);
  }
  if (argv.includes("--send") && argv.includes("--dry-run")) throw new Error("pass --send or --dry-run, not both");
  for (const name of names) {
    if (!(OWNERS as readonly string[]).includes(name)) throw new Error(`${name} is not a project bundle owner (${OWNERS.join(", ")})`);
  }
  return { send, within, names: names.length > 0 ? names : [...OWNERS] };
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** Owner addresses come from the recorded first publishes, so a dry run needs no keys. */
function recordedOwner(name: string): { cosmos: string; evm: Address } {
  if (name === DEMO_VENDOR) {
    const demo = loadDemo();
    return { cosmos: demo.vendor.cosmos, evm: demo.vendor.evm as Address };
  }
  if (name === "steward-vendor") {
    const report = readJson<{ publish?: { owner: string; ownerEvm: Address } }>("deployments/prekey-directory.json");
    if (!report.publish) throw new Error("no recorded vendor publish");
    return { cosmos: report.publish.owner, evm: report.publish.ownerEvm.toLowerCase() as Address };
  }
  const report = readJson<{ owner: string; ownerEvm: Address }>(`deployments/prekeys-${name}.json`);
  return { cosmos: report.owner, evm: report.ownerEvm.toLowerCase() as Address };
}

async function bank(address: string): Promise<bigint> {
  const res = await fetch(`${TESTNET.rest}/cosmos/bank/v1beta1/balances/${address}`, { headers: { "user-agent": "haven" } });
  if (!res.ok) throw new Error(`balance of ${address}: HTTP ${res.status}`);
  const body = (await res.json()) as { balances: { denom: string; amount: string }[] };
  return BigInt(body.balances.find((coin) => coin.denom === "uqor")?.amount ?? "0");
}

function utc(unix: number): string {
  return `${new Date(unix * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** Writes a temporary file and renames it, so an interrupted run never leaves half a JSON file. */
function writeAtomic(path: string, contents: string): void {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, contents);
  renameSync(temp, path);
}

async function status(directory: Address, name: string, chainNow: number, withinHours: number): Promise<Status> {
  const owner = recordedOwner(name);
  const [hash, expiry, live] = await evmClient().readContract({
    address: directory,
    abi: ABI,
    functionName: "current",
    args: [owner.evm],
  });
  const hoursLeft = (Number(expiry) - chainNow) / 3600;
  return {
    name,
    ...owner,
    hash,
    expiry: Number(expiry),
    live,
    hoursLeft,
    balance: await bank(owner.cosmos),
    // A demo identity that was never published is set up by `npm run demo:identities`, not renewed.
    due: (!live || hoursLeft <= withinHours) && !(name === DEMO_VENDOR && Number(expiry) === 0),
  };
}

async function renew(directory: Address, row: Status): Promise<Renewal> {
  const client = evmClient();
  const demo = row.name === DEMO_VENDOR ? loadDemo() : undefined;
  const owner: UnifiedAccount = demo ? await demoAccount(demo, "vendor") : await loadAccount(row.name);
  const ownerEvm = owner.evm.toLowerCase() as Address;
  if (ownerEvm !== row.evm) throw new Error(`${row.name}: the key in ~/.haven is not the recorded owner ${row.evm}`);
  const registry = await fetchKemKey({ rest: TESTNET.rest, address: owner.cosmos });
  if (!registry.registered || !registry.publicKey) throw new Error(`${owner.cosmos} has no KEM key on chain`);
  const registryHex = bytesToHex(registry.publicKey);
  const identityKem = demo ? demo.vendor.identityKem : bytesToHex(loadSealKeys(row.name).mlkemPublicKey);
  if (registryHex !== identityKem) throw new Error("the registry KEM key is not the key derived for this account");

  let fundHash: string | undefined;
  if ((await bank(owner.cosmos)) < MIN_OWNER_UQOR) {
    const deployer = await loadAccount(DEPLOYER);
    fundHash = await broadcast(
      deployer,
      [
        {
          typeUrl: "/cosmos.bank.v1beta1.MsgSend",
          value: { fromAddress: deployer.cosmos, toAddress: owner.cosmos, amount: [{ denom: "uqor", amount: FUND_UQOR.toString() }] },
        },
      ],
      "hybrid",
    );
    console.log(`funded ${owner.cosmos}: ${fundHash}`);
  }

  const block = await client.getBlock();
  const expiry = Number(block.timestamp) + TTL;
  let hash: Hex;
  if (demo) {
    // The demo vendor's prekeys are public and fixed; only the expiry changes, so /app/try needs no redeploy.
    hash = bundleHash(demoBundle(demo, expiry)) as Hex;
  } else {
    const { bundle, secrets } = createBundle(hexToBytes(identityKem as Hex), expiry);
    if (bundle.identityKem !== registryHex) throw new Error("bundle identity KEM is not the registry key");
    hash = bundleHash(bundle) as Hex;
    // Keep the previous public bundle so its recorded hash can still be recomputed, then write the new one.
    const bundlePath = `deployments/bundles/${row.name}.json`;
    if (existsSync(bundlePath)) {
      mkdirSync("deployments/bundles/archive", { recursive: true });
      copyFileSync(bundlePath, `deployments/bundles/archive/${row.name}-${row.hash.slice(2, 10)}.json`);
    }
    // The old prekey secrets are replaced, as `deploy:directory` does: an expired bundle is never opened again.
    writePrivate(
      prekeyPath(row.name),
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
    writeAtomic(bundlePath, `${JSON.stringify(bundle)}\n`);
  }

  const published = await publishBundle({ directory, owner, hash, expiry });
  const renewal: Renewal = {
    owner: owner.cosmos,
    ownerEvm,
    previous: { hash: row.hash, expiry: row.expiry, live: row.live },
    ...(fundHash ? { fundHash } : {}),
    bundleHash: hash,
    expiry,
    openHash: published.openHash,
    publishHash: published.publishHash,
    gasUsed: published.gasUsed,
    closeHash: published.closeHash,
    readBack: published.readBack,
    refusedForgedSignature: published.refusedForgedSignature,
    at: new Date().toISOString(),
  };
  const log: Renewals = existsSync(RENEWALS) ? readJson<Renewals>(RENEWALS) : { network: TESTNET.chainId, directory, renewals: [] };
  log.renewals.push(renewal);
  writeAtomic(RENEWALS, `${JSON.stringify(log, null, 2)}\n`);
  const back = published.readBack;
  if (back.hash !== hash || back.expiry !== expiry || !back.live) throw new Error("read-back does not match the published bundle");
  return renewal;
}

async function main(): Promise<void> {
  const { send, within, names } = parseArgs(process.argv.slice(2));
  const { directory } = readJson<{ directory: Address }>("deployments/prekey-directory.json");
  const block = await evmClient().getBlock();
  const chainNow = Number(block.timestamp);
  console.log(`${send ? "SEND" : "DRY RUN (sends nothing)"} · directory ${directory} · chain time ${utc(chainNow)} · window ${within} h`);

  const rows: Status[] = [];
  for (const name of names) rows.push(await status(directory, name, chainNow, within));
  for (const row of rows) {
    if (row.name === DEMO_VENDOR && row.expiry === 0) {
      console.log(`${row.name.padEnd(19)} not published yet → set it up with npm run demo:identities (plan), then -- --broadcast`);
      continue;
    }
    const left = row.live ? `${row.hoursLeft.toFixed(1)} h left` : "EXPIRED";
    const action = row.due ? "renew" : "ok, not inside the window";
    const funding = row.due && row.balance < MIN_OWNER_UQOR ? ` · would fund from ${DEPLOYER} (balance ${row.balance} uqor)` : "";
    console.log(`${row.name.padEnd(19)} ${row.hash.slice(0, 10)}… expires ${utc(row.expiry)} (${left}) → ${action}${funding}`);
  }

  const due = rows.filter((row) => row.due);
  if (due.length === 0) {
    const next = Math.min(...rows.filter((row) => row.expiry > 0).map((row) => row.expiry - within * 3600));
    console.log(`nothing to renew. Run again after ${utc(next)}.`);
    return;
  }
  if (!send) {
    console.log(`would publish ${due.length} bundle(s): ${due.map((row) => row.name).join(", ")}.`);
    console.log("each publish opens and closes a scoped EVM window (360,000 uqor) plus about 281,000 gas.");
    console.log(`to publish: npm run renew -- --send${names.length < OWNERS.length ? ` ${names.join(" ")}` : ""}`);
    return;
  }
  for (const row of due) {
    const renewal = await renew(directory, row);
    console.log(`${row.name}: published ${renewal.bundleHash} until ${utc(renewal.expiry)} in ${renewal.publishHash}`);
  }
  console.log(`recorded in ${RENEWALS}. Devices and a running relay need the new bundle (deployments/bundles/<name>.json).`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
