import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { bytesToHex, type Hex } from "viem";

import { canonical } from "../../src/ts/bytes.js";
import { aadBytes, SALT } from "../../src/ts/crypto.js";
import { conversationOf } from "../../src/ts/handshake.js";
import { encodeReceipt, RECEIPT_DOMAIN } from "../../src/ts/receipt.js";
import { MLDSA_PUBLIC_BYTES, safetyNumber } from "../../src/ts/safety.js";

const vectors = JSON.parse(readFileSync(new URL("../../vectors/protocol.json", import.meta.url), "utf8"));

test("pinned protocol test vectors match exact byte outputs", () => {
  assert.equal(bytesToHex(SALT), vectors.salt);
  assert.equal(RECEIPT_DOMAIN, vectors.receiptDomain);
  assert.equal(canonical(vectors.canonicalInput), vectors.canonicalExpected);

  assert.equal(
    conversationOf(
      vectors.conversation.sender,
      vectors.conversation.recipient,
      vectors.conversation.bundleHash,
      vectors.conversation.ephemeralPublic,
    ),
    vectors.conversation.expected,
  );

  assert.equal(
    bytesToHex(
      aadBytes(
        vectors.aad1to1.sender,
        vectors.aad1to1.recipient,
        vectors.aad1to1.conversationId,
        vectors.aad1to1.counter,
      ),
    ),
    vectors.aad1to1.expected,
  );

  assert.equal(
    bytesToHex(
      aadBytes(
        vectors.aadGroup.sender,
        vectors.aadGroup.recipient,
        vectors.aadGroup.conversationId,
        vectors.aadGroup.counter,
        undefined,
        undefined,
        vectors.aadGroup.groupId,
      ),
    ),
    vectors.aadGroup.expected,
  );

  assert.equal(
    encodeReceipt({
      chainId: BigInt(vectors.receipt.chainId),
      conversationId: vectors.receipt.conversationId as Hex,
      counter: vectors.receipt.counter,
      ciphertextHash: vectors.receipt.ciphertextHash as Hex,
      recipient: vectors.receipt.recipient,
    }),
    vectors.receipt.expected,
  );

  const keyA = new Uint8Array(MLDSA_PUBLIC_BYTES).fill(vectors.safety.leftKeyFill);
  const keyB = new Uint8Array(MLDSA_PUBLIC_BYTES).fill(vectors.safety.rightKeyFill);
  assert.equal(
    safetyNumber(
      { address: vectors.safety.leftAddress, mldsaPublicKey: keyA },
      { address: vectors.safety.rightAddress, mldsaPublicKey: keyB },
    ),
    vectors.safety.expected,
  );
  // Symmetry check on the pinned vector.
  assert.equal(
    safetyNumber(
      { address: vectors.safety.rightAddress, mldsaPublicKey: keyB },
      { address: vectors.safety.leftAddress, mldsaPublicKey: keyA },
    ),
    vectors.safety.expected,
  );
});
