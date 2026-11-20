import assert from "node:assert/strict";
import { before, test } from "node:test";

import { deriveSealKeys } from "@qorechain/qoreseal";
import { classicalKeyFromPrivate } from "@qorechain/qoresign";
import { deriveUnifiedAccount, generateMnemonic } from "@qorechain/sdk";
import { createRestProxy } from "haven-pq-kit/rest-proxy";
import { bytesToHex, hexToBytes, type Hex } from "viem";

import { bundleHash, createBundle, type BundleSecrets } from "../../src/ts/bundle.js";
import { aadBytes, open } from "../../src/ts/crypto.js";
import { openFile, type FileBlob } from "../../src/ts/file.js";
import { type Envelope } from "../../src/ts/session.js";
import { isCourierError } from "../../src/ts/bytes.js";
import { kemKeyOverRest, toEvm, type ChainReader } from "../../src/ts/chain.js";
import { CourierClient, type Identity } from "../../src/ts/client.js";
import { createRelay } from "../../src/ts/relay.js";
import { signReceipt, verifyReceipt } from "../../src/ts/receipt.js";
import { safetyNumber, safetyNumberFor } from "../../src/ts/safety.js";

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

function relayFetch(): Fetch {
  const handler = createRelay({ chain, domain: "relay.test", uri: BASE });
  return (async (input: RequestInfo | URL, init?: RequestInit) => handler(new Request(input, init))) as Fetch;
}

