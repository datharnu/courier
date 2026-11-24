/**
 * The chain reads /app/try needs. Over the public EVM RPC (the same read /app/receipt uses):
 * `PrekeyDirectory.current(vendor)`, and `pqcKeyStatus` for the client and the vendor. Over the
 * same-origin REST rewrite (next.config.ts): the vendor's ML-KEM-1024 key in the KEM registry.
 * No wallet, no relay, no key held anywhere but the page.
 */
import { decodeFunctionResult, encodeFunctionData, hexToBigInt, hexToBytes, type Address, type Hex } from "viem";
import { DIRECTORY as RECORDED_DIRECTORY } from "../recorded";
import { CHAIN_ID, CallError, ML_DSA_87, NetworkError, PQC_STATUS, PUBKEY_LEN, directoryAbi, pqcAbi, type Rpc } from "../check";
import { demoBundleHash, type DemoFixture } from "./demo-keys";
import type { ChainView } from "./flow";
import { readRegistryKem, type RegistryRead } from "./registry";

export type KeyState = "registered" | "missing" | "different";

export type DemoChain =
  | {
      ok: true;
      view: ChainView;
      clientKey: KeyState;
      vendorKey: "registered" | "missing";
      registry: RegistryRead;
      matchesFixture: boolean;
    }
  | { ok: false; reason: string };

function asHex(value: unknown): Hex | null {
  return typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value) ? (value as Hex) : null;
}

async function call(rpc: Rpc, to: Address, data: Hex): Promise<Hex> {
  const hex = asHex(await rpc("eth_call", [{ to, data }, "latest"]));
  if (!hex) throw new Error("eth_call returned no hex");
  return hex;
}

/** A registered, possession-proven ML-DSA-87 key, or null. */
async function mldsaKey(rpc: Rpc, account: string): Promise<Uint8Array | null> {
  try {
    const status = decodeFunctionResult({
      abi: pqcAbi,
      functionName: "pqcKeyStatus",
      data: await call(rpc, PQC_STATUS, encodeFunctionData({ abi: pqcAbi, functionName: "pqcKeyStatus", args: [account as Address] })),
    }) as unknown as readonly unknown[];
    const pubkey = asHex(status[2]);
    if (status[0] === true && status[1] === ML_DSA_87 && status[3] === true && pubkey && hexToBytes(pubkey).length === PUBKEY_LEN) return hexToBytes(pubkey);
    return null;
  } catch (error) {
    if (error instanceof CallError) return null;
    throw error;
  }
}

function hexOf(bytes: Uint8Array): string {
  let out = "0x";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

export async function readDemoChain(rpc: Rpc, fixture: DemoFixture, fetcher?: typeof fetch): Promise<DemoChain> {
  try {
    const chainHex = asHex(await rpc("eth_chainId", []));
    if (!chainHex || hexToBigInt(chainHex) !== CHAIN_ID) return { ok: false, reason: `The RPC chain id is ${chainHex ?? "missing"}, not 9800.` };
    if (fixture.directory.toLowerCase() !== RECORDED_DIRECTORY.toLowerCase()) return { ok: false, reason: "The demo identities name a different directory." };
    const block = (await rpc("eth_getBlockByNumber", ["latest", false])) as { timestamp?: unknown } | null;
    const stamp = asHex(block?.timestamp);
    if (!stamp) return { ok: false, reason: "The latest block had no timestamp." };
    const now = Number(hexToBigInt(stamp));

    const current = decodeFunctionResult({
      abi: directoryAbi,
      functionName: "current",
      data: await call(rpc, fixture.directory as Address, encodeFunctionData({ abi: directoryAbi, functionName: "current", args: [fixture.vendor.evm as Address] })),
    }) as unknown as readonly [Hex, bigint, boolean];
    const hash = current[0].toLowerCase();
    const expiry = Number(current[1]);
    const live = current[2] === true;

    const clientMldsa = await mldsaKey(rpc, fixture.client.evm);
    const clientKey: KeyState = !clientMldsa ? "missing" : hexOf(clientMldsa) === fixture.client.mldsaPublic ? "registered" : "different";
    const vendorMldsa = await mldsaKey(rpc, fixture.vendor.evm);
    const registry = await readRegistryKem(fixture.vendor.cosmos, fetcher);
    const vendorRegistryKem = registry.ok ? registry.kem : null;
    const matchesFixture = expiry > 0 && demoBundleHash(fixture, expiry) === hash;
    return {
      ok: true,
      view: { hash, expiry, live, now, clientMldsa, vendorMldsa, vendorRegistryKem },
      clientKey,
      vendorKey: vendorMldsa ? "registered" : "missing",
      registry,
      matchesFixture,
    };
  } catch (error) {
    if (error instanceof NetworkError) return { ok: false, reason: error.message };
    return { ok: false, reason: error instanceof Error ? error.message : "The reply could not be read." };
  }
}
