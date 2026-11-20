import { evmToQor, qorToEvm } from "@qorechain/sdk";
import { fetchKemKey } from "@qorechain/qoreseal/network";
import { readMlDsaKey, requireMlDsaKey } from "haven-pq-kit/keydir";
import { TESTNET } from "haven-pq-kit/network";
import { bytesToHex, decodeFunctionResult, encodeFunctionData, hexToBytes, type Address, type Hex, type PublicClient } from "viem";

import { CourierError } from "./bytes.js";

/** What Courier reads from the chain. The relay and the client both take one, so tests can swap it. */
export interface ChainReader {
  readonly chainId: string;
  /** Registered, possession-proven ML-DSA-87 key. Throws when there is none. */
  mldsaKey(evm: string): Promise<Uint8Array>;
  /** The ML-KEM-1024 key in the registry, lowercase `0x` hex. Throws when there is none. */
  kemKey(evm: string): Promise<string>;
  /** `PrekeyDirectory.current`. */
  directory(evm: string): Promise<{ hash: string; expiry: number; live: boolean }>;
  /** Unix seconds, from the chain's point of view when it can be read. */
  now(): Promise<number>;
}

const CURRENT_ABI = [
  {
    type: "function",
    name: "current",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [
      { name: "hash", type: "bytes32" },
      { name: "expiry", type: "uint256" },
      { name: "live", type: "bool" },
    ],
  },
] as const;

export function toEvm(address: string): string {
  const evm = address.startsWith("0x") ? address : qorToEvm(address);
  if (!/^0x[0-9a-fA-F]{40}$/.test(evm)) throw new CourierError("ADDRESS", `not an address: ${address}`);
  return evm.toLowerCase();
}

export function toCosmos(address: string): string {
  return address.startsWith("qor1") ? address : evmToQor(address);
}

/** Reads the ML-KEM-1024 registry key over REST. `fetch` lets a proxy or a test sit in between. */
export async function kemKeyOverRest(evm: string, opts: { rest: string; fetch?: typeof fetch }): Promise<string> {
  const status = await fetchKemKey({ rest: opts.rest, address: toCosmos(toEvm(evm)), fetch: opts.fetch });
  if (!status.registered || !status.publicKey) throw new CourierError("IDENTITY_KEM", `no KEM key for ${evm}`);
  return bytesToHex(status.publicKey);
}

export function testnetReader(opts: {
  client: PublicClient;
  directory: string;
  rest?: string;
  restFetch?: typeof fetch;
}): ChainReader {
  const rest = opts.rest ?? TESTNET.rest;
  return {
    chainId: TESTNET.chainId,
    async mldsaKey(evm) {
      const key = await readMlDsaKey(opts.client, toEvm(evm) as Address);
      requireMlDsaKey(key);
      return hexToBytes(key.pubkey);
    },
    async kemKey(evm) {
      return kemKeyOverRest(evm, { rest, fetch: opts.restFetch });
    },
    async directory(evm) {
      const data = encodeFunctionData({ abi: CURRENT_ABI, functionName: "current", args: [toEvm(evm) as Address] });
      const raw = await opts.client.call({ to: opts.directory as Address, data });
      if (!raw.data || raw.data === "0x") throw new CourierError("BUNDLE_HASH", "the directory returned nothing");
      const [hash, expiry, live] = decodeFunctionResult({ abi: CURRENT_ABI, functionName: "current", data: raw.data as Hex });
      return { hash: hash.toLowerCase(), expiry: Number(expiry), live };
    },
    async now() {
      const block = await opts.client.getBlock();
      return Number(block.timestamp);
    },
  };
}
