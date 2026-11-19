import assert from "node:assert/strict";
import { test } from "node:test";

import { deriveUnifiedAccount, generateMnemonic } from "@qorechain/sdk";
import { keccak256, toBytes, type Hex } from "viem";

import { CourierError } from "../../src/ts/bytes.js";
import { toEvm, type ChainReader } from "../../src/ts/chain.js";
import {
  FUSD,
  STEWARD_GATE,
  checkInvoice,
  ciphertextHash,
  memoHashOf,
  signInvoice,
  verifyInvoice,
  type Invoice,
} from "../../src/ts/invoice.js";

const memo = "Pay the registered payout.";

function draft(vendor: string, extra?: Partial<Invoice>): Omit<Invoice, "vendorSig" | "memoHash"> {
  return {
    gate: STEWARD_GATE,
    vendor,
    payee: vendor,
    token: FUSD,
    amount: "10000",
    invoiceId: keccak256(toBytes("inv")),
    dueDate: 1_800_000_000,
    memo,
    ...extra,
  };
}

test("the ciphertext hash is not the hash of the memo", () => {
  const cipher = `0x${"ab".repeat(32)}` as Hex;
  assert.equal(ciphertextHash(cipher), keccak256(cipher));
  assert.notEqual(ciphertextHash(cipher), memoHashOf(memo));
});

test("a memo that was swapped is refused before anyone pays", () => {
  const invoice = { ...draft("0x" + "11".repeat(20)), memoHash: memoHashOf(memo), vendorSig: `0x${"ab".repeat(4627)}`, memo: "Pay a different address." };
  assert.throws(() => checkInvoice(invoice), (error: unknown) => error instanceof CourierError && error.code === "INVOICE");
});

test("an amount with a leading zero is refused", () => {
  const invoice = { ...draft("0x" + "11".repeat(20)), amount: "01", memoHash: memoHashOf(memo), vendorSig: `0x${"ab".repeat(4627)}` };
  assert.throws(() => checkInvoice(invoice as Invoice), (error: unknown) => error instanceof CourierError && error.code === "INVOICE");
});

test("a signed invoice verifies under the vendor's key and fails under another", async () => {
  const vendor = await deriveUnifiedAccount(generateMnemonic(256));
  const other = await deriveUnifiedAccount(generateMnemonic(256));
  const chain: ChainReader = {
    chainId: "qorechain-diana",
    async mldsaKey() {
      return vendor.pqc.publicKey;
    },
    async kemKey() {
      throw new Error("unused");
    },
    async directory() {
      throw new Error("unused");
    },
    async now() {
      return 0;
    },
  };
  const vendorEvm = toEvm(vendor.evm);
  const invoice = signInvoice(vendor.pqc.secretKey, draft(vendorEvm));
  await verifyInvoice(chain, invoice);
  const forged = signInvoice(other.pqc.secretKey, draft(vendorEvm));
  await assert.rejects(verifyInvoice(chain, forged), (error: unknown) => error instanceof CourierError && error.code === "INVOICE");
});
