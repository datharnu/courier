import assert from "node:assert/strict";
import { test } from "node:test";

import { randomBytes } from "@noble/ciphers/utils.js";
import { mlkem1024, mldsa87 } from "@qorechain/pqc";
import { x25519PublicKey } from "@qorechain/qoreseal";
import { bytesToHex } from "viem";

import { CourierError, utf8 } from "../../src/ts/bytes.js";
import { bundleHash, createBundle, type BundleSecrets } from "../../src/ts/bundle.js";
import { acceptHandshake, startHandshake, type HandshakeMessage } from "../../src/ts/handshake.js";
import { type Envelope, type Session } from "../../src/ts/session.js";

/**
 * Courier keeps no skipped-message keys: a message is opened only at the exact next counter,
 * under the exact header it was sealed with. Every refusal below must leave the session unchanged,
 * so the genuine message still opens afterwards.
 */

const NOW = 1_700_000_000;
const ALICE = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const BOB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const text = new TextDecoder();

const aliceMldsa = mldsa87.keygen();
const aliceX = x25519();
const bobX = x25519();
const bobKem = mlkem1024.keygen();
const made = createBundle(bobKem.publicKey, NOW + 3 * 24 * 60 * 60);
const chainHash = bundleHash(made.bundle);

function x25519(): { secret: Uint8Array; publicKey: Uint8Array } {
  const secret = randomBytes(32);
  return { secret, publicKey: x25519PublicKey(secret) };
}

function copySecrets(source: BundleSecrets): BundleSecrets {
  return {
    signedPrekey: source.signedPrekey.slice(),
    lastResortKem: source.lastResortKem.slice(),
    oneTime: source.oneTime.map((entry) => ({ kem: entry.kem.slice(), x25519: entry.x25519.slice() })),
  };
}

function code(run: () => unknown): string {
  try {
    run();
  } catch (err) {
    if (err instanceof CourierError) return err.code;
    throw err;
  }
  throw new Error("did not refuse");
}

/** Flips the low bit of byte `index` (counting from 0 after the `0x`). */
function flipByte(hex: string, index: number): string {
  const at = 2 + index * 2;
  const byte = Number.parseInt(hex.slice(at, at + 2), 16) ^ 0x01;
  return hex.slice(0, at) + byte.toString(16).padStart(2, "0") + hex.slice(at + 2);
}

function byteLength(hex: string): number {
  return (hex.length - 2) / 2;
}

function start(index: number | null, kemEvery = 20) {
  return startHandshake({
    sender: { address: ALICE, mldsaSecret: aliceMldsa.secretKey.slice(), identityX25519Secret: aliceX.secret.slice() },
    recipient: { address: BOB, identityX25519Public: bobX.publicKey },
    bundle: made.bundle,
    chainHash,
    registryKem: made.bundle.identityKem,
    oneTimeIndex: index,
    now: NOW,
    plaintext: utf8("hello"),
    kemEvery,
  });
}

function take(handshake: HandshakeMessage, secrets: BundleSecrets, used: Set<number>, kemEvery = 20) {
  return acceptHandshake({
    handshake,
    bundle: made.bundle,
    secrets,
    recipientIdentityX25519Secret: bobX.secret.slice(),
    senderMldsaPublic: aliceMldsa.publicKey,
    senderCardX25519: bytesToHex(aliceX.publicKey),
    chainHash,
    registryKem: made.bundle.identityKem,
    now: NOW,
    used,
    kemEvery,
  });
}

function pair(index: number | null, kemEvery = 20): { alice: Session; bob: Session } {
  const started = start(index, kemEvery);
  const accepted = take(started.handshake, copySecrets(made.secrets), new Set(), kemEvery);
  assert.equal(text.decode(accepted.plaintext), "hello");
  return { alice: started.session, bob: accepted.session };
}

function opens(session: Session, envelope: Envelope): string {
  return text.decode(session.receive(envelope));
}

test("out-of-order messages are refused without moving the session, then open in order", () => {
  const { alice, bob } = pair(0);
  const sent = ["m0", "m1", "m2", "m3"].map((body) => bob.send(utf8(body)));
  assert.equal(code(() => alice.receive(sent[3])), "COUNTER");
  assert.equal(code(() => alice.receive(sent[1])), "COUNTER");
  assert.equal(code(() => alice.receive(sent[2])), "COUNTER");
  assert.equal(opens(alice, sent[0]), "m0");
  assert.equal(code(() => alice.receive(sent[2])), "COUNTER", "a skipped counter is not cached for later");
  assert.equal(opens(alice, sent[1]), "m1");
  assert.equal(opens(alice, sent[2]), "m2");
  assert.equal(opens(alice, sent[3]), "m3");
});

