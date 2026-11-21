import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encodeFunctionData, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { directoryAbi, verifyRecorded, type Rpc } from "./check";
import { browserRpc } from "./rpc";
import { RECORDED_CHECKS } from "./recorded";

const TAPE = join(process.cwd(), "fixtures/check-tape.json");

function tapeRpc(tape: Record<string, unknown>): Rpc {
  return async (method, params) => {
    const key = JSON.stringify([method, params]);
    if (!(key in tape)) throw new Error(`tape has no ${method}`);
    return tape[key];
  };
}

describe("recorded checks", () => {
  it("verifies the three recorded transactions from a tape", async () => {
    if (process.env.RECORD_TAPE === "1") {
      const tape: Record<string, unknown> = {};
      const rpc: Rpc = async (method, params) => {
        const result = await browserRpc()(method, params);
        tape[JSON.stringify([method, params])] = result;
        return result;
      };
      for (const check of RECORDED_CHECKS) {
        const verdict = await verifyRecorded(check, rpc);
        expect(verdict.networkError).toBeUndefined();
        expect(verdict.lines.every((line) => line.state === "pass")).toBe(true);
      }
      writeFileSync(TAPE, JSON.stringify(tape));
    }
    const tape = JSON.parse(readFileSync(TAPE, "utf8")) as Record<string, unknown>;
    for (const check of RECORDED_CHECKS) {
      const verdict = await verifyRecorded(check, tapeRpc(tape));
      expect(verdict.networkError).toBeUndefined();
      expect(verdict.lines.map((line) => line.state)).toEqual(["pass", "pass", "pass", "pass", "pass"]);
    }
  });

  it("fails a flipped bundle signature and does not call that a pass", async () => {
    const tape = JSON.parse(readFileSync(TAPE, "utf8")) as Record<string, unknown>;
    const check = RECORDED_CHECKS[0];
    const key = JSON.stringify(["eth_getTransactionByHash", [check.hash]]);
    const tx = structuredClone(tape[key]) as { input: Hex };
    const named = await import("viem").then((viem) => viem.decodeFunctionData({ abi: directoryAbi, data: tx.input }));
    const args = [...(named.args ?? [])] as [Hex, bigint, Hex];
    const signature = args[2];
    const flipped = (signature.slice(0, -1) + (signature.endsWith("a") ? "b" : "a")) as Hex;
    tx.input = encodeFunctionData({ abi: directoryAbi, functionName: "publish", args: [args[0], args[1], flipped] });
    const poisoned = { ...tape, [key]: tx };
    const verdict = await verifyRecorded(check, tapeRpc(poisoned));
    expect(verdict.networkError).toBeUndefined();
    expect(verdict.lines.find((line) => line.id === "signature")?.state).toBe("fail");
  });
});
