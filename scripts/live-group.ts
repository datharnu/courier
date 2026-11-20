import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { classicalKeyFromPrivate } from "@qorechain/qoresign";
import {
  bytesToHex,
  encodeFunctionData,
  hexToBytes,
  keccak256,
  toFunctionSelector,
  type Address,
  type Hex,
} from "viem";

import { bundleHash, type Bundle, type BundleSecrets } from "../src/ts/bundle.js";
import { testnetReader, toEvm } from "../src/ts/chain.js";
import { CourierClient, type Identity, type Received } from "../src/ts/client.js";
import { createRelay } from "../src/ts/relay.js";
import { evmClient, loadAccount, loadSealKeys, sendScopedContractTx, withEvmWindow } from "./lib/chain.js";
import { prekeyPath, writePrivate } from "./lib/secrets.js";
import { serve } from "./lib/serve.js";

const ADMIN = "spike";
const MEMBER = "steward-vendor";
const REMOVED = "courier-carol";
const PORT = 8790;
const REPORT = "deployments/live-group.json";
const RECEIPT_CAP_UQOR = "2000000";
const ALREADY_RECORDED = toFunctionSelector("AlreadyRecorded(bytes32)");

const RECEIPT_ABI = [
  {
    type: "function",
    name: "record",
    stateMutability: "nonpayable",
    inputs: [
      { name: "conversationId", type: "bytes32" },
      { name: "counter", type: "uint256" },
      { name: "ciphertextHash", type: "bytes32" },
      { name: "recipient", type: "address" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "receipt",
    stateMutability: "view",
    inputs: [
      { name: "conversationId", type: "bytes32" },
      { name: "counter", type: "uint256" },
      { name: "ciphertextHash", type: "bytes32" },
      { name: "recipient", type: "address" },
    ],
    outputs: [
      { name: "submitter", type: "address" },
      { name: "recordedAt", type: "uint256" },
    ],
  },
] as const;

type StoredPrekeys = {
  owner: string;
  bundleHash: string;
  expiry: number;
  signedPrekey: string;
  lastResortKem: string;
  oneTime: { kem: string; x25519: string }[];
  used: number[];
};

type Step = { step: string; result: string[] };

async function identity(name: string): Promise<Identity> {
  const account = await loadAccount(name);
  return {
    cosmos: account.cosmos,
    evm: toEvm(account.evm),
    mldsaSecret: account.pqc.secretKey,
    classicalKey: classicalKeyFromPrivate(hexToBytes(account.privateKey as Hex), "eth_secp256k1"),
    seal: loadSealKeys(name),
  };
}

function loadPrekeys(name: string): { stored: StoredPrekeys; secrets: BundleSecrets; used: Set<number> } {
  const stored = JSON.parse(readFileSync(prekeyPath(name), "utf8")) as StoredPrekeys;
  const bytes = (hex: string) => (hex ? hexToBytes(hex as Hex) : new Uint8Array());
  return {
    stored,
    secrets: {
      signedPrekey: bytes(stored.signedPrekey),
      lastResortKem: bytes(stored.lastResortKem),
      oneTime: stored.oneTime.map((entry) => ({ kem: bytes(entry.kem), x25519: bytes(entry.x25519) })),
    },
    used: new Set(stored.used),
  };
}

/** A consumed entry's secrets are erased from the file too, not only from memory. */
function savePrekeys(name: string, stored: StoredPrekeys, used: Set<number>): void {
  const next: StoredPrekeys = {
    ...stored,
    used: [...used].sort((a, b) => a - b),
    oneTime: stored.oneTime.map((entry, i) => (used.has(i) ? { kem: "", x25519: "" } : entry)),
  };
  writePrivate(prekeyPath(name), `${JSON.stringify(next, null, 2)}\n`);
}

function summary(items: Received[]): string[] {
  return items.map((item) => {
    if (!item.ok) return `refused ${item.code}`;
    if (item.payload.t === "text") return `text "${item.payload.body}"`;
    if (item.payload.t === "file") return `file ${item.payload.name} (${item.payload.size} bytes)`;
    if (item.payload.t === "invoice") return `invoice ${item.payload.invoiceId}`;
    if (item.payload.t === "receipt") return `receipt #${item.payload.counter}`;
    return `${item.payload.t} ${item.payload.groupId.slice(0, 10)}`;
  });
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function revertData(error: unknown): string {
  const err = error as { data?: string; cause?: { data?: string; cause?: { data?: string } } };
  return err.cause?.data ?? err.cause?.cause?.data ?? err.data ?? "no revert data";
}

async function main(): Promise<void> {
  if (existsSync(REPORT)) {
    throw new Error("already ran; delete the report only if the user agrees");
  }
  const { directory } = JSON.parse(readFileSync("deployments/prekey-directory.json", "utf8")) as { directory: string };
  const receiptsFile = JSON.parse(readFileSync("deployments/delivery-receipts.json", "utf8")) as {
    deliveryReceipts?: Address;
  };
  if (!receiptsFile.deliveryReceipts) throw new Error("run npm run deploy:receipts first");
  const deliveryReceipts = receiptsFile.deliveryReceipts;
  const chain = testnetReader({ client: evmClient(), directory });
  const client = evmClient();
  const domain = `127.0.0.1:${PORT}`;
  const server = await serve(createRelay({ chain, domain, uri: `http://${domain}` }), PORT);
  const relay = `http://${domain}`;

  const steps: Step[] = [];
  let durable = false;
  const report: Record<string, unknown> = {
    network: chain.chainId,
    ranAt: new Date().toISOString(),
    relay: "in-process, real HTTP on 127.0.0.1, state in memory",
    directory,
    deliveryReceipts,
    steps,
    ok: false,
  };

  try {
    const admin = await identity(ADMIN);
    const member = await identity(MEMBER);
    const removed = await identity(REMOVED);
    const memberKeys = loadPrekeys(MEMBER);
    const removedKeys = loadPrekeys(REMOVED);
    const memberBundle = JSON.parse(readFileSync(`deployments/bundles/${MEMBER}.json`, "utf8")) as Bundle;
    const removedBundle = JSON.parse(readFileSync(`deployments/bundles/${REMOVED}.json`, "utf8")) as Bundle;

    for (const [name, who, bundle, stored] of [
      [MEMBER, member, memberBundle, memberKeys.stored],
      [REMOVED, removed, removedBundle, removedKeys.stored],
    ] as const) {
      const onChain = await chain.directory(who.evm);
      if (bundleHash(bundle) !== onChain.hash || stored.bundleHash !== onChain.hash || !onChain.live) {
        throw new Error(`the local bundle is not the one on chain; run npm run deploy:directory -- ${name}`);
      }
    }

    const spike = new CourierClient({ relay, chain, identity: admin });
    const vendor = new CourierClient({ relay, chain, identity: member });
    const carol = new CourierClient({ relay, chain, identity: removed });
    await spike.publishCard();
    await vendor.publishCard();
    await carol.publishCard();
    vendor.usePrekeys({ bundle: memberBundle, secrets: memberKeys.secrets, used: memberKeys.used });
    carol.usePrekeys({ bundle: removedBundle, secrets: removedKeys.secrets, used: removedKeys.used });
    await vendor.publishBundle();
    await carol.publishBundle();

    const file1 = new TextEncoder().encode('{"milestone":1,"note":"sealed deliverable"}');
    const file2 = new TextEncoder().encode('{"milestone":2,"note":"after removal"}');

    const group = await spike.createGroup("Haven demo", [member.evm, removed.evm]);
    const vendorState = await vendor.receive();
    savePrekeys(MEMBER, memberKeys.stored, memberKeys.used);
    durable = true;
    const carolState = await carol.receive();
    savePrekeys(REMOVED, removedKeys.stored, removedKeys.used);
    expect(vendorState.length === 1 && stateOf(vendorState[0], 1, 3), "vendor did not open the group");
    expect(carolState.length === 1 && stateOf(carolState[0], 1, 3), "carol did not open the group");
    steps.push({ step: "spike creates a three-member group", result: [...summary(vendorState), ...summary(carolState)] });

    await spike.sendGroupText(group.id, "Milestone 1 is ready for review.");
    const vendorText = await vendor.receive();
    savePrekeys(MEMBER, memberKeys.stored, memberKeys.used);
    const carolText = await carol.receive();
    savePrekeys(REMOVED, removedKeys.stored, removedKeys.used);
    expect(textOf(vendorText, "Milestone 1 is ready for review."), "vendor did not get the group text");
    expect(textOf(carolText, "Milestone 1 is ready for review."), "carol did not get the group text");
    steps.push({ step: "spike sends a group message", result: [...summary(vendorText), ...summary(carolText)] });

    const sent1 = await spike.sendGroupFile(group.id, "milestone-1.json", file1);
    const vendorFile = await vendor.receive();
    savePrekeys(MEMBER, memberKeys.stored, memberKeys.used);
    const carolFile = await carol.receive();
    savePrekeys(REMOVED, removedKeys.stored, removedKeys.used);
    expect(await fileOf(vendor, vendorFile, file1), "vendor could not open the first file");
    expect(await fileOf(carol, carolFile, file1), "carol could not open the first file");
    steps.push({ step: "spike sends a group file", result: ["opened, hash matches", "opened, hash matches"] });

    const acked = vendorText[0];
    expect(acked.ok, "the acked message was refused");
    const { receipt } = await vendor.ack(acked);
    const spikeReceipt = await spike.receive();
    expect(
      spikeReceipt.length === 1 && spikeReceipt[0].ok && spikeReceipt[0].payload.t === "receipt",
      "spike did not receive the receipt",
    );
    expect(spike.receiptFor(acked.conversationId, acked.counter), "spike did not keep the receipt");

    const flipped = hexToBytes(receipt.signature);
    flipped[100] ^= 0x01;
    const recordArgs = [
      receipt.conversationId,
      BigInt(receipt.counter),
      receipt.ciphertextHash,
      receipt.recipient as Address,
    ] as const;
    const { result, openHash, closeHash } = await withEvmWindow(
      ADMIN,
      { txs: 1, maxValueUqor: RECEIPT_CAP_UQOR, targets: [deliveryReceipts], blocks: 200 },
      async (account) => {
        let refusedTampered = "accepted";
        try {
          await client.call({
            account: admin.evm as Address,
            to: deliveryReceipts,
            data: encodeFunctionData({
              abi: RECEIPT_ABI,
              functionName: "record",
              args: [...recordArgs, bytesToHex(flipped)],
            }),
          });
        } catch (error) {
          refusedTampered = revertData(error);
        }
        if (refusedTampered === "accepted") throw new Error("a tampered receipt signature was accepted");
        const recordHash = await sendScopedContractTx({
          account,
          to: deliveryReceipts,
          data: encodeFunctionData({
            abi: RECEIPT_ABI,
            functionName: "record",
            args: [...recordArgs, receipt.signature],
          }),
        });
        const mined = await client.waitForTransactionReceipt({ hash: recordHash });
        return { recordHash, gasUsed: Number(mined.gasUsed), refusedTampered };
      },
    );

    const [submitter, recordedAt] = await client.readContract({
      address: deliveryReceipts,
      abi: RECEIPT_ABI,
      functionName: "receipt",
      args: recordArgs,
    });
    expect(Number(recordedAt) > 0, "the receipt was not stored");
    expect(submitter.toLowerCase() === admin.evm, "the receipt submitter is not spike");
    let refusedDuplicate = "accepted";
    try {
      await client.call({
        account: admin.evm as Address,
        to: deliveryReceipts,
        data: encodeFunctionData({
          abi: RECEIPT_ABI,
          functionName: "record",
          args: [...recordArgs, receipt.signature],
        }),
      });
    } catch (error) {
      refusedDuplicate = revertData(error);
    }
    if (!refusedDuplicate.startsWith(ALREADY_RECORDED)) {
      throw new Error(`a second record was not AlreadyRecorded: ${refusedDuplicate}`);
    }
    report.receipt = {
      conversationId: receipt.conversationId,
      counter: receipt.counter,
      ciphertextHash: receipt.ciphertextHash,
      recipient: receipt.recipient,
      openHash,
      recordHash: result.recordHash,
      gasUsed: result.gasUsed,
      closeHash,
      readBack: { submitter: submitter.toLowerCase(), recordedAt: Number(recordedAt) },
      refusedTamperedSignature: result.refusedTampered,
      refusedDuplicate,
    };
    steps.push({ step: "the vendor signs a receipt and spike records it", result: summary(spikeReceipt) });

    const removedGroup = await spike.removeGroupMember(group.id, removed.evm);
    const vendorUpdate = await vendor.receive();
    savePrekeys(MEMBER, memberKeys.stored, memberKeys.used);
    const carolUpdate = await carol.receive();
    savePrekeys(REMOVED, removedKeys.stored, removedKeys.used);
    expect(removedGroup.epoch === 2 && !removedGroup.members.includes(removed.evm), "carol is still a member");
    expect(
      vendorUpdate.length === 1 &&
        vendorUpdate[0].ok &&
        vendorUpdate[0].payload.t === "group.state" &&
        vendorUpdate[0].payload.epoch === 2 &&
        !vendorUpdate[0].payload.members.map((addr) => toEvm(addr)).includes(removed.evm),
      "vendor did not record the removal",
    );
    expect(carolUpdate.length === 0, "carol was sent the removal");
    steps.push({ step: "spike removes carol", result: summary(vendorUpdate) });

    await spike.sendGroupText(group.id, "Carol has left.");
    const sent2 = await spike.sendGroupFile(group.id, "milestone-2.json", file2);
    const vendorAfter = await vendor.receive();
    savePrekeys(MEMBER, memberKeys.stored, memberKeys.used);
    const carolAfter = await carol.receive();
    savePrekeys(REMOVED, removedKeys.stored, removedKeys.used);
    expect(vendorAfter.length === 2 && textOf([vendorAfter[0]], "Carol has left."), "vendor missed the message after removal");
    expect(await fileOf(vendor, [vendorAfter[1]], file2), "vendor could not open the second file");
    expect(carolAfter.length === 0, "carol received a message after removal");
    steps.push({ step: "spike sends a message and a file after the removal", result: ["opened, hash matches"] });

    await carol.sendGroupText(group.id, "I am still here.");
    const spikeFromCarol = await spike.receive();
    const vendorFromCarol = await vendor.receive();
    savePrekeys(MEMBER, memberKeys.stored, memberKeys.used);
    expect(refusedGroup(spikeFromCarol), "spike accepted carol's post");
    expect(refusedGroup(vendorFromCarol), "vendor accepted carol's post");
    steps.push({
      step: "carol posts after being removed",
      result: [...summary(spikeFromCarol), ...summary(vendorFromCarol)],
    });

    const conversationIds: Record<string, string> = {};
    for (const id of spike.conversations()) conversationIds[spike.peerOf(id)] = id;
    report.members = {
      admin: { name: ADMIN, cosmos: admin.cosmos, evm: admin.evm },
      member: { name: MEMBER, cosmos: member.cosmos, evm: member.evm },
      removed: { name: REMOVED, cosmos: removed.cosmos, evm: removed.evm },
    };
    report.groupId = group.id;
    report.conversationIds = conversationIds;
    report.fileIds = [sent1.fileId, sent2.fileId];
    report.oneTimeEntriesUsed = {
      [MEMBER]: [...memberKeys.used].sort((a, b) => a - b),
      [REMOVED]: [...removedKeys.used].sort((a, b) => a - b),
    };
    report.ok = true;
    writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report.ok = false;
    report.error = error instanceof Error ? error.message : String(error);
    if (durable) writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
    throw error;
  } finally {
    server.close();
  }
}

function stateOf(item: Received, epoch: number, count: number): boolean {
  return item.ok && item.payload.t === "group.state" && item.payload.epoch === epoch && item.payload.members.length === count;
}

function textOf(items: Received[], body: string): boolean {
  return items.length === 1 && items[0].ok && items[0].payload.t === "group.text" && items[0].payload.body === body;
}

async function fileOf(who: CourierClient, items: Received[], bytes: Uint8Array): Promise<boolean> {
  const item = items[0];
  if (!item?.ok || item.payload.t !== "group.file") return false;
  const opened = await who.fetchFile(item.payload);
  return keccak256(opened) === keccak256(bytes);
}

function refusedGroup(items: Received[]): boolean {
  return items.length === 1 && !items[0].ok && items[0].code === "GROUP";
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
