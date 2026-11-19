import { writeFileSync } from "node:fs";
import { REGISTER_KEM_KEY_TYPE_URL } from "@qorechain/sdk";
import {
  ALGORITHM_ML_KEM_1024,
  envelopeSize,
  open,
  signRecipientCard,
  validateMlkemPublicKey,
} from "@qorechain/qoreseal";
import { fetchKemKey, sealToAddresses } from "@qorechain/qoreseal/network";
import { classicalKeyFromPrivate } from "@qorechain/qoresign";
import { hexToBytes, type Hex } from "viem";
import { CHAIN_ID, broadcast, loadAccount, loadSealKeys } from "../../haven-pq-kit/scripts/accounts.ts";
import { TESTNET } from "../../haven-pq-kit/src/ts/network.ts";

const SENDER = "spike";
const RECIPIENT = "steward-vendor";
const PURPOSE = "courier.spike.v1";

function same(a: Uint8Array | undefined, b: Uint8Array): boolean {
  return a !== undefined && a.length === b.length && a.every((byte, i) => byte === b[i]);
}

async function main(): Promise<void> {
  const sender = await loadAccount(SENDER);
  const recipient = await loadAccount(RECIPIENT);
  const senderKeys = loadSealKeys(SENDER);
  const recipientKeys = loadSealKeys(RECIPIENT);
  validateMlkemPublicKey(senderKeys.mlkemPublicKey);
  validateMlkemPublicKey(recipientKeys.mlkemPublicKey);

  const senderOnChain = await fetchKemKey({ rest: TESTNET.rest, address: sender.cosmos });
  if (!same(senderOnChain.publicKey, senderKeys.mlkemPublicKey)) {
    throw new Error(`sender KEM on chain does not match the key derived for ${SENDER}`);
  }

  let publishHash = "";
  const before = await fetchKemKey({ rest: TESTNET.rest, address: recipient.cosmos });
  if (before.registered && !same(before.publicKey, recipientKeys.mlkemPublicKey)) {
    throw new Error(`${recipient.cosmos} already publishes a different KEM key`);
  }
  if (!before.registered) {
    publishHash = await broadcast(
      recipient,
      [
        {
          typeUrl: REGISTER_KEM_KEY_TYPE_URL,
          value: {
            sender: recipient.cosmos,
            algorithmId: ALGORITHM_ML_KEM_1024,
            publicKey: recipientKeys.mlkemPublicKey,
          },
        },
      ],
      "hybrid",
    );
  }

  const after = await fetchKemKey({ rest: TESTNET.rest, address: recipient.cosmos });
  if (!after.registered || !same(after.publicKey, recipientKeys.mlkemPublicKey)) {
    throw new Error("recipient KEM read-back does not match the published key");
  }

  const card = signRecipientCard({
    chainId: CHAIN_ID,
    address: recipient.cosmos,
    keys: recipientKeys,
    classicalKey: classicalKeyFromPrivate(hexToBytes(recipient.privateKey as Hex), "eth_secp256k1"),
    pqKey: { secretKey: recipient.pqc.secretKey },
  });
  const plaintext = new TextEncoder().encode("courier spike: only the vendor can open this");
  const envelope = await sealToAddresses({
    rest: TESTNET.rest,
    chainId: CHAIN_ID,
    purpose: PURPOSE,
    recipients: [{ address: recipient.cosmos, card }],
    plaintext,
  });
  const opened = open({ chainId: CHAIN_ID, purpose: PURPOSE, envelope, keys: recipientKeys });
  if (!same(opened, plaintext)) throw new Error("opened plaintext does not match");

  let senderCouldOpen = false;
  try {
    open({ chainId: CHAIN_ID, purpose: PURPOSE, envelope, keys: senderKeys });
    senderCouldOpen = true;
  } catch {
    senderCouldOpen = false;
  }
  if (senderCouldOpen) throw new Error("the sender opened an envelope sealed to the vendor");

  const expected = envelopeSize({ mode: "hybrid", recipients: 1, plaintextLength: plaintext.length });
  const report = {
    sender: sender.cosmos,
    recipient: recipient.cosmos,
    senderKemBytes: senderOnChain.publicKey?.length ?? 0,
    recipientKemBytes: after.publicKey?.length ?? 0,
    publishHash,
    plaintextBytes: plaintext.length,
    envelopeBytes: envelope.length,
    envelopeSizeFormula: expected,
    textBytes: `qoreseal:${Buffer.from(envelope).toString("base64url")}`.length,
    senderCouldOpen,
  };
  writeFileSync("deployments/spike-seal.json", `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
