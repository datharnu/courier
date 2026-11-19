import { mlkem1024 } from "@qorechain/pqc";
import { x25519Agree, x25519PublicKey } from "@qorechain/qoreseal";
import { pqSign, pqVerify } from "@qorechain/qoresign";
import { randomBytes } from "@noble/ciphers/utils.js";
import { keccak256, toBytes } from "viem";

import { bytes, canonical, CourierError, utf8, wipe } from "./bytes.js";
import { bundleHash, expectAddress, expectKey, type Bundle, type BundleSecrets } from "./bundle.js";
import {
  aadBytes,
  freshNonce,
  handshakeRoot,
  open,
  peek,
  seal,
  splitRoot,
  X25519_BYTES,
} from "./crypto.js";
import { KEM_EVERY, Session } from "./session.js";

export type HandshakeMessage = {
  sender: string;
  recipient: string;
  bundleHash: string;
  senderIdentityX25519: string;
  ephemeralPublic: string;
  kemCiphertext: string;
  oneTimeIndex: number | null;
  nonce: string;
  ciphertext: string;
  signature: string;
};

/** The ephemeral key keeps two last-resort handshakes between the same pair apart. */
export function conversationOf(sender: string, recipient: string, bundleHashHex: string, ephemeralPublic: string): string {
  return keccak256(toBytes(canonical({ bundleHash: bundleHashHex, ephemeralPublic, recipient, sender })));
}

export function startHandshake(args: {
  sender: { address: string; mldsaSecret: Uint8Array; identityX25519Secret: Uint8Array };
  recipient: { address: string; identityX25519Public: Uint8Array };
  bundle: Bundle;
  chainHash: string;
  registryKem: string;
  oneTimeIndex: number | null;
  now: number;
  plaintext: Uint8Array;
  kemEvery?: number;
}): { handshake: HandshakeMessage; session: Session } {
  const sender = expectAddress(args.sender.address);
  const recipient = expectAddress(args.recipient.address);
  checkBundle(args.bundle, args.chainHash, args.registryKem, args.now);
  const index = checkIndex(args.oneTimeIndex);
  const target = encapsulationTarget(args.bundle, index);
  const ephemeralSecret = randomBytes(X25519_BYTES);
  try {
    const ephemeralPublic = bytes(x25519PublicKey(ephemeralSecret));
    const encapsulated = mlkem1024.encapsulate(fromHex(target));
    const kemShared = bytes(encapsulated.sharedSecret);
    const kemCiphertext = bytes(encapsulated.cipherText);
    wipe(encapsulated.sharedSecret);
    const terms = [
      agree(args.sender.identityX25519Secret, fromHex(args.bundle.signedPrekey)),
      agree(ephemeralSecret, args.recipient.identityX25519Public),
      agree(ephemeralSecret, fromHex(args.bundle.signedPrekey)),
    ];
    if (index !== null) terms.push(agree(ephemeralSecret, fromHex(args.bundle.oneTime[index].x25519)));
    terms.push(kemShared);
    const chains = splitRoot(handshakeRoot(terms));
    const first = peek(chains.aToB.chain);
    const conversationId = conversationOf(sender, recipient, args.chainHash, bytesToHex(ephemeralPublic));
    const nonce = freshNonce();
    const senderCard = bytesToHex(x25519PublicKey(args.sender.identityX25519Secret));
    const body: Omit<HandshakeMessage, "signature"> = {
      sender,
      recipient,
      bundleHash: args.chainHash,
      senderIdentityX25519: senderCard,
      ephemeralPublic: bytesToHex(ephemeralPublic),
      kemCiphertext: bytesToHex(kemCiphertext),
      oneTimeIndex: index,
      nonce: bytesToHex(nonce),
      ciphertext: bytesToHex(seal(first.key, nonce, aadBytes(sender, recipient, conversationId, 0), args.plaintext)),
    };
    wipe(first.key);
    wipe(chains.aToB.chain);
    const signature = pqSign(args.sender.mldsaSecret, transcript(body));
    const session = Session.create({
      self: sender,
      peer: recipient,
      conversationId,
      kemEvery: args.kemEvery ?? KEM_EVERY,
      sendRoot: chains.aToB.root,
      recvRoot: chains.bToA.root,
      sendChain: first.next,
      recvChain: chains.bToA.chain,
      sendN: 1,
      recvN: 0,
    });
    return { handshake: { ...body, signature: bytesToHex(signature) }, session };
  } finally {
    wipe(ephemeralSecret);
  }
}

