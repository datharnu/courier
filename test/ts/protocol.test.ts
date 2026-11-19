import assert from "node:assert/strict";
import { test } from "node:test";

import { randomBytes } from "@noble/ciphers/utils.js";
import { mlkem1024, mldsa87 } from "@qorechain/pqc";
import { x25519PublicKey } from "@qorechain/qoreseal";
import { bytesToHex } from "viem";

import { canonical, CourierError, utf8 } from "../../src/ts/bytes.js";
import { bundleHash, createBundle, type BundleSecrets } from "../../src/ts/bundle.js";
import { aadBytes, freshNonce, peek, seal } from "../../src/ts/crypto.js";
import { openFile, sealFile } from "../../src/ts/file.js";
import { acceptHandshake, startHandshake, type HandshakeMessage } from "../../src/ts/handshake.js";
import { type Session } from "../../src/ts/session.js";

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

function code(run: () => void): string {
  try {
    run();
  } catch (err) {
    if (err instanceof CourierError) return err.code;
    throw err;
  }
  throw new Error("did not refuse");
}

function flip(hex: string): string {
  const alphabet = "0123456789abcdef";
  const last = alphabet.indexOf(hex[hex.length - 1]);
  return hex.slice(0, -1) + alphabet[(last + 1) % 16];
}

