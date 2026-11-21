/**
 * Checks three recorded transactions. The signature bytes come from the
 * transaction input. The page's copy is not the verdict.
 *
 * A bundle signs `abi.encode(chainid, directory, owner, bundleHash, expiry)`,
 * the same bytes as `PrekeyDirectory.signingMessage`. A receipt signs the six
 * words in `DeliveryReceipts.signingMessage` and `src/ts/receipt.ts`.
 */
import { mldsa87 } from "@qorechain/pqc";
import {
  decodeFunctionData,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  hexToBigInt,
  hexToBytes,
  isAddress,
  keccak256,
  toBytes,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import directoryAbiJson from "./abi/prekey-directory.json";
import receiptsAbiJson from "./abi/delivery-receipts.json";
import pqcAbiJson from "./abi/iqore-pqc.json";
import {
  CAROL,
  CAROL_BUNDLE,
  CAROL_EXPIRY,
  CIPHERTEXT,
  CONVERSATION,
  DELIVERY_RECEIPTS,
  DIRECTORY,
  RECEIPT_COUNTER,
  RECORD_HASH,
  SUBMITTER,
  VENDOR,
  VENDOR_BUNDLE,
  VENDOR_EXPIRY,
  utcStamp,
  type RecordedCheck,
} from "./recorded";

export const directoryAbi = directoryAbiJson as Abi;
export const receiptsAbi = receiptsAbiJson as Abi;
export const pqcAbi = pqcAbiJson as Abi;

export const CHAIN_ID = 9800n;
export const PQC_STATUS = "0x0000000000000000000000000000000000000a02" as const;
export const ML_DSA_87 = 1;
export const PUBKEY_LEN = 2592;
export const SIG_LEN = 4627;
export const EVM_RPC = "https://evm-testnet.qore.host";
export const NETWORK = "Could not reach the testnet";
export const RECEIPT_DOMAIN: Hex = keccak256(toBytes("courier.receipt.v1"));

export type CheckState = "pass" | "fail" | "could-not-check";
export type CheckId = "fetched" | "decoded" | "key" | "signature" | "recorded";

export type CheckLine = { id: CheckId; label: string; state: CheckState; reason: string };
export type Verdict = { reached: boolean; networkError?: string; lines: CheckLine[] };
export type Rpc = (method: string, params: unknown[]) => Promise<unknown>;

const LABELS: Record<CheckId, string> = {
  fetched: "Fetched",
  decoded: "Decoded",
  key: "Key read",
  signature: "Signature verified",
  recorded: "Recorded",
};
const ORDER: CheckId[] = ["fetched", "decoded", "key", "signature", "recorded"];

export class CallError extends Error {
  readonly data?: Hex;
  constructor(message: string, data?: Hex) {
    super(message);
    this.name = "CallError";
    this.data = data;
  }
}

export class NetworkError extends Error {
  constructor() {
    super(NETWORK);
    this.name = "NetworkError";
  }
}

type Draft = { state: CheckState; reason: string };

export function encodeBundle(directory: Address, owner: Address, bundleHash: Hex, expiry: bigint): Hex {
  return encodeAbiParameters(
    [{ type: "uint256" }, { type: "address" }, { type: "address" }, { type: "bytes32" }, { type: "uint256" }],
    [CHAIN_ID, directory, owner, bundleHash, expiry],
  );
}

export function encodeReceipt(conversationId: Hex, counter: bigint, ciphertextHash: Hex, recipient: Address): Hex {
  return encodeAbiParameters(
    [{ type: "bytes32" }, { type: "uint256" }, { type: "bytes32" }, { type: "uint256" }, { type: "bytes32" }, { type: "address" }],
    [RECEIPT_DOMAIN, CHAIN_ID, conversationId, counter, ciphertextHash, recipient],
  );
}

export function summarize(verdict: Verdict): string {
  if (verdict.networkError) return verdict.networkError;
  if (verdict.lines.some((line) => line.state === "fail")) return "A check failed. The lines below are the verdict.";
  return "The signature verifies over the message the contract builds.";
}

function linesOf(drafts: Partial<Record<CheckId, Draft>>, fallback: string): CheckLine[] {
  return ORDER.map((id) => {
    const draft = drafts[id] ?? { state: "could-not-check" as const, reason: fallback };
    return { id, label: LABELS[id], state: draft.state, reason: draft.reason };
  });
}

function networkVerdict(): Verdict {
  return { reached: false, networkError: NETWORK, lines: linesOf({}, NETWORK) };
}

function asHex(value: unknown): Hex | null {
  return typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value) ? (value as Hex) : null;
}

