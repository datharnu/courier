import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { TOOLS, toolContext } from "@qorechain/mcp";

/**
 * Re-checks the recorded testnet transaction hashes in `deployments/*.json`
 * through `@qorechain/mcp`. Bundle hashes, ciphertext hashes, and memo hashes
 * are not transactions and are left alone. The deployment files are not rewritten.
 *
 * A window open, a window close, a bank send, a swap, a conversion, and the
 * KEM registration in `spike-seal.json` are hybrid (`pqc`). A contract create,
 * publish, approve, pay, or receipt record inside a window is `classical`.
 */

type Tier = "pqc" | "classical";
type Row = { file: string; key: string; hash: string; tier: Tier; ok: boolean; detail: string };

type TransactionResult = { success: boolean; failure?: unknown; execution_failures?: unknown[] };
type PqStatusResult = {
  transaction_status: {
    tier: string;
    has_exactly_one_pqc_layer: boolean;
    verification: { checked: boolean; verified: boolean | null; reason: string | null };
  } | null;
};

const PQC_KEYS = new Set(["openHash", "closeHash", "fundHash", "swapHash", "convertHash"]);
const CLASSICAL_KEYS = new Set(["createHash", "approveHash", "payHash", "recordHash"]);
const HASH = /^(?:0x)?[0-9a-fA-F]{64}$/;

function tool(name: string) {
  const found = TOOLS.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`@qorechain/mcp has no ${name} tool`);
  return found;
}

const getTransaction = tool("get_transaction");
const getPqStatus = tool("get_pq_status");
const ctx = toolContext({ defaultNetwork: "testnet" });

function tierFor(file: string, key: string): Tier | null {
  if (PQC_KEYS.has(key)) return "pqc";
  if (CLASSICAL_KEYS.has(key)) return "classical";
  if (key === "publishHash") return file === "spike-seal.json" ? "pqc" : "classical";
  return null;
}

function collect(file: string, value: unknown, rows: { file: string; key: string; hash: string; tier: Tier }[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collect(file, item, rows);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const tier = tierFor(file, key);
    if (tier && typeof child === "string" && HASH.test(child)) {
      rows.push({ file, key, hash: child, tier });
      continue;
    }
    collect(file, child, rows);
  }
}

function recorded(dir: string): { file: string; key: string; hash: string; tier: Tier }[] {
  if (!existsSync(dir)) return [];
  const rows: { file: string; key: string; hash: string; tier: Tier }[] = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (!name.endsWith(".json") || !statSync(path).isFile()) continue;
    const document = JSON.parse(readFileSync(path, "utf8")) as { network?: string };
    if (document.network !== undefined && document.network !== "qorechain-diana") {
      throw new Error(`${name}: network ${document.network} is not the testnet`);
    }
    collect(name, document, rows);
  }
  return rows;
}

async function check(entry: { file: string; key: string; hash: string; tier: Tier }): Promise<Row> {
  const row = { ...entry, ok: false, detail: "" };
  try {
    const tx = (await getTransaction.handler({ network: "testnet", hash: entry.hash }, ctx)) as TransactionResult;
    const refused = (tx.execution_failures?.length ?? 0) > 0;
    const pq = (await getPqStatus.handler({ network: "testnet", target: entry.hash }, ctx)) as PqStatusResult;
    const status = pq.transaction_status;
    const parts = [`${entry.key}`, `success=${String(tx.success)}`, `tier=${status?.tier ?? "?"}`];
    let ok = tx.success === true && !refused && status?.tier === entry.tier;
    if (entry.tier === "pqc") {
      const verified = status?.has_exactly_one_pqc_layer === true && status.verification.verified === true;
      parts.push(`ml-dsa=${String(verified)}`);
      ok = ok && verified;
    }
    return { ...row, ok, detail: parts.join(" ") };
  } catch (error) {
    return { ...row, ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

function printTable(rows: Row[]): void {
  const header = ["result", "file", "tier", "hash", "detail"];
  const lines = rows.map((row) => [row.ok ? "PASS" : "FAIL", row.file, row.tier, row.hash, row.detail]);
  const widths = header.map((_, i) => Math.max(header[i].length, ...lines.map((line) => line[i].length)));
  const format = (cells: string[]) => cells.map((cell, i) => cell.padEnd(widths[i])).join("  ");
  console.log(format(header));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const line of lines) console.log(format(line));
}

const dir = process.argv[2] ?? "deployments";
recorded(dir)
  .reduce<Promise<Row[]>>(async (acc, entry) => [...(await acc), await check(entry)], Promise.resolve([]))
  .then((rows) => {
    if (rows.length === 0) {
      console.error(`no transaction hashes recorded in ${dir}`);
      process.exit(1);
    }
    printTable(rows);
    const failed = rows.filter((row) => !row.ok).length;
    console.log(`\n${rows.length - failed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