function start(index: number | null, kemEvery = 20) {
  return startHandshake({
    sender: {
      address: ALICE,
      mldsaSecret: aliceMldsa.secretKey.slice(),
      identityX25519Secret: aliceX.secret.slice(),
    },
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

function take(
  handshake: HandshakeMessage,
  secrets: BundleSecrets,
  used: Set<number>,
  kemEvery = 20,
  recipientSecret = bobX.secret.slice(),
  senderCard = bytesToHex(aliceX.publicKey),
) {
  return acceptHandshake({
    handshake,
    bundle: made.bundle,
    secrets,
    recipientIdentityX25519Secret: recipientSecret,
    senderMldsaPublic: aliceMldsa.publicKey,
    senderCardX25519: senderCard,
    chainHash,
    registryKem: made.bundle.identityKem,
    now: NOW,
    used,
    kemEvery,
  });
}

function pair(index: number | null, kemEvery = 20): { alice: Session; bob: Session } {
  const secrets = copySecrets(made.secrets);
  const started = start(index, kemEvery);
  const accepted = take(started.handshake, secrets, new Set(), kemEvery);
  assert.equal(text.decode(accepted.plaintext), "hello");
  return { alice: started.session, bob: accepted.session };
}

test("canonical json sorts keys and does not add spaces", () => {
  assert.equal(canonical({ b: 1, a: { d: 1, c: 2 } }), '{"a":{"c":2,"d":1},"b":1}');
});

test("a second bundle rotates the signed prekey", () => {
  const other = createBundle(bobKem.publicKey, NOW + 4 * 24 * 60 * 60);
  assert.notEqual(other.bundle.signedPrekey, made.bundle.signedPrekey);
  assert.notEqual(bundleHash(other.bundle), chainHash);
});

test("a swapped registry key, a bad bundle hash, and an expired bundle are refused", () => {
  const args = {
    sender: {
      address: ALICE,
      mldsaSecret: aliceMldsa.secretKey.slice(),
      identityX25519Secret: aliceX.secret.slice(),
    },
    recipient: { address: BOB, identityX25519Public: bobX.publicKey },
    bundle: made.bundle,
    chainHash,
    registryKem: made.bundle.identityKem,
    oneTimeIndex: 0 as number | null,
    now: NOW,
    plaintext: utf8("hello"),
  };
  assert.equal(code(() => startHandshake({ ...args, registryKem: `0x${"22".repeat(1568)}` })), "IDENTITY_KEM");
  assert.equal(code(() => startHandshake({ ...args, chainHash: `0x${"11".repeat(32)}` })), "BUNDLE_HASH");
  assert.equal(code(() => startHandshake({ ...args, now: made.bundle.expiry + 1 })), "BUNDLE_EXPIRED");
});

test("a bad signature does not consume the one-time entry", () => {
  const started = start(1);
  const secrets = copySecrets(made.secrets);
  const used = new Set<number>();
  const bad = { ...started.handshake, signature: flip(started.handshake.signature) };
  assert.equal(code(() => take(bad, secrets, used)), "SIGNATURE");
  assert.equal(used.size, 0);
  assert.equal(text.decode(take(started.handshake, secrets, used).plaintext), "hello");
  assert.equal(used.has(1), true);
});

test("the wrong sender card is refused before the one-time entry is consumed", () => {
  const started = start(2);
  const secrets = copySecrets(made.secrets);
  const used = new Set<number>();
  assert.equal(code(() => take(started.handshake, secrets, used, 20, bobX.secret.slice(), bytesToHex(bobX.publicKey))), "SENDER_CARD");
  assert.equal(used.size, 0);
  assert.equal(text.decode(take(started.handshake, secrets, used).plaintext), "hello");
});

test("a one-time entry opens the first handshake and refuses the second", () => {
  const first = start(3);
  const second = start(3);
  const secrets = copySecrets(made.secrets);
  const used = new Set<number>();
  const accepted = take(first.handshake, secrets, used);
  assert.equal(text.decode(accepted.plaintext), "hello");
  assert.equal(code(() => take(second.handshake, secrets, used)), "ONE_TIME_REUSED");
  assert.equal(text.decode(accepted.session.receive(first.session.send(utf8("still here")))), "still here");
  assert.ok(secrets.oneTime[3].kem.every((byte) => byte === 0));
  used.delete(3);
  const again = code(() => take(second.handshake, secrets, used));
  assert.ok(again === "AEAD" || again === "KEY");
});

test("the last-resort prekey can open a second handshake, and it is not wiped", () => {
  const secrets = copySecrets(made.secrets);
  const used = new Set<number>();
  const first = start(null);
  const second = start(null);
  assert.equal(text.decode(take(first.handshake, secrets, used).plaintext), "hello");
  assert.equal(text.decode(take(second.handshake, secrets, used).plaintext), "hello");
  assert.ok(secrets.lastResortKem.some((byte) => byte !== 0));
});

test("replay, a skipped counter, and a swapped sender all fail", () => {
  const { alice, bob } = pair(4);
  const once = bob.send(utf8("once"));
  assert.equal(text.decode(alice.receive(once)), "once");
  assert.equal(code(() => alice.receive(once)), "COUNTER");

  const { alice: alice2, bob: bob2 } = pair(5);
  const stay = bob2.send(utf8("stay"));
  const skipped = { ...stay, counter: stay.counter + 1 };
  assert.equal(code(() => alice2.receive(skipped)), "COUNTER");
  assert.equal(text.decode(alice2.receive(stay)), "stay");

  const { alice: alice3, bob: bob3 } = pair(6);
  const chain = alice3.recvChainForTest();
  const next = peek(chain);
  const nonce = freshNonce();
  const swapped = seal(
    next.key,
    nonce,
    aadBytes(alice3.self, alice3.peer, alice3.conversationId, 0),
    utf8("nope"),
  );
  next.key.fill(0);
  assert.equal(
    code(() => alice3.receive({ counter: 0, nonce: bytesToHex(nonce), ciphertext: bytesToHex(swapped) })),
    "AEAD",
  );
  assert.equal(text.decode(alice3.receive(bob3.send(utf8("yes")))), "yes");
});

test("identity keys do not open the handshake or a file sent inside it", () => {
  const started = start(7);
  const wrong = copySecrets(made.secrets);
  wrong.oneTime[7].kem.set(bobKem.secretKey);
  wrong.oneTime[7].x25519.set(bobX.secret);
  wrong.signedPrekey.set(bobX.secret);
  assert.equal(code(() => take(started.handshake, wrong, new Set())), "AEAD");

  const { alice, bob } = pair(8);
  const sealed = sealFile(utf8("a short file"));
  const message = utf8(canonical({ hash: sealed.blob.hash, key: bytesToHex(sealed.key), type: "file" }));
  sealed.key.fill(0);
  const opened = JSON.parse(text.decode(bob.receive(alice.send(message)))) as { key: string };
  assert.equal(text.decode(openFile(sealed.blob, bytesToHexBytes(opened.key))), "a short file");
  assert.equal(code(() => openFile(sealed.blob, bobKem.secretKey.slice(0, 32))), "AEAD");
});

test("the 20th message in a direction offers a fresh KEM key", () => {
  const { alice, bob } = pair(9);
  for (let i = 1; i <= 19; i++) {
    const envelope = alice.send(utf8(String(i)));
    if (i < 19) assert.equal(envelope.kemPublic, undefined);
    else assert.equal(envelope.kemPublic?.length, 2 + 1568 * 2);
    assert.equal(text.decode(bob.receive(envelope)), String(i));
  }
});

test("a copy from before the offering secret stops at the reply", () => {
  const { alice, bob } = pair(10);
  const before = alice.clone();
  alice.markCopied();
  const offer = alice.send(utf8("offer"));
  assert.ok(offer.kemPublic);
  const holding = alice.clone();
  assert.equal(text.decode(bob.receive(offer)), "offer");
  const reply = bob.send(utf8("reply"));
  assert.ok(reply.kemCiphertext);
  assert.ok(reply.kemPublic, "an offer without a ciphertext gets a counter-offer");
  const flipped = { ...reply, ciphertext: flip(reply.ciphertext) };
  assert.equal(code(() => alice.receive(flipped)), "AEAD");
  assert.equal(code(() => before.receive(reply)), "KEM_STEP");
  assert.equal(text.decode(holding.receive({ ...reply })), "reply");
  assert.equal(text.decode(alice.receive(reply)), "reply");
  const back = alice.send(utf8("back"));
  assert.ok(back.kemCiphertext, "the offerer's direction is rekeyed on its next send");
  assert.equal(back.kemPublic, undefined, "a ciphertext-carrying reply does not start another round");
  assert.equal(text.decode(bob.receive(back)), "back");
  const newer = bob.send(utf8("newer"));
  assert.equal(newer.kemCiphertext, undefined);
  assert.equal(text.decode(alice.receive(newer)), "newer");
  assert.equal(code(() => before.receive(newer)), "COUNTER");
});

test("messages already in flight survive a KEM step the other way", () => {
  const { alice, bob } = pair(11);
  alice.markCopied();
  const a1 = alice.send(utf8("a1"));
  const a2 = alice.send(utf8("a2"));
  assert.equal(text.decode(bob.receive(a1)), "a1");
  const b1 = bob.send(utf8("b1"));
  assert.ok(b1.kemCiphertext);
  assert.equal(text.decode(bob.receive(a2)), "a2");
  const a3 = alice.send(utf8("a3"));
  assert.equal(text.decode(alice.receive(b1)), "b1");
  assert.equal(text.decode(bob.receive(a3)), "a3");
  const a4 = alice.send(utf8("a4"));
  assert.ok(a4.kemCiphertext);
  assert.equal(text.decode(bob.receive(a4)), "a4");
});

test("both sides sending at once, with a KEM step every 3 messages, never lose a message", () => {
  const { alice, bob } = pair(12, 3);
  const toBob: ReturnType<Session["send"]>[] = [];
  const toAlice: ReturnType<Session["send"]>[] = [];
  let seed = 7;
  const next = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return (seed >>> 16) % 4;
  };
  let sent = 0;
  let steps = 0;
  for (let round = 0; round < 120; round++) {
    const move = next();
    if (move === 0) toBob.push(alice.send(utf8(`a${sent++}`)));
    if (move === 1) toAlice.push(bob.send(utf8(`b${sent++}`)));
    if (move === 2 && toBob.length > 0) {
      const envelope = toBob.shift()!;
      if (envelope.kemCiphertext) steps++;
      assert.match(text.decode(bob.receive(envelope)), /^a\d+$/);
    }
    if (move === 3 && toAlice.length > 0) {
      const envelope = toAlice.shift()!;
      if (envelope.kemCiphertext) steps++;
      assert.match(text.decode(alice.receive(envelope)), /^b\d+$/);
    }
  }
  while (toBob.length > 0) bob.receive(toBob.shift()!);
  while (toAlice.length > 0) alice.receive(toAlice.shift()!);
  assert.ok(steps >= 4, `expected several completed KEM steps, saw ${steps}`);
});

function bytesToHexBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.slice(2).match(/../g)!.map((byte) => Number.parseInt(byte, 16)));
}
