import { readFileSync } from "node:fs";
import { pqSign } from "@qorechain/qoresign";
import { bytesToHex, encodeAbiParameters, encodeFunctionData, hexToBytes, keccak256, toBytes, type Address, type Hex } from "viem";
import { qorechainDiana } from "../../haven-pq-kit/src/ts/network.ts";
import { evmClient, loadAccount } from "../../steward/scripts/lib/chain.ts";

const ABI = [
  {
    type: "function",
    name: "publish",
    stateMutability: "nonpayable",
    inputs: [
      { name: "bundleHash", type: "bytes32" },
      { name: "expiry", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

/** Read-only: eth_call the publish with a real and a forged signature. Sends nothing. */
async function main(): Promise<void> {
  const { directory } = JSON.parse(readFileSync("deployments/prekey-directory.json", "utf8")) as { directory: Address };
  const owner = await loadAccount("steward-vendor");
  const from = owner.evm.toLowerCase() as Address;
  const client = evmClient();
  const hash = keccak256(toBytes("courier-probe"));
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const message = encodeAbiParameters(
    [{ type: "uint256" }, { type: "address" }, { type: "address" }, { type: "bytes32" }, { type: "uint256" }],
    [BigInt(qorechainDiana.id), directory, from, hash, expiry],
  );
  const real = pqSign(owner.pqc.secretKey, hexToBytes(message));
  const forged = real.slice();
  forged[100] ^= 0x01;
  for (const [label, sig] of [
    ["real", real],
    ["forged", forged],
  ] as const) {
    const data = encodeFunctionData({ abi: ABI, functionName: "publish", args: [hash, expiry, bytesToHex(sig)] });
    try {
      await client.call({ account: from, to: directory, data });
      console.log(`${label}: call succeeded`);
    } catch (error) {
      const err = error as { message?: string; cause?: { data?: Hex; cause?: { data?: Hex } } };
      const revert = err.cause?.data ?? err.cause?.cause?.data ?? "";
      console.log(`${label}: reverted ${revert || (err.message ?? "").split("\n")[0]}`);
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
