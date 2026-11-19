import { pqSign, pqVerify } from "@qorechain/qoresign";
import { encodeInvoice } from "haven-pq-kit";
import { SIG_LEN, TESTNET } from "haven-pq-kit/network";
import { bytesToHex, hexToBytes, keccak256, type Address, type Hex } from "viem";

import { CourierError } from "./bytes.js";
import { type ChainReader } from "./chain.js";

/** fUSD on qorechain-diana. 6 decimals. Steward's gate holds a different balance of the same token. */
export const FUSD = "0x97143B771D34ddb9130b807b135Ae675A5a963CA";
/** The PayGate an invoice is signed for. MemoPay does not call it. */
export const STEWARD_GATE = "0xb0c44d0a628c4593314a5c3c113d27f2d1842a05";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const WORD = /^0x[0-9a-fA-F]{64}$/;
const AMOUNT = /^[1-9][0-9]{0,77}$/;

/** The vendor-signed invoice Steward already understands, plus the memo text that produced `memoHash`. */
export type Invoice = {
  gate: string;
  vendor: string;
  payee: string;
  token: string;
  amount: string;
  invoiceId: string;
  dueDate: number;
  memoHash: string;
  memo: string;
  vendorSig: string;
};

/** keccak256 of the memo text. This is the hash inside the vendor's signature, not the ciphertext hash. */
export function memoHashOf(memo: string): Hex {
  return keccak256(new TextEncoder().encode(memo));
}

/** keccak256 of the ciphertext bytes. This is the hash MemoPay stores. It is not the hash of the memo. */
export function ciphertextHash(ciphertext: string): Hex {
  if (!/^0x[0-9a-fA-F]*$/.test(ciphertext) || ciphertext.length % 2 !== 0) {
    throw new CourierError("INVOICE", "ciphertext is not hex");
  }
  return keccak256(ciphertext as Hex);
}

export function checkInvoice(invoice: Invoice): void {
  if (!invoice || typeof invoice !== "object") throw new CourierError("INVOICE", "the invoice is missing");
  for (const field of ["gate", "vendor", "payee", "token"] as const) {
    if (!ADDRESS.test(invoice[field] ?? "")) throw new CourierError("INVOICE", `${field} is not an address`);
  }
  if (!WORD.test(invoice.invoiceId ?? "")) throw new CourierError("INVOICE", "invoiceId is not 32 bytes");
  if (!WORD.test(invoice.memoHash ?? "")) throw new CourierError("INVOICE", "memoHash is not 32 bytes");
  if (typeof invoice.vendorSig !== "string" || (invoice.vendorSig.length - 2) / 2 !== SIG_LEN || !/^0x[0-9a-fA-F]+$/.test(invoice.vendorSig)) {
    throw new CourierError("INVOICE", "the vendor signature is not an ML-DSA-87 signature");
  }
  if (typeof invoice.amount !== "string" || !AMOUNT.test(invoice.amount)) {
    throw new CourierError("INVOICE", "the amount is not a positive integer");
  }
  const amount = BigInt(invoice.amount);
  if (amount > 2n ** 256n - 1n) throw new CourierError("INVOICE", "the amount does not fit a uint256");
  if (!Number.isSafeInteger(invoice.dueDate) || invoice.dueDate < 0) {
    throw new CourierError("INVOICE", "the due date is not a unix second");
  }
  if (typeof invoice.memo !== "string" || invoice.memo.length === 0 || invoice.memo.length > 2048) {
    throw new CourierError("INVOICE", "the memo is empty or longer than 2048 characters");
  }
  if (memoHashOf(invoice.memo).toLowerCase() !== invoice.memoHash.toLowerCase()) {
    throw new CourierError("INVOICE", "the memo is not the one that was signed");
  }
}

/** Sign the invoice with the vendor's ML-DSA-87 key. The signed bytes are `VendorSig.encode`. */
export function signInvoice(secretKey: Uint8Array, invoice: Omit<Invoice, "vendorSig" | "memoHash">): Invoice {
  const memoHash = memoHashOf(invoice.memo);
  const message = encodeInvoice({
    chainId: BigInt(TESTNET.evmChainId),
    gate: invoice.gate as Address,
    vendor: invoice.vendor as Address,
    payee: invoice.payee as Address,
    token: invoice.token as Address,
    amount: BigInt(invoice.amount),
    invoiceId: invoice.invoiceId as Hex,
    dueDate: BigInt(invoice.dueDate),
    memoHash,
  });
  const signed: Invoice = { ...invoice, memoHash, vendorSig: bytesToHex(pqSign(secretKey, hexToBytes(message))) };
  checkInvoice(signed);
  return signed;
}

/** The memo matches its hash, and the signature matches the vendor's current on-chain key. */
export async function verifyInvoice(chain: ChainReader, invoice: Invoice): Promise<void> {
  checkInvoice(invoice);
  if (chain.chainId !== TESTNET.chainId) throw new CourierError("INVOICE", "invoices are signed for qorechain-diana");
  const message = encodeInvoice({
    chainId: BigInt(TESTNET.evmChainId),
    gate: invoice.gate as Address,
    vendor: invoice.vendor as Address,
    payee: invoice.payee as Address,
    token: invoice.token as Address,
    amount: BigInt(invoice.amount),
    invoiceId: invoice.invoiceId as Hex,
    dueDate: BigInt(invoice.dueDate),
    memoHash: invoice.memoHash as Hex,
  });
  let key: Uint8Array;
  try {
    key = await chain.mldsaKey(invoice.vendor);
  } catch (error) {
    throw new CourierError("INVOICE", error instanceof Error ? error.message : "the vendor has no ML-DSA key on chain");
  }
  if (!pqVerify(key, hexToBytes(message), hexToBytes(invoice.vendorSig as Hex))) {
    throw new CourierError("INVOICE", "the vendor signature does not match the on-chain key");
  }
}
