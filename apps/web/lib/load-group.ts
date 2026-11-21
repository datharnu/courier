import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { factsOf, type LiveExchange, type LiveGroup, type MemoPayment, type RecordFacts } from "./record";

function readDeployment<T>(filename: string): T | null {
  const repo = join(process.cwd(), "../../deployments", filename);
  const bundled = join(process.cwd(), "fixtures/deployments", filename);
  const path = existsSync(repo) ? repo : bundled;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

export function loadGroup(): LiveGroup | null {
  const parsed = readDeployment<LiveGroup>("live-group.json");
  if (!parsed?.groupId || !parsed.receipt?.recordHash) return null;
  return parsed;
}

export function loadExchange(): LiveExchange | null {
  const parsed = readDeployment<LiveExchange>("live-exchange.json");
  if (!parsed?.conversationId) return null;
  return parsed;
}

export function loadMemoPayment(): MemoPayment | null {
  const parsed = readDeployment<MemoPayment>("memo-payment.json");
  if (!parsed?.payHash || !parsed?.ciphertextHash) return null;
  return parsed;
}

export function loadFacts(): RecordFacts | null {
  const group = loadGroup();
  if (!group?.ok) return null;
  return factsOf(group, loadExchange(), loadMemoPayment());
}