async function makeIdentity(): Promise<Identity> {
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

function makeClient(who: Identity, http: Fetch): CourierClient {
  return new CourierClient({ relay: BASE, chain, identity: who, fetch: http });
}

async function publishIdentity(device: CourierClient): Promise<ReturnType<typeof createBundle>> {
  await device.publishCard();
  const evm = device.identity.evm;
  const made = createBundle(device.identity.seal.mlkemPublicKey, Math.floor(Date.now() / 1000) + 86400);
  chainState.get(evm)!.directory = { hash: bundleHash(made.bundle), expiry: made.bundle.expiry, live: true };
  device.usePrekeys({ ...made, used: new Set() });
  await device.publishBundle();
  return made;
}

function copySecrets(source: BundleSecrets): BundleSecrets {
  return {
    signedPrekey: source.signedPrekey.slice(),
    lastResortKem: source.lastResortKem.slice(),
    oneTime: source.oneTime.map((entry) => ({ kem: entry.kem.slice(), x25519: entry.x25519.slice() })),
  };
}

let alice: Identity;
let bob: Identity;
let carol: Identity;
let dave: Identity;

before(async () => {
  [alice, bob, carol, dave] = await Promise.all([makeIdentity(), makeIdentity(), makeIdentity(), makeIdentity()]);
});

test("safety numbers are symmetric, 12x5 digits, and change if either ML-DSA key changes", async () => {
  const ab = await safetyNumberFor(chain, alice.evm, bob.evm);
  const ba = await safetyNumberFor(chain, bob.evm, alice.evm);
  assert.equal(ab, ba);
  assert.match(ab, /^(\d{5} ){11}\d{5}$/);

  const ac = await safetyNumberFor(chain, alice.evm, carol.evm);
  assert.notEqual(ab, ac);

  // Flipping one byte of Bob's ML-DSA key changes the safety number.
  const tamperedKey = chainState.get(bob.evm)!.mldsa.slice();
  tamperedKey[0] ^= 1;
  const tampered = safetyNumber(
    { address: alice.evm, mldsaPublicKey: chainState.get(alice.evm)!.mldsa },
    { address: bob.evm, mldsaPublicKey: tamperedKey },
  );
  assert.notEqual(ab, tampered);

  // Short ML-DSA key is rejected.
  assert.throws(
    () =>
      safetyNumber(
        { address: alice.evm, mldsaPublicKey: new Uint8Array(32) },
        { address: bob.evm, mldsaPublicKey: chainState.get(bob.evm)!.mldsa },
      ),
    (err) => isCourierError(err, "KEY"),
  );
});

test("delivery receipts verify against the recipient's on-chain key and refuse tampering", async () => {
  const http = relayFetch();
  const a = makeClient(alice, http);
  const b = makeClient(bob, http);
  await Promise.all([publishIdentity(a), publishIdentity(b)]);

  // Safety number via client matches both ways.
  assert.equal(await a.safetyNumber(bob.evm), await b.safetyNumber(alice.evm));

  const sent = await a.start(bob.evm, { t: "text", body: "confirm delivery" });
  const bobInbox = await b.receive();
  assert.equal(bobInbox.length, 1);
  assert.equal(bobInbox[0].ok, true);
  if (!bobInbox[0].ok) throw new Error("unreachable");
  assert.equal(bobInbox[0].counter, 0);
  assert.equal(bobInbox[0].ciphertextHash, sent.ciphertextHash);

  // Bob signs and sends a delivery receipt.
  const { receipt } = await b.ack(bobInbox[0]);
  await verifyReceipt(chain, receipt, {
    expectedRecipient: bob.evm,
    expectedConversationId: sent.conversationId,
    expectedCiphertextHash: sent.ciphertextHash,
  });

  // Alice receives, verifies, and keeps the receipt.
  const aliceInbox = await a.receive();
  assert.equal(aliceInbox.length, 1);
  assert.equal(aliceInbox[0].ok, true);
  if (!aliceInbox[0].ok || aliceInbox[0].payload.t !== "receipt") throw new Error("expected receipt");
  assert.equal(aliceInbox[0].payload.ciphertextHash, sent.ciphertextHash);
  assert.equal(aliceInbox[0].payload.counter, 0);
  const kept = a.receiptFor(sent.conversationId, 0);
  assert.ok(kept);
  assert.equal(kept.ciphertextHash, sent.ciphertextHash);
  assert.equal(kept.recipient, bob.evm);
  assert.equal(a.receipts(sent.conversationId).length, 1);

  // Tampering with counter or ciphertextHash fails verification.
  await assert.rejects(
    verifyReceipt(chain, { ...receipt, counter: 1 }),
    (err) => isCourierError(err, "RECEIPT"),
  );
  await assert.rejects(
    verifyReceipt(chain, { ...receipt, ciphertextHash: `0x${"aa".repeat(32)}` }),
    (err) => isCourierError(err, "RECEIPT"),
  );

  // A receipt signed by Carol claiming to be Bob is refused.
  const forged = signReceipt(carol.mldsaSecret, {
    conversationId: sent.conversationId as Hex,
    counter: 0,
    ciphertextHash: sent.ciphertextHash,
    recipient: bob.evm,
  });
  await assert.rejects(verifyReceipt(chain, forged), (err) => isCourierError(err, "RECEIPT"));

  // Sending a forged receipt over the conversation is refused by Alice's client.
  await b.send(sent.conversationId, { t: "receipt", ...forged });
  const refused = await a.receive();
  assert.equal(refused.length, 1);
  assert.equal(refused[0].ok, false);
  if (refused[0].ok) throw new Error("expected refusal");
  assert.equal(refused[0].code, "RECEIPT");
});

test("3-member group exchanges messages and files, and removing a member excludes them from future keys", async () => {
  const http = relayFetch();
  const a = makeClient(alice, http);
  const b = makeClient(bob, http);
  const c = makeClient(carol, http);
  await Promise.all([publishIdentity(a), publishIdentity(b), publishIdentity(c)]);

  // Alice creates a 3-member group.
  const group = await a.createGroup("Haven Core", [bob.evm, carol.evm]);
  assert.equal(group.members.length, 3);
  assert.equal(group.epoch, 1);

  // Bob and Carol receive the group creation.
  const [bInit, cInit] = await Promise.all([b.receive(), c.receive()]);
  assert.equal(bInit[0].ok, true);
  assert.equal(cInit[0].ok, true);
  assert.equal(b.group(group.id)?.name, "Haven Core");
  assert.equal(c.group(group.id)?.members.length, 3);

  // Alice sends a group text and a group file.
  await a.sendGroupText(group.id, "hello team");
  const file1Bytes = new TextEncoder().encode("budget-q1.json");
  await a.sendGroupFile(group.id, "budget-q1.json", file1Bytes);

  const [bMsgs, cMsgs] = await Promise.all([b.receive(), c.receive()]);
  assert.equal(bMsgs.length, 2);
  assert.equal(cMsgs.length, 2);
  assert.equal(bMsgs[0].ok && bMsgs[0].payload.t === "group.text" && bMsgs[0].payload.body, "hello team");
  assert.equal(cMsgs[0].ok && cMsgs[0].payload.t === "group.text" && cMsgs[0].payload.body, "hello team");

  // Both Bob and Carol can fetch and open file 1.
  assert.equal(bMsgs[1].ok && bMsgs[1].payload.t === "group.file", true);
  assert.equal(cMsgs[1].ok && cMsgs[1].payload.t === "group.file", true);
  if (!bMsgs[1].ok || bMsgs[1].payload.t !== "group.file") throw new Error("expected file");
  if (!cMsgs[1].ok || cMsgs[1].payload.t !== "group.file") throw new Error("expected file");
  assert.equal(text.decode(await b.fetchFile(bMsgs[1].payload)), "budget-q1.json");
  const carolOldFilePayload = cMsgs[1].payload;
  assert.equal(text.decode(await c.fetchFile(carolOldFilePayload)), "budget-q1.json");

  // Alice removes Carol from the group.
  const updated = await a.removeGroupMember(group.id, carol.evm);
  assert.equal(updated.epoch, 2);
  assert.deepEqual(updated.members, [alice.evm, bob.evm].sort());

  // Bob receives the removal update; Carol receives nothing.
  const [bUpdate, cUpdate] = await Promise.all([b.receive(), c.receive()]);
  assert.equal(bUpdate.length, 1);
  assert.equal(bUpdate[0].ok, true);
  assert.equal(cUpdate.length, 0);
  assert.equal(b.group(group.id)?.epoch, 2);

  // Alice sends a new message and a new file (with a fresh random 32-byte key).
  await a.sendGroupText(group.id, "after carol left");
  const file2Bytes = new TextEncoder().encode("secret-q2.json");
  await a.sendGroupFile(group.id, "secret-q2.json", file2Bytes);

  const [bAfter, cAfter] = await Promise.all([b.receive(), c.receive()]);
  assert.equal(bAfter.length, 2);
  assert.equal(cAfter.length, 0); // Carol never gets future messages or file keys.
  assert.equal(bAfter[0].ok && bAfter[0].payload.t === "group.text" && bAfter[0].payload.body, "after carol left");
  if (!bAfter[1].ok || bAfter[1].payload.t !== "group.file") throw new Error("expected file 2");
  assert.equal(text.decode(await b.fetchFile(bAfter[1].payload)), "secret-q2.json");

  // Plain honesty: Carol can still open file 1 that she already received, and cannot claw it back.
  assert.equal(text.decode(await c.fetchFile(carolOldFilePayload)), "budget-q1.json");

  // If Carol tries to keep posting to the group, Alice refuses it.
  await c.sendGroupText(group.id, "i am still here");
  const aFromCarol = await a.receive();
  assert.equal(aFromCarol.length, 1);
  assert.equal(aFromCarol[0].ok, false);
  if (aFromCarol[0].ok) throw new Error("expected refusal");
  assert.equal(aFromCarol[0].code, "GROUP");

  // A non-admin member (Bob) cannot remove members or forge a group.state update adding an outsider.
  await assert.rejects(b.removeGroupMember(group.id, alice.evm), (err) => isCourierError(err, "GROUP"));
  const convBA = b.conversations().find((id) => b.peerOf(id) === alice.evm)!;
  await b.send(
    convBA,
    {
      t: "group.state",
      groupId: group.id,
      name: "Hijacked",
      admin: bob.evm,
      epoch: 3,
      members: [alice.evm, bob.evm, dave.evm].sort(),
    },
    group.id,
  );
  const aFromBobState = await a.receive();
  assert.equal(aFromBobState.length, 1);
  assert.equal(aFromBobState[0].ok, false);
  if (aFromBobState[0].ok) throw new Error("expected refusal");
  assert.equal(aFromBobState[0].code, "GROUP");
  assert.equal(a.group(group.id)?.epoch, 2);

  // A group message carrying a stale epoch is refused.
  await b.send(convBA, { t: "group.text", groupId: group.id, epoch: 1, body: "stale epoch" }, group.id);
  const aStale = await a.receive();
  assert.equal(aStale.length, 1);
  assert.equal(aStale[0].ok, false);
  if (aStale[0].ok) throw new Error("expected stale epoch refusal");
  assert.equal(aStale[0].code, "GROUP");
});

test("lying REST proxy swapping a KEM key is refused, and a direct read still works", async () => {
  const UPSTREAM = "https://upstream.test";
  const PROXY_REST = "https://proxy.test/api/rest";
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const b64 = (hex: string) => Buffer.from(hexToBytes(hex as Hex)).toString("base64");

  // A fake QoreChain REST node that answers the KEM registry route from chainState, in the format fetchKemKey reads.
  const upstream: Fetch = (async (input: RequestInfo | URL) => {
    const match = new URL(String(input)).pathname.match(/^\/qorechain\/pqc\/v1\/kem\/([^/]+)$/);
    if (!match) return json({ found: false }, 404);
    const address = decodeURIComponent(match[1]);
    const entry = chainState.get(toEvm(address));
    if (!entry) return json({ found: false }, 404);
    return json({ found: true, key: { address, algorithm_id: "2", public_key: b64(entry.kem), registered_height: "1" } });
  }) as Fetch;

  const honestHandler = createRestProxy({ upstream: UPSTREAM, prefix: "/api/rest", fetch: upstream });
  const honestProxy: Fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    honestHandler(new Request(input, init))) as Fetch;
  // The same real proxy, with its answer for Bob rewritten to Carol's KEM key.
  const lyingProxy: Fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await honestHandler(new Request(input, init));
    const body = (await res.json()) as { found?: boolean; key?: { address: string; public_key: string } };
    if (body.found && body.key && toEvm(body.key.address) === bob.evm) {
      body.key.public_key = b64(chainState.get(carol.evm)!.kem);
    }
    return json(body, res.status);
  }) as Fetch;
  const readerVia = (f: Fetch): ChainReader => ({
    ...chain,
    kemKey: (evm) => kemKeyOverRest(evm, { rest: PROXY_REST, fetch: f }),
  });

  const http = relayFetch();
  const b = makeClient(bob, http);
  await publishIdentity(b);
  await makeClient(alice, http).publishCard();

  // Sanity: the proxy really lies, and the honest proxy really tells the truth.
  assert.notEqual(await kemKeyOverRest(bob.evm, { rest: PROXY_REST, fetch: lyingProxy }), chainState.get(bob.evm)!.kem);
  assert.equal(await kemKeyOverRest(bob.evm, { rest: PROXY_REST, fetch: honestProxy }), chainState.get(bob.evm)!.kem);

  // (a) Through the lying proxy: refused before anything is sealed, and nothing reaches Bob.
  const viaLiar = new CourierClient({ relay: BASE, chain: readerVia(lyingProxy), identity: alice, fetch: http });
  await assert.rejects(
    viaLiar.start(bob.evm, { t: "text", body: "should not seal" }),
    (err) => isCourierError(err, "SENDER_CARD") || isCourierError(err, "IDENTITY_KEM"),
  );
  assert.equal((await b.receive()).length, 0);

  // (b) Through the same proxy when it is honest: works.
  const viaHonest = new CourierClient({ relay: BASE, chain: readerVia(honestProxy), identity: alice, fetch: http });
  await viaHonest.start(bob.evm, { t: "text", body: "honest proxy works" });
  // (c) Direct read, no proxy: works.
  await makeClient(alice, http).start(bob.evm, { t: "text", body: "direct read works" });

  const got = await b.receive();
  assert.equal(got.length, 2);
  assert.deepEqual(
    got.map((r) => (r.ok && r.payload.t === "text" ? r.payload.body : `refused ${r.ok ? "" : r.code}`)),
    ["honest proxy works", "direct read works"],
  );
});

