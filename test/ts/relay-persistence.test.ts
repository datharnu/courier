import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { deriveSealKeys } from "@qorechain/qoreseal";
import { classicalKeyFromPrivate } from "@qorechain/qoresign";
import { deriveUnifiedAccount, generateMnemonic } from "@qorechain/sdk";
import { bytesToHex, hexToBytes, type Hex } from "viem";

import { bundleHash, createBundle } from "../../src/ts/bundle.js";
import { toEvm, type ChainReader } from "../../src/ts/chain.js";
import { CourierClient, type Identity, type Received } from "../../src/ts/client.js";
import { createRelay, type RelaySnapshot } from "../../src/ts/relay.js";
import { fileStore } from "../../src/ts/relay-store.js";

const CHAIN_ID = "qorechain-diana";
const BASE = "https://relay.test";
const text = new TextDecoder();

type Fake = { mldsa: Uint8Array; kem: string; directory?: { hash: string; expiry: number; live: boolean } };
const chainState = new Map<string, Fake>();

const chain: ChainReader = {
  chainId: CHAIN_ID,
  async mldsaKey(evm) {
    const entry = chainState.get(toEvm(evm));
    if (!entry) throw new Error("no ML-DSA key is registered");
    return entry.mldsa;
  },
  async kemKey(evm) {
    const entry = chainState.get(toEvm(evm));
    if (!entry) throw new Error("no KEM key");
    return entry.kem;
  },
  async directory(evm) {
    return chainState.get(toEvm(evm))?.directory ?? { hash: `0x${"00".repeat(32)}`, expiry: 0, live: false };
  },
  async now() {
    return Math.floor(Date.now() / 1000);
  },
};

type Fetch = typeof fetch;

/** One "process" of the relay. Booting again with the same path is a restart. */
function boot(path?: string): Fetch {
  const handler = createRelay({ chain, domain: "relay.test", uri: BASE, store: path ? fileStore(path) : undefined });
  return (async (input: RequestInfo | URL, init?: RequestInit) => handler(new Request(input, init))) as Fetch;
}

async function identity(): Promise<Identity> {
  const mnemonic = generateMnemonic(256);
  const account = await deriveUnifiedAccount(mnemonic);
  const seal = deriveSealKeys({ mnemonic });
  const evm = toEvm(account.evm);
  chainState.set(evm, { mldsa: account.pqc.publicKey, kem: bytesToHex(seal.mlkemPublicKey) });
  return {
    cosmos: account.cosmos,
    evm,
    mldsaSecret: account.pqc.secretKey,
    classicalKey: classicalKeyFromPrivate(hexToBytes(account.privateKey as Hex), "eth_secp256k1"),
    seal,
  };
}

function client(who: Identity, http: Fetch): CourierClient {
  return new CourierClient({ relay: BASE, chain, identity: who, fetch: http });
}

function moveTo(device: CourierClient, http: Fetch): void {
  (device as unknown as { http: Fetch }).http = http;
}

async function withBundle(device: CourierClient): Promise<void> {
  const evm = device.identity.evm;
  const made = createBundle(device.identity.seal.mlkemPublicKey, Math.floor(Date.now() / 1000) + 86400);
  chainState.get(evm)!.directory = { hash: bundleHash(made.bundle), expiry: made.bundle.expiry, live: true };
  device.usePrekeys({ ...made, used: new Set() });
  await device.publishBundle();
}

function texts(items: Received[]): string[] {
  return items.map((item) => (item.ok && item.payload.t === "text" ? item.payload.body : `refused:${item.ok ? "?" : item.code}`));
}

let alice: Identity;
let bob: Identity;
let carol: Identity;
let dir: string;