export function acceptHandshake(args: {
  handshake: HandshakeMessage;
  bundle: Bundle;
  secrets: BundleSecrets;
  recipientIdentityX25519Secret: Uint8Array;
  senderMldsaPublic: Uint8Array;
  senderCardX25519: string;
  chainHash: string;
  registryKem: string;
  now: number;
  used: Set<number>;
  kemEvery?: number;
}): { plaintext: Uint8Array; session: Session } {
  const handshake = args.handshake;
  const sender = expectAddress(handshake.sender);
  const recipient = expectAddress(handshake.recipient);
  checkBundle(args.bundle, args.chainHash, args.registryKem, args.now);
  if (handshake.bundleHash !== args.chainHash) {
    throw new CourierError("BUNDLE_HASH", "handshake names a different bundle");
  }
  const index = checkIndex(handshake.oneTimeIndex);
  if (index !== null && args.used.has(index)) {
    throw new CourierError("ONE_TIME_REUSED", "this one-time entry was already accepted");
  }
  if (!pqVerify(args.senderMldsaPublic, transcript(handshake), fromHex(handshake.signature))) {
    throw new CourierError("SIGNATURE", "the first message signature does not check");
  }
  if (handshake.senderIdentityX25519 !== args.senderCardX25519) {
    throw new CourierError("SENDER_CARD", "the sender's card is not the key that was signed");
  }
  expectKey(args.senderCardX25519, X25519_BYTES, "sender card");
  encapsulationTarget(args.bundle, index);
  const kemCiphertext = fromHex(handshake.kemCiphertext);
  const ephemeralPublic = fromHex(handshake.ephemeralPublic);
  const senderCard = fromHex(handshake.senderIdentityX25519);
  const kemSecret = index === null ? args.secrets.lastResortKem : args.secrets.oneTime[index].kem;
  let kemShared: Uint8Array;
  try {
    kemShared = bytes(mlkem1024.decapsulate(kemSecret, kemCiphertext));
  } catch {
    throw new CourierError("KEY", "ML-KEM decapsulation failed");
  }
  const terms = [
    agree(args.secrets.signedPrekey, senderCard),
    agree(args.recipientIdentityX25519Secret, ephemeralPublic),
    agree(args.secrets.signedPrekey, ephemeralPublic),
  ];
  if (index !== null) terms.push(agree(args.secrets.oneTime[index].x25519, ephemeralPublic));
  terms.push(kemShared);
  const chains = splitRoot(handshakeRoot(terms));
  const first = peek(chains.aToB.chain);
  const conversationId = conversationOf(sender, recipient, args.chainHash, handshake.ephemeralPublic);
  const nonce = fromHex(handshake.nonce);
  let plaintext: Uint8Array;
  try {
    plaintext = open(
      first.key,
      nonce,
      aadBytes(sender, recipient, conversationId, 0),
      fromHex(handshake.ciphertext),
    );
  } catch (err) {
    wipe(first.key);
    wipe(first.next);
    for (const value of [chains.aToB.root, chains.aToB.chain, chains.bToA.root, chains.bToA.chain]) wipe(value);
    if (err instanceof CourierError) throw err;
    throw new CourierError("AEAD", "first message tag failed");
  }
  wipe(first.key);
  wipe(chains.aToB.chain);
  if (index !== null) {
    args.used.add(index);
    wipe(args.secrets.oneTime[index].kem);
    wipe(args.secrets.oneTime[index].x25519);
  }
  const session = Session.create({
    self: recipient,
    peer: sender,
    conversationId,
    kemEvery: args.kemEvery ?? KEM_EVERY,
    sendRoot: chains.bToA.root,
    recvRoot: chains.aToB.root,
    sendChain: chains.bToA.chain,
    recvChain: first.next,
    sendN: 0,
    recvN: 1,
  });
  return { plaintext, session };
}

function checkBundle(bundle: Bundle, chainHash: string, registryKem: string, now: number): void {
  const hash = bundleHash(bundle);
  if (hash !== chainHash) throw new CourierError("BUNDLE_HASH", "bundle does not match the chain");
  if (bundle.identityKem !== registryKem) {
    throw new CourierError("IDENTITY_KEM", "bundle KEM key is not the registry key");
  }
  if (!Number.isSafeInteger(now) || bundle.expiry < now) {
    throw new CourierError("BUNDLE_EXPIRED", "bundle is past its expiry");
  }
}

function checkIndex(index: number | null): number | null {
  if (index === null) return null;
  if (!Number.isInteger(index) || index < 0 || index > 19) {
    throw new CourierError("ONE_TIME_INDEX", "one-time index is not 0..19");
  }
  return index;
}

function encapsulationTarget(bundle: Bundle, index: number | null): string {
  const target = index === null ? bundle.lastResortKem : bundle.oneTime[index].kem;
  if (target === bundle.identityKem) {
    throw new CourierError("IDENTITY_KEM", "the identity key is not an encapsulation target");
  }
  return target;
}

function transcript(message: Omit<HandshakeMessage, "signature">): Uint8Array {
  return utf8(
    canonical({
      bundleHash: message.bundleHash,
      ciphertext: message.ciphertext,
      ephemeralPublic: message.ephemeralPublic,
      kemCiphertext: message.kemCiphertext,
      nonce: message.nonce,
      oneTimeIndex: message.oneTimeIndex,
      recipient: message.recipient,
      sender: message.sender,
      senderIdentityX25519: message.senderIdentityX25519,
      v: 1,
    }),
  );
}

function agree(secret: Uint8Array, publicKey: Uint8Array): Uint8Array {
  try {
    return bytes(x25519Agree(secret, publicKey));
  } catch {
    throw new CourierError("KEY", "X25519 agreement failed");
  }
}

function fromHex(value: string): Uint8Array {
  const checked = expectKey(value, (value.length - 2) / 2, "hex");
  const out = new Uint8Array((checked.length - 2) / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(checked.slice(2 + i * 2, 4 + i * 2), 16);
  return out;
}

function bytesToHex(value: Uint8Array): string {
  let out = "0x";
  for (const byte of value) out += byte.toString(16).padStart(2, "0");
  return out;
}