function same(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

async function ethCall(rpc: Rpc, to: Address, data: Hex, block: bigint | "latest"): Promise<Hex> {
  const result = await rpc("eth_call", [{ to, data }, block === "latest" ? "latest" : toHex(block)]);
  const hex = asHex(result);
  if (!hex) throw new Error("eth_call returned no hex");
  return hex;
}

async function readKey(rpc: Rpc, account: Address, block: bigint): Promise<{ ok: true; pubkey: Uint8Array } | { ok: false; reason: string }> {
  const data = encodeFunctionData({ abi: pqcAbi, functionName: "pqcKeyStatus", args: [account] });
  let raw: Hex;
  try {
    raw = await ethCall(rpc, PQC_STATUS, data, block);
  } catch (error) {
    if (error instanceof CallError) return { ok: false, reason: `pqcKeyStatus refused the read for ${account}.` };
    throw error;
  }
  let decoded: readonly unknown[];
  try {
    const result = decodeFunctionResult({ abi: pqcAbi, functionName: "pqcKeyStatus", data: raw });
    decoded = Array.isArray(result) ? result : [];
  } catch {
    return { ok: false, reason: "The pqcKeyStatus reply could not be decoded." };
  }
  const pubkey = asHex(decoded[2]);
  if (decoded[0] !== true) return { ok: false, reason: `${account} has no registered key.` };
  if (decoded[1] !== ML_DSA_87) return { ok: false, reason: `${account} is algorithm ${String(decoded[1])}, not ML-DSA-87.` };
  if (decoded[3] !== true) return { ok: false, reason: `${account} has not proved possession of the key.` };
  if (!pubkey) return { ok: false, reason: "The public key was not hex." };
  const bytes = hexToBytes(pubkey);
  if (bytes.length !== PUBKEY_LEN) return { ok: false, reason: `The public key is ${bytes.length} bytes. ML-DSA-87 is ${PUBKEY_LEN}.` };
  return { ok: true, pubkey: bytes };
}

function verify(pubkey: Uint8Array, message: Hex, signature: Hex): { ok: boolean; reason: string } {
  const bytes = hexToBytes(signature);
  if (bytes.length !== SIG_LEN) return { ok: false, reason: `The signature is ${bytes.length} bytes. ML-DSA-87 is ${SIG_LEN}.` };
  const ok = mldsa87.verify(pubkey, hexToBytes(message), bytes) === true;
  return { ok, reason: ok ? "The signature matches the registered key and the message this call builds." : "The signature does not match the registered key." };
}

type Tx = { from: Address; to: Address; input: Hex; blockNumber: bigint };

function parseTx(value: unknown): Tx | null {
  if (!value || typeof value !== "object") return null;
  const tx = value as Record<string, unknown>;
  const blockNumber = asHex(tx.blockNumber);
  const input = asHex(tx.input);
  if (!blockNumber || !input || typeof tx.to !== "string" || !isAddress(tx.to) || typeof tx.from !== "string" || !isAddress(tx.from)) return null;
  return { from: getAddress(tx.from), to: getAddress(tx.to), input, blockNumber: hexToBigInt(blockNumber) };
}

export async function verifyRecorded(check: RecordedCheck, rpc: Rpc): Promise<Verdict> {
  try {
    return await verifyHash(check, rpc);
  } catch (error) {
    if (error instanceof NetworkError) return networkVerdict();
    const reason = error instanceof Error ? error.message : "The reply could not be read.";
    return { reached: true, lines: linesOf({ fetched: { state: "fail", reason } }, "The read stopped before this line.") };
  }
}

async function verifyHash(check: RecordedCheck, rpc: Rpc): Promise<Verdict> {
  const chainHex = asHex(await rpc("eth_chainId", []));
  if (!chainHex || hexToBigInt(chainHex) !== CHAIN_ID) {
    return { reached: true, lines: linesOf({ fetched: { state: "fail", reason: `The RPC chain id is ${chainHex ?? "missing"}. This checker expects ${toHex(CHAIN_ID)}.` } }, "The chain id was not 9800.") };
  }
  const txValue = await rpc("eth_getTransactionByHash", [check.hash]);
  const receiptValue = await rpc("eth_getTransactionReceipt", [check.hash]);
  const tx = parseTx(txValue);
  const statusHex = receiptValue && typeof receiptValue === "object" ? asHex((receiptValue as { status?: unknown }).status) : null;
  if (!tx || !statusHex) {
    const missing = txValue === null || receiptValue === null;
    return { reached: true, lines: linesOf({ fetched: { state: "fail", reason: missing ? "The testnet has no transaction with this hash." : "The transaction reply was missing a field this check needs." } }, "There is nothing further to read.") };
  }
  const drafts: Partial<Record<CheckId, Draft>> = {
    fetched: { state: "pass", reason: `Transaction and receipt, block ${tx.blockNumber.toString()}. The signature is in the input.` },
  };
  if (hexToBigInt(statusHex) !== 1n) {
    drafts.decoded = { state: "fail", reason: "The EVM receipt did not succeed." };
    return { reached: true, lines: linesOf(drafts, "A reverted call is not this recorded step.") };
  }
  return check.kind === "bundle" ? verifyBundle(check, tx, rpc, drafts) : verifyReceipt(tx, rpc, drafts);
}

async function verifyBundle(check: RecordedCheck, tx: Tx, rpc: Rpc, drafts: Partial<Record<CheckId, Draft>>): Promise<Verdict> {
  const expectedOwner = check.id === "vendor-bundle" ? VENDOR : CAROL;
  const expectedHash = check.id === "vendor-bundle" ? VENDOR_BUNDLE : CAROL_BUNDLE;
  const expectedExpiry = check.id === "vendor-bundle" ? BigInt(VENDOR_EXPIRY) : BigInt(CAROL_EXPIRY);
  if (!same(tx.to, DIRECTORY)) {
    drafts.decoded = { state: "fail", reason: `The transaction went to ${tx.to}, not the recorded directory.` };
    return { reached: true, lines: linesOf(drafts, "This is not the directory publish.") };
  }
  let args: readonly unknown[];
  try {
    const named = decodeFunctionData({ abi: directoryAbi, data: tx.input });
    if (named.functionName !== "publish" || !named.args) throw new Error("not publish");
    args = named.args;
  } catch {
    drafts.decoded = { state: "fail", reason: "The input is not PrekeyDirectory.publish." };
    return { reached: true, lines: linesOf(drafts, "The call was not decoded.") };
  }
  const bundleHash = asHex(args[0]);
  const expiry = typeof args[1] === "bigint" ? args[1] : null;
  const signature = asHex(args[2]);
  if (!bundleHash || expiry === null || !signature) {
    drafts.decoded = { state: "fail", reason: "The publish arguments could not be read." };
    return { reached: true, lines: linesOf(drafts, "The call was not decoded.") };
  }
  drafts.decoded = { state: "pass", reason: `publish of ${bundleHash}, expiry ${utcStamp(Number(expiry))}.` };
  if (!same(tx.from, expectedOwner) || !same(bundleHash, expectedHash) || expiry !== expectedExpiry) {
    drafts.recorded = { state: "fail", reason: "The owner, bundle hash, or expiry is not the recorded publish." };
  }
  const key = await readKey(rpc, tx.from, tx.blockNumber);
  if (!key.ok) {
    drafts.key = { state: "fail", reason: key.reason };
    drafts.signature = { state: "could-not-check", reason: "The signature was not checked. The key was refused." };
  } else {
    drafts.key = { state: "pass", reason: `${tx.from} is ML-DSA-87, ${PUBKEY_LEN} bytes, possession proved.` };
    const verdict = verify(key.pubkey, encodeBundle(tx.to, tx.from, bundleHash, expiry), signature);
    drafts.signature = { state: verdict.ok ? "pass" : "fail", reason: verdict.reason };
  }
  if (!drafts.recorded) drafts.recorded = await currentLine(rpc, tx.from, bundleHash, expiry);
  return { reached: true, lines: linesOf(drafts, "") };
}

async function currentLine(rpc: Rpc, owner: Address, bundleHash: Hex, expiry: bigint): Promise<Draft> {
  const data = encodeFunctionData({ abi: directoryAbi, functionName: "current", args: [owner] });
  let raw: Hex;
  try {
    raw = await ethCall(rpc, getAddress(DIRECTORY), data, "latest");
  } catch (error) {
    if (error instanceof CallError) return { state: "could-not-check", reason: "current() was refused. The recorded signature was still checked." };
    throw error;
  }
  const result = decodeFunctionResult({ abi: directoryAbi, functionName: "current", data: raw });
  const tuple = Array.isArray(result) ? result : [];
  const hash = asHex(tuple[0]);
  const live = tuple[2] === true;
  if (!live) return { state: "pass", reason: `Expired. current() is not live. The recorded publish of ${bundleHash} was still checked.` };
  if (!hash || !same(hash, bundleHash)) return { state: "pass", reason: "The directory now holds a different bundle. The recorded signature was still checked." };
  return { state: "pass", reason: `Live until ${utcStamp(Number(expiry))}. current() still holds this bundle.` };
}

async function verifyReceipt(tx: Tx, rpc: Rpc, drafts: Partial<Record<CheckId, Draft>>): Promise<Verdict> {
  if (!same(tx.to, DELIVERY_RECEIPTS)) {
    drafts.decoded = { state: "fail", reason: `The transaction went to ${tx.to}, not DeliveryReceipts.` };
    return { reached: true, lines: linesOf(drafts, "This is not the recorded receipt.") };
  }
  let args: readonly unknown[];
  try {
    const named = decodeFunctionData({ abi: receiptsAbi, data: tx.input });
    if (named.functionName !== "record" || !named.args) throw new Error("not record");
    args = named.args;
  } catch {
    drafts.decoded = { state: "fail", reason: "The input is not DeliveryReceipts.record." };
    return { reached: true, lines: linesOf(drafts, "The call was not decoded.") };
  }
  const conversationId = asHex(args[0]);
  const counter = typeof args[1] === "bigint" ? args[1] : null;
  const ciphertextHash = asHex(args[2]);
  const recipient = typeof args[3] === "string" && isAddress(args[3]) ? getAddress(args[3]) : null;
  const signature = asHex(args[4]);
  if (!conversationId || counter === null || !ciphertextHash || !recipient || !signature) {
    drafts.decoded = { state: "fail", reason: "The record arguments could not be read." };
    return { reached: true, lines: linesOf(drafts, "The call was not decoded.") };
  }
  drafts.decoded = { state: "pass", reason: "record. The signature in the input is the recipient's." };
  const matches =
    same(conversationId, CONVERSATION) &&
    counter === BigInt(RECEIPT_COUNTER) &&
    same(ciphertextHash, CIPHERTEXT) &&
    same(recipient, VENDOR) &&
    same(tx.from, SUBMITTER) &&
    same(tx.to, DELIVERY_RECEIPTS);
  const key = await readKey(rpc, recipient, tx.blockNumber);
  if (!key.ok) {
    drafts.key = { state: "fail", reason: key.reason };
    drafts.signature = { state: "could-not-check", reason: "The signature was not checked. The key was refused." };
  } else {
    drafts.key = { state: "pass", reason: `${recipient} is ML-DSA-87, ${PUBKEY_LEN} bytes, possession proved.` };
    const verdict = verify(key.pubkey, encodeReceipt(conversationId, counter, ciphertextHash, recipient), signature);
    drafts.signature = { state: verdict.ok ? "pass" : "fail", reason: verdict.reason };
  }
  drafts.recorded = matches
    ? await storedLine(rpc, conversationId, counter, ciphertextHash, recipient, tx.from)
    : { state: "fail", reason: `This input is not receipt ${RECORD_HASH}.` };
  return { reached: true, lines: linesOf(drafts, "") };
}

async function storedLine(rpc: Rpc, conversationId: Hex, counter: bigint, ciphertextHash: Hex, recipient: Address, submitter: Address): Promise<Draft> {
  const data = encodeFunctionData({ abi: receiptsAbi, functionName: "receipt", args: [conversationId, counter, ciphertextHash, recipient] });
  let raw: Hex;
  try {
    raw = await ethCall(rpc, getAddress(DELIVERY_RECEIPTS), data, "latest");
  } catch (error) {
    if (error instanceof CallError) return { state: "could-not-check", reason: "receipt() was refused." };
    throw error;
  }
  const result = decodeFunctionResult({ abi: receiptsAbi, functionName: "receipt", data: raw });
  const tuple = Array.isArray(result) ? result : [];
  const storedSubmitter = typeof tuple[0] === "string" && isAddress(tuple[0]) ? getAddress(tuple[0]) : null;
  const recordedAt = typeof tuple[1] === "bigint" ? tuple[1] : null;
  if (!storedSubmitter || recordedAt === null || recordedAt === 0n) return { state: "fail", reason: "receipt() has no record for this ciphertext." };
  if (!same(storedSubmitter, submitter)) return { state: "fail", reason: `receipt() names ${storedSubmitter}, not the transaction sender ${submitter}.` };
  return { state: "pass", reason: `Stored at ${utcStamp(Number(recordedAt))}. The submitter is ${submitter}. The recipient is ${recipient}.` };
}