before(async () => {
  [alice, bob, carol] = await Promise.all([identity(), identity(), identity()]);
  dir = mkdtempSync(join(tmpdir(), "courier-relay-"));
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("undelivered messages and files survive a relay restart", async () => {
  const path = join(dir, "undelivered.json");
  const first = boot(path);
  const a = client(alice, first);
  const b = client(bob, first);
  await a.publishCard();
  await b.publishCard();
  await withBundle(b);
  const conversation = (await a.start(bob.evm, { t: "text", body: "sent before the restart" })).conversationId;
  await a.sendFile([conversation], "INV-0007.json", new TextEncoder().encode('{"invoice":"INV-0007"}'));

  // The relay process ends. Nothing in memory is reused: the next boot reads only the file.
  const second = boot(path);
  moveTo(a, second);
  moveTo(b, second);
  const got = await b.receive();
  assert.equal(got.length, 2);
  assert.deepEqual(texts([got[0]]), ["sent before the restart"]);
  const file = got[1];
  assert.ok(file.ok && file.payload.t === "file", "the file message opened");
  if (file.ok && file.payload.t === "file") {
    assert.equal(text.decode(await b.fetchFile(file.payload)), '{"invoice":"INV-0007"}');
  }

  // Cards and bundles were kept too, so the conversation carries on without republishing.
  await b.sendText(conversation, "reply after the restart");
  assert.deepEqual(texts(await a.receive()), ["reply after the restart"]);
});

test("a restarted relay keeps its instance and sequence numbers, so a client does not re-read old items", async () => {
  const path = join(dir, "cursor.json");
  const first = boot(path);
  const a = client(alice, first);
  const b = client(bob, first);
  await a.publishCard();
  await b.publishCard();
  await withBundle(b);
  const conversation = (await a.start(bob.evm, { t: "text", body: "one" })).conversationId;
  assert.deepEqual(texts(await b.receive()), ["one"]);
  await a.sendText(conversation, "two");

  const second = boot(path);
  moveTo(a, second);
  moveTo(b, second);
  // Same instance: the client keeps its cursor and does not re-read "one" (which would be refused as a replay).
  assert.deepEqual(texts(await b.receive()), ["two"]);
  await a.sendText(conversation, "three");
  assert.deepEqual(texts(await b.receive()), ["three"]);
});

test("one-time entries handed out before a restart are not handed out again", async () => {
  const path = join(dir, "handed.json");
  const first = boot(path);
  const b = client(bob, first);
  await b.publishCard();
  await withBundle(b);
  const handed = async (http: Fetch) => ((await (await http(`${BASE}/v1/bundles/${bob.evm}`)).json()) as { oneTimeIndex: number }).oneTimeIndex;
  assert.equal(await handed(first), 0);
  assert.equal(await handed(first), 1);
  const second = boot(path);
  assert.equal(await handed(second), 2);

  // Without a store, a restart forgets the bundle entirely; the owner has to publish again.
  const memory = boot();
  const restartedMemory = boot();
  const mb = client(bob, memory);
  await withBundle(mb);
  assert.equal((await restartedMemory(`${BASE}/v1/bundles/${bob.evm}`)).status, 404);
});

test("sign-in tokens are not saved: after a restart the owner signs in again", async () => {
  const path = join(dir, "tokens.json");
  const first = boot(path);
  const c = client(carol, first);
  await c.signIn();
  const token = (c as unknown as { token: string }).token;
  assert.equal((await first(`${BASE}/v1/inbox/${carol.evm}`, { headers: { authorization: `Bearer ${token}` } })).status, 200);
  await first(`${BASE}/v1/inbox/${carol.evm}`, { method: "POST", body: JSON.stringify({ message: { type: "x" } }) });

  const saved = readFileSync(path, "utf8");
  assert.equal(saved.includes(token), false, "the bearer token is not on disk");
  const second = boot(path);
  assert.equal((await second(`${BASE}/v1/inbox/${carol.evm}`, { headers: { authorization: `Bearer ${token}` } })).status, 401);
  moveTo(c, second);
  const items = await c.receive();
  assert.equal(items.length, 1, "the client signed in again and read the saved item");
  assert.equal(items[0].ok, false);
});

test("the state file is replaced atomically, private, and a corrupt file stops the relay instead of wiping it", async () => {
  const path = join(dir, "atomic.json");
  const store = fileStore(path);
  assert.equal(store.load(), undefined);
  const snapshot: RelaySnapshot = {
    version: 1,
    instance: "00112233",
    bundles: [],
    cards: [],
    inboxes: [{ evm: alice.evm, next: 1, items: [{ seq: 0, at: 1, message: { type: "x" } }] }],
    files: [{ id: `0x${"ab".repeat(32)}`, nonce: "0x00", ciphertext: "0x01", hash: "0x02" }],
  };
  store.save(snapshot);
  store.save({ ...snapshot, instance: "44556677" });
  assert.deepEqual(store.load(), { ...snapshot, instance: "44556677" });
  assert.deepEqual(
    readdirSync(dir).filter((name) => name.startsWith("atomic.json")),
    ["atomic.json"],
    "no temporary file is left behind",
  );
  assert.equal(statSync(path).mode & 0o777, 0o600);

  writeFileSync(path, '{"version":1,"instance":"00112233","bundles":[');
  assert.throws(() => boot(path), /not JSON/);
  assert.ok(existsSync(path), "the damaged file is left for the operator");
  writeFileSync(path, JSON.stringify({ ...snapshot, version: 2 }));
  assert.throws(() => boot(path), /unknown version/);
});
