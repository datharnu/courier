import { mlkem1024 } from "@qorechain/pqc";
import { x25519PublicKey } from "@qorechain/qoreseal";
import { randomBytes } from "@noble/ciphers/utils.js";
import { bytesToHex, keccak256, toBytes } from "viem";

import { bytes, canonical, CourierError, wipe } from "./bytes.js";
import { KEM_PUBLIC_BYTES, X25519_BYTES } from "./crypto.js";

export const ONE_TIME_KEYS = 20;
export const MAX_BUNDLE_TTL = 7 * 24 * 60 * 60;

export type OneTimePublic = { kem: string; x25519: string };

export type Bundle = {
  expiry: number;
  identityKem: string;
  lastResortKem: string;
  oneTime: OneTimePublic[];
  signedPrekey: string;
};

export type BundleSecrets = {
  signedPrekey: Uint8Array;
  lastResortKem: Uint8Array;
  oneTime: { kem: Uint8Array; x25519: Uint8Array }[];
};

export function bundleHash(bundle: Bundle): string {
  validateBundle(bundle);
  return keccak256(toBytes(canonical(bundle)));
}

export function validateBundle(bundle: Bundle): void {
  if (!Number.isSafeInteger(bundle.expiry) || bundle.expiry <= 0) {
    throw new CourierError("BUNDLE_SHAPE", "expiry is not a unix second");
  }
  const identity = expectKey(bundle.identityKem, KEM_PUBLIC_BYTES, "identity KEM");
  const lastResort = expectKey(bundle.lastResortKem, KEM_PUBLIC_BYTES, "last-resort KEM");
  expectKey(bundle.signedPrekey, X25519_BYTES, "signed prekey");
  if (lastResort === identity) {
    throw new CourierError("IDENTITY_KEM", "the last-resort key is the identity key");
  }
  if (!Array.isArray(bundle.oneTime) || bundle.oneTime.length !== ONE_TIME_KEYS) {
    throw new CourierError("BUNDLE_SHAPE", `a bundle has ${ONE_TIME_KEYS} one-time keys`);
  }
  const seen = new Set<string>([identity, lastResort]);
  for (const entry of bundle.oneTime) {
    const kem = expectKey(entry.kem, KEM_PUBLIC_BYTES, "one-time KEM");
    expectKey(entry.x25519, X25519_BYTES, "one-time X25519");
    if (kem === identity) throw new CourierError("IDENTITY_KEM", "a one-time key is the identity key");
    if (seen.has(kem)) throw new CourierError("BUNDLE_SHAPE", "a one-time KEM key is repeated");
    seen.add(kem);
  }
}

/** A fresh signed prekey, a fresh last-resort KEM key, and 20 one-time entries. */
export function createBundle(identityKemPublic: Uint8Array, expiry: number): { bundle: Bundle; secrets: BundleSecrets } {
  const signed = x25519Pair();
  const lastResort = mlkem1024.keygen();
  const oneTime: OneTimePublic[] = [];
  const oneTimeSecrets: BundleSecrets["oneTime"] = [];
  for (let i = 0; i < ONE_TIME_KEYS; i++) {
    const kem = mlkem1024.keygen();
    const x = x25519Pair();
    oneTime.push({ kem: bytesToHex(kem.publicKey), x25519: bytesToHex(x.publicKey) });
    oneTimeSecrets.push({ kem: bytes(kem.secretKey), x25519: x.secret });
    wipe(kem.secretKey);
  }
  const bundle: Bundle = {
    expiry,
    identityKem: bytesToHex(identityKemPublic),
    lastResortKem: bytesToHex(lastResort.publicKey),
    oneTime,
    signedPrekey: bytesToHex(signed.publicKey),
  };
  validateBundle(bundle);
  return {
    bundle,
    secrets: {
      signedPrekey: signed.secret,
      lastResortKem: bytes(lastResort.secretKey),
      oneTime: oneTimeSecrets,
    },
  };
}

export function expectKey(value: string, byteLength: number, label: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/.test(value) || value.length !== 2 + byteLength * 2) {
    throw new CourierError("BUNDLE_SHAPE", `${label} is not ${byteLength} lowercase hex bytes`);
  }
  return value;
}

export function expectAddress(value: string): string {
  if (!/^0x[0-9a-f]{40}$/.test(value)) throw new CourierError("ADDRESS", "address is not a lowercase 0x string");
  return value;
}

function x25519Pair(): { secret: Uint8Array; publicKey: Uint8Array } {
  const secret = randomBytes(X25519_BYTES);
  return { secret, publicKey: bytes(x25519PublicKey(secret)) };
}
