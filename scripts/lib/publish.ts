import { pqSign } from "@qorechain/qoresign";
import type { UnifiedAccount } from "@qorechain/sdk";
import { bytesToHex, encodeAbiParameters, encodeFunctionData, hexToBytes, toFunctionSelector, type Address, type Hex } from "viem";
import { qorechainDiana } from "haven-pq-kit/network";
import { evmClient, sendScopedContractTx, withEvmWindow } from "./chain.js";

/** A few minutes under the contract's 7-day cap, so block time drift cannot push it over. */
export const TTL = 7 * 24 * 60 * 60 - 600;
export const PUBLISH_CAP_UQOR = "200000";
export const SIGNATURE_INVALID = toFunctionSelector("SignatureInvalid()");

export const DIRECTORY_ABI = [
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
  {
    type: "function",
    name: "signingMessage",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "bundleHash", type: "bytes32" },
      { name: "expiry", type: "uint256" },
    ],
    outputs: [{ type: "bytes" }],
  },
] as const;

export type Published = {
  openHash: string;
  publishHash: Hex;
  gasUsed: number;
  closeHash: string;
  readBack: { hash: Hex; expiry: number; live: boolean };
  refusedForgedSignature: string;
};

/** Checks the local signing message against the contract's. Throws when they differ. */
export async function checkSigningMessage(directory: Address, owner: Address, hash: Hex, expiry: bigint): Promise<Hex> {
  const local = encodeAbiParameters(
    [{ type: "uint256" }, { type: "address" }, { type: "address" }, { type: "bytes32" }, { type: "uint256" }],
    [BigInt(qorechainDiana.id), directory, owner, hash, expiry],
  );
  const onChain = await evmClient().readContract({ address: directory, abi: DIRECTORY_ABI, functionName: "signingMessage", args: [owner, hash, expiry] });
  if (onChain.toLowerCase() !== local.toLowerCase()) throw new Error("signingMessage differs from the local encoding");
  return local;
}

/**
 * Signs `(chainid, directory, owner, hash, expiry)` with the owner's ML-DSA-87 key, checks that a copy
 * with one flipped byte reverts with SignatureInvalid, publishes inside a scoped EVM window, and reads back.
 * Spends: window open + close (2 x 180,000 uqor) and the publish gas (about 281,000 gas).
 */
export async function publishBundle(opts: { directory: Address; owner: UnifiedAccount; hash: Hex; expiry: number }): Promise<Published> {
  const client = evmClient();
  const ownerEvm = opts.owner.evm.toLowerCase() as Address;
  const expiry = BigInt(opts.expiry);
  const local = await checkSigningMessage(opts.directory, ownerEvm, opts.hash, expiry);
  const signatureBytes = pqSign(opts.owner.pqc.secretKey, hexToBytes(local));
  const forged = signatureBytes.slice();
  forged[100] ^= 0x01;
  const data = encodeFunctionData({ abi: DIRECTORY_ABI, functionName: "publish", args: [opts.hash, expiry, bytesToHex(signatureBytes)] });
  let refusedForgedSignature = "";
  const { result, openHash, closeHash } = await withEvmWindow(
    opts.owner,
    { txs: 1, maxValueUqor: PUBLISH_CAP_UQOR, targets: [opts.directory], blocks: 200 },
    async (account) => {
      // eth_estimateGas on this RPC drops revert data; eth_call keeps it.
      let refused = "accepted";
      try {
        await client.call({
          account: ownerEvm,
          to: opts.directory,
          data: encodeFunctionData({ abi: DIRECTORY_ABI, functionName: "publish", args: [opts.hash, expiry, bytesToHex(forged)] }),
        });
      } catch (error) {
        const err = error as { cause?: { data?: Hex; cause?: { data?: Hex } } };
        refused = err.cause?.data ?? err.cause?.cause?.data ?? "no revert data";
      }
      if (refused !== SIGNATURE_INVALID) throw new Error(`a forged signature was not refused with SignatureInvalid: ${refused}`);
      refusedForgedSignature = `eth_call reverted with SignatureInvalid() ${SIGNATURE_INVALID}`;
      const publishHash = await sendScopedContractTx({ account, to: opts.directory, data });
      const receipt = await client.waitForTransactionReceipt({ hash: publishHash });
      return { publishHash, gasUsed: Number(receipt.gasUsed) };
    },
  );
  const [readHash, readExpiry, live] = await client.readContract({ address: opts.directory, abi: DIRECTORY_ABI, functionName: "current", args: [ownerEvm] });
  return { openHash, publishHash: result.publishHash, gasUsed: result.gasUsed, closeHash, readBack: { hash: readHash, expiry: Number(readExpiry), live }, refusedForgedSignature };
}