test("a dropped message stalls the direction: later messages are refused until it arrives", () => {
  const { alice, bob } = pair(1);
  const lost = bob.send(utf8("lost"));
  const later = [bob.send(utf8("later 1")), bob.send(utf8("later 2"))];
  for (const envelope of later) assert.equal(code(() => alice.receive(envelope)), "COUNTER");
  // The other direction is independent and keeps working.
  assert.equal(opens(bob, alice.send(utf8("still here"))), "still here");
  assert.equal(opens(alice, lost), "lost");
  assert.equal(opens(alice, later[0]), "later 1");
});

test("duplicated and replayed messages are refused, however late they arrive", () => {
  const { alice, bob } = pair(2);
  const first = bob.send(utf8("first"));
  assert.equal(opens(alice, first), "first");
  assert.equal(code(() => alice.receive(first)), "COUNTER", "an immediate duplicate");
  assert.equal(code(() => alice.receive({ ...first })), "COUNTER", "a copied duplicate");
  for (let i = 0; i < 5; i++) assert.equal(opens(alice, bob.send(utf8(`n${i}`))), `n${i}`);
  assert.equal(code(() => alice.receive(first)), "COUNTER", "a replay after later messages");
  // Rewriting the counter of a replay to the expected one gets past the counter check and fails the tag.
  assert.equal(code(() => alice.receive({ ...first, counter: 6 })), "AEAD");
  assert.equal(opens(alice, bob.send(utf8("next"))), "next");
});

test("a message replayed into another conversation, or reflected to its sender, is refused", () => {
  const one = pair(3);
  const two = pair(4);
  const fromOne = one.bob.send(utf8("for conversation one"));
  assert.equal(code(() => two.alice.receive(fromOne)), "AEAD");
  assert.equal(opens(one.alice, fromOne), "for conversation one");

  const { alice, bob } = pair(5);
  const own = alice.send(utf8("mine"));
  // Alice expects counter 0 from Bob; her own counter-1 message is refused under the other direction's keys.
  assert.equal(code(() => alice.receive({ ...own, counter: 0 })), "AEAD");
  assert.equal(opens(bob, own), "mine");
});

test("a replayed rekeying message is refused after the KEM step completed", () => {
  const { alice, bob } = pair(6);
  alice.markCopied();
  const offer = alice.send(utf8("offer"));
  assert.ok(offer.kemPublic);
  assert.equal(opens(bob, offer), "offer");
  const reply = bob.send(utf8("reply"));
  assert.ok(reply.kemCiphertext);
  assert.equal(opens(alice, reply), "reply");
  assert.equal(code(() => alice.receive(reply)), "COUNTER");
  // With the counter forced to the expected one, the offering secret is gone, so the step cannot run twice.
  assert.equal(code(() => alice.receive({ ...reply, counter: 1 })), "KEM_STEP");
  assert.equal(code(() => bob.receive(offer)), "COUNTER");
  assert.equal(opens(bob, alice.send(utf8("after"))), "after");
});

test("counters that are not the next safe integer are refused", () => {
  const { alice, bob } = pair(7);
  const envelope = bob.send(utf8("x"));
  for (const counter of [-1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, 2 ** 32]) {
    assert.equal(code(() => alice.receive({ ...envelope, counter })), "COUNTER", `counter ${counter}`);
  }
  assert.equal(opens(alice, envelope), "x");
});

test("flipping the low bit of any ciphertext or nonce byte is refused, and the genuine message still opens", () => {
  const { alice, bob } = pair(8);
  const envelope = bob.send(utf8("pay INV-0007"));
  for (let i = 0; i < byteLength(envelope.ciphertext); i++) {
    assert.equal(code(() => alice.receive({ ...envelope, ciphertext: flipByte(envelope.ciphertext, i) })), "AEAD", `ciphertext byte ${i}`);
  }
  for (let i = 0; i < byteLength(envelope.nonce); i++) {
    assert.equal(code(() => alice.receive({ ...envelope, nonce: flipByte(envelope.nonce, i) })), "AEAD", `nonce byte ${i}`);
  }
  assert.equal(opens(alice, envelope), "pay INV-0007");
});

