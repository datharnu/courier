import { sha256 } from "@noble/hashes/sha2.js";
import { hexToBytes } from "viem";

import { concat, CourierError, utf8 } from "./bytes.js";
import { toEvm, type ChainReader } from "./chain.js";

/** ML-DSA-87 public key length in bytes. */
export const MLDSA_PUBLIC_BYTES = 2592;
/** Iterations of SHA-256 per party, modelled on Signal's numeric fingerprint spec (using SHA-256). */
export const SAFETY_ITERATIONS = 5200;

const VERSION = utf8("courier.safety.v1");

/**
 * 30-digit numeric fingerprint for one account's ML-DSA-87 public key,
 * computed by iterating SHA-256 over the version tag, address, and public key.
 */
export function fingerprint(address: string, mldsaPublicKey: Uint8Array): string {
  const evm = toEvm(address);
  if (!(mldsaPublicKey instanceof Uint8Array) || mldsaPublicKey.length !== MLDSA_PUBLIC_BYTES) {
    throw new CourierError("KEY", `ML-DSA-87 public key must be ${MLDSA_PUBLIC_BYTES} bytes`);
  }
  const addrBytes = hexToBytes(evm as `0x${string}`);
  let digest = sha256(concat(VERSION, mldsaPublicKey, addrBytes));
  for (let i = 1; i < SAFETY_ITERATIONS; i++) {
    digest = sha256(concat(digest, mldsaPublicKey));
  }
  // 6 chunks of 5 bytes -> each 40-bit big-endian integer mod 100_000 -> 30 digits.
  let digits = "";
  for (let chunk = 0; chunk < 6; chunk++) {
    const offset = chunk * 5;
    const value =
      BigInt(digest[offset]) * 0x100000000n +
      BigInt(digest[offset + 1]) * 0x1000000n +
      BigInt(digest[offset + 2]) * 0x10000n +
      BigInt(digest[offset + 3]) * 0x100n +
      BigInt(digest[offset + 4]);
    digits += (value % 100000n).toString().padStart(5, "0");
  }
  return digits;
}

/**
 * Symmetric 60-digit safety number derived from both accounts' ML-DSA-87 keys,
 * formatted as 12 groups of 5 digits. Both sides always compute the same value.
 */
export function safetyNumber(
  left: { address: string; mldsaPublicKey: Uint8Array },
  right: { address: string; mldsaPublicKey: Uint8Array },
): string {
  const a = fingerprint(left.address, left.mldsaPublicKey);
  const b = fingerprint(right.address, right.mldsaPublicKey);
  const combined = a <= b ? a + b : b + a;
  return combined.match(/.{1,5}/g)!.join(" ");
}

/** Reads both accounts' current on-chain ML-DSA-87 keys and computes their shared safety number. */
export async function safetyNumberFor(chain: ChainReader, addressA: string, addressB: string): Promise<string> {
  const [keyA, keyB] = await Promise.all([chain.mldsaKey(addressA), chain.mldsaKey(addressB)]);
  return safetyNumber({ address: addressA, mldsaPublicKey: keyA }, { address: addressB, mldsaPublicKey: keyB });
}