test("forward secrecy: Bob's stolen long-term keys and device storage open none of messages 1..N or the file", async () => {
  const http = relayFetch();
  // Everything posted to Bob's inbox, as a passive observer of the relay would record it.
  const toBob: any[] = [];
  const sniffing: Fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (init?.method === "POST" && path === `/v1/inbox/${bob.evm}` && typeof init.body === "string") {
      toBob.push(JSON.parse(init.body).message);
    }
    return http(input, init);
  }) as Fetch;

  const a = makeClient(alice, sniffing);
  const b = makeClient(bob, sniffing);
  await publishIdentity(a);
  const bobPrekeys = await publishIdentity(b);
  // A copy taken before any handshake: the control below shows the attack works when the one-time secret is still there.
  const beforeAccept = copySecrets(bobPrekeys.secrets);

  const conv = (await a.start(bob.evm, { t: "text", body: "m0" })).conversationId;
  await a.sendText(conv, "m1");
  const fileBytes = new TextEncoder().encode("INV-0042: 1,250 fUSD, payable to the registered payout");
  const fileId = await a.sendFile([conv], "INV-0042.txt", fileBytes);
  await a.sendText(conv, "m3");
  const first = await b.receive();
  assert.deepEqual(first.map((r) => r.ok), [true, true, true, true]);
  const filePayload = first[2].ok && first[2].payload.t === "file" ? first[2].payload : undefined;
  assert.ok(filePayload);
  assert.equal(new TextDecoder().decode(await b.fetchFile(filePayload)), new TextDecoder().decode(fileBytes));
  await b.sendText(conv, "b1");
  await a.receive();
  await a.sendText(conv, "m4");
  assert.equal((await b.receive())[0].ok, true);
  assert.equal(toBob.length, 5);
  const handshake = toBob[0].handshake;
  assert.equal(handshake.oneTimeIndex, 0);

  // Theft after N = 5 messages: Bob's ML-DSA-87 key, identity ML-KEM and X25519 secrets, and his prekey storage as it is now.
  // The public bundle is the original one, so it still hashes to the directory and the handshake signature still verifies.
  const stolen = copySecrets(bobPrekeys.secrets);
  assert.ok(stolen.oneTime[0].kem.every((byte) => byte === 0), "the used one-time ML-KEM secret was erased on accept");
  assert.ok(stolen.oneTime[0].x25519.every((byte) => byte === 0), "the used one-time X25519 secret was erased on accept");
  const thief = makeClient(bob, http);
  thief.usePrekeys({ bundle: bobPrekeys.bundle, secrets: stolen, used: new Set() });
  const results = await thief.receive();
  assert.equal(results.length, 5);

  // The handshake gets past every non-cryptographic check (bundle hash, signature, reuse) and fails in ML-KEM or the AEAD.
  assert.equal(results[0].ok, false);
  if (results[0].ok) throw new Error("unreachable");
  assert.ok(["KEY", "AEAD"].includes(results[0].code), `handshake refused for a cryptographic reason, got ${results[0].code}`);
  // Without the handshake root there is no chain, so the later messages have nothing to open with.
  for (const later of results.slice(1)) {
    assert.equal(later.ok, false);
    if (!later.ok) assert.equal(later.code, "COUNTER");
  }

  // Using each stolen long-term secret directly as a message key or a file key also fails the AEAD.
  const candidates = [
    bob.seal.x25519SecretKey,
    bob.seal.mlkemSecretKey.slice(0, 32),
    bob.mldsaSecret.slice(0, 32),
    stolen.signedPrekey,
    stolen.lastResortKem.slice(0, 32),
  ];
  const hex = (value: string) => Uint8Array.from(Buffer.from(value.slice(2), "hex"));
  const messages: { counter: number; nonce: string; ciphertext: string; kemPublic?: string; kemCiphertext?: string }[] = [
    { counter: 0, nonce: handshake.nonce, ciphertext: handshake.ciphertext },
    ...toBob.slice(1).map((wire) => wire.envelope as Envelope),
  ];
  for (const envelope of messages) {
    const aad = aadBytes(
      alice.evm,
      bob.evm,
      conv,
      envelope.counter,
      envelope.kemPublic ? hex(envelope.kemPublic) : undefined,
      envelope.kemCiphertext ? hex(envelope.kemCiphertext) : undefined,
    );
    for (const key of candidates) {
      assert.throws(() => open(key, hex(envelope.nonce), aad, hex(envelope.ciphertext)), (err) => isCourierError(err, "AEAD"));
    }
  }
  const blob = (await (await http(`${BASE}/v1/files/${fileId}`)).json()) as FileBlob;
  for (const key of candidates) {
    assert.throws(() => openFile(blob, key), (err) => isCourierError(err, "AEAD"));
  }

  // Control: the same attack with a copy taken before the handshake was accepted does open it.
  // So the failure above is caused by the erased one-time secret, not by the test setup.
  const early = makeClient(bob, http);
  early.usePrekeys({ bundle: bobPrekeys.bundle, secrets: beforeAccept, used: new Set() });
  const control = await early.receive();
  assert.equal(control[0].ok && control[0].payload.t === "text" && control[0].payload.body, "m0");
});

test("group message with mismatched or stripped groupId in AAD is refused", async () => {
  const inner = relayFetch();
  // A lying relay that strips groupId from the envelope.
  const stripping: Fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await inner(input, init);
    const url = new URL(String(input));
    if ((init?.method ?? "GET") === "GET" && url.pathname.startsWith("/v1/inbox/") && res.ok) {
      const body = (await res.json()) as { instance: string; items: { seq: number; message: any }[] };
      for (const item of body.items) {
        if (item.message?.type === "message" && item.message.envelope?.groupId) {
          delete item.message.envelope.groupId;
        }
      }
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }
    return res;
  }) as Fetch;

  const a = makeClient(alice, inner);
  const d = makeClient(dave, stripping);
  await Promise.all([publishIdentity(a), publishIdentity(d)]);

  const group = await a.createGroup("AAD Check", [dave.evm]);
  await d.receive(); // handshake succeeds (group.state)
  await a.sendGroupText(group.id, "tampered aad");
  const received = await d.receive();
  assert.equal(received.length, 1);
  assert.equal(received[0].ok, false);
  if (received[0].ok) throw new Error("expected AEAD failure");
  assert.equal(received[0].code, "AEAD");
});