test("truncated, extended, or malformed ciphertext and nonces are refused", () => {
  const { alice, bob } = pair(9);
  const envelope = bob.send(utf8("short"));
  const c = envelope.ciphertext;
  assert.equal(code(() => alice.receive({ ...envelope, ciphertext: c.slice(0, -2) })), "AEAD", "one byte cut");
  assert.equal(code(() => alice.receive({ ...envelope, ciphertext: `${c}00` })), "AEAD", "one byte added");
  assert.equal(code(() => alice.receive({ ...envelope, ciphertext: c.slice(0, 2 + 15 * 2) })), "AEAD", "shorter than a tag");
  assert.equal(code(() => alice.receive({ ...envelope, ciphertext: c.toUpperCase().replace("0X", "0x") })), "BUNDLE_SHAPE");
  assert.equal(code(() => alice.receive({ ...envelope, ciphertext: c.slice(0, -1) })), "BUNDLE_SHAPE", "odd length");
  assert.equal(code(() => alice.receive({ ...envelope, nonce: envelope.nonce.slice(0, -2) })), "BUNDLE_SHAPE");
  assert.equal(opens(alice, envelope), "short");
});

test("tampered, stripped, or added header fields are refused", () => {
  const { alice, bob } = pair(10);
  const plain = bob.send(utf8("plain"));
  const groupId = `0x${"42".repeat(32)}`;
  assert.equal(code(() => alice.receive({ ...plain, groupId })), "AEAD", "a groupId added to a direct message");
  assert.equal(opens(alice, plain), "plain");

  // A message that offers a fresh ML-KEM key binds that key in its AAD.
  bob.markCopied();
  const offer = bob.send(utf8("offer"));
  assert.ok(offer.kemPublic);
  const { kemPublic, ...stripped } = offer;
  assert.equal(code(() => alice.receive(stripped)), "AEAD", "offered key stripped");
  for (const i of [0, 100, byteLength(kemPublic!) - 1]) {
    assert.equal(code(() => alice.receive({ ...offer, kemPublic: flipByte(kemPublic!, i) })), "AEAD", `offered key byte ${i}`);
  }
  assert.equal(opens(alice, offer), "offer");

  // The reply carries an ML-KEM ciphertext to that key. Tampering with it changes the shared secret (implicit rejection).
  const reply = alice.send(utf8("reply"));
  assert.ok(reply.kemCiphertext);
  const { kemCiphertext, ...noCiphertext } = reply;
  assert.equal(code(() => bob.receive(noCiphertext)), "AEAD", "KEM ciphertext stripped");
  for (const i of [0, 777, byteLength(kemCiphertext!) - 1]) {
    assert.equal(code(() => bob.receive({ ...reply, kemCiphertext: flipByte(kemCiphertext!, i) })), "AEAD", `KEM ciphertext byte ${i}`);
  }
  assert.equal(code(() => bob.receive({ ...reply, kemCiphertext: kemCiphertext!.slice(0, -2) })), "BUNDLE_SHAPE");
  assert.equal(opens(bob, reply), "reply", "the offering secret survived every refused attempt");
});

test("group-bound messages refuse a swapped or stripped groupId", () => {
  const { alice, bob } = pair(11);
  const groupId = `0x${"07".repeat(32)}`;
  const envelope = bob.send(utf8("to the group"), groupId);
  assert.equal(code(() => alice.receive({ ...envelope, groupId: `0x${"08".repeat(32)}` })), "AEAD");
  const { groupId: _dropped, ...stripped } = envelope;
  void _dropped;
  assert.equal(code(() => alice.receive(stripped)), "AEAD");
  assert.equal(opens(alice, envelope), "to the group");
});

test("tampering with any signed field of the first message is refused before the one-time entry is used", () => {
  const started = start(12);
  const genuine = started.handshake;
  const secrets = copySecrets(made.secrets);
  const used = new Set<number>();
  const hexFields = ["ephemeralPublic", "kemCiphertext", "nonce", "ciphertext", "senderIdentityX25519"] as const;
  for (const field of hexFields) {
    const tampered = { ...genuine, [field]: flipByte(genuine[field], 0) };
    assert.equal(code(() => take(tampered, secrets, used)), "SIGNATURE", field);
  }
  assert.equal(code(() => take({ ...genuine, oneTimeIndex: 13 }, secrets, used)), "SIGNATURE", "oneTimeIndex");
  assert.equal(code(() => take({ ...genuine, groupId: `0x${"01".repeat(32)}` }, secrets, used)), "SIGNATURE", "groupId added");
  assert.equal(code(() => take({ ...genuine, signature: flipByte(genuine.signature, 0) }, secrets, used)), "SIGNATURE");
  assert.equal(code(() => take({ ...genuine, bundleHash: flipByte(genuine.bundleHash, 0) }, secrets, used)), "BUNDLE_HASH");
  assert.equal(used.size, 0, "no refused attempt consumed the one-time entry");
  assert.ok(secrets.oneTime[12].kem.some((byte) => byte !== 0), "and its secret was not wiped");

  const accepted = take(genuine, secrets, used);
  assert.equal(text.decode(accepted.plaintext), "hello");
  assert.equal(code(() => take(genuine, secrets, used)), "ONE_TIME_REUSED", "a replayed first message is refused");
});
