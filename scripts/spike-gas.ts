import { readFileSync, writeFileSync } from "node:fs";
import { pqSign } from "@qorechain/qoresign";
import {
  encodeAbiParameters,
  encodeDeployData,
  bytesToHex,
  encodeFunctionData,
  hexToBytes,
  keccak256,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { qorechainDiana } from "haven-pq-kit/network";
import { evmClient, sendScopedContractTx, withEvmWindow } from "./lib/chain.js";

const ABI = [
  {
    type: "function",
    name: "publish",
    stateMutability: "nonpayable",
    inputs: [
      { name: "bundleHash_", type: "bytes32" },
      { name: "expiry_", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

async function main(): Promise<void> {
  const artifact = JSON.parse(readFileSync("out/BundleSpike.sol/BundleSpike.json", "utf8")) as {
    abi: unknown[];
    bytecode: { object: string };
  };
  const deployData = encodeDeployData({
    abi: artifact.abi,
    bytecode: artifact.bytecode.object as Hex,
    args: [],
  });
  const client = evmClient();

  const { result, openHash, closeHash } = await withEvmWindow(
    "spike",
    { txs: 2, maxValueUqor: "5000000", blocks: 200 },
    async (account) => {
      const signer = privateKeyToAccount(account.privateKey as Hex);
      const nonce = await client.getTransactionCount({ address: signer.address, blockTag: "pending" });
      const gasPrice = await client.getGasPrice();
      const createGas = await client.estimateGas({ account: signer, data: deployData });
      const signed = await signer.signTransaction({
        chainId: qorechainDiana.id,
        nonce,
        gas: createGas,
        maxFeePerGas: gasPrice,
        maxPriorityFeePerGas: gasPrice,
        data: deployData,
        type: "eip1559",
      });
      const createHash = await client.sendRawTransaction({ serializedTransaction: signed });
      const created = await client.waitForTransactionReceipt({ hash: createHash });
      if (created.status !== "success" || !created.contractAddress) {
        throw new Error(`deploy failed: ${createHash}`);
      }

      const bundleHash = keccak256(toBytes("courier-spike-bundle-v1"));
      const expiry = BigInt(Math.floor(Date.now() / 1000) + 24 * 60 * 60);
      const message = encodeAbiParameters(
        [{ type: "uint256" }, { type: "address" }, { type: "address" }, { type: "bytes32" }, { type: "uint256" }],
        [BigInt(qorechainDiana.id), created.contractAddress, account.evm as Address, bundleHash, expiry],
      );
      const signature = pqSign(account.pqc.secretKey, hexToBytes(message));
      const data = encodeFunctionData({
        abi: ABI,
        functionName: "publish",
        args: [bundleHash, expiry, bytesToHex(signature)],
      });
      const publishGas = await client.estimateGas({
        account: signer,
        to: created.contractAddress,
        data,
      });
      const publishHash = await sendScopedContractTx({
        account,
        to: created.contractAddress,
        data,
      });
      const published = await client.waitForTransactionReceipt({ hash: publishHash });
      return {
        contract: created.contractAddress,
        createHash,
        createGas: Number(createGas),
        createGasUsed: Number(created.gasUsed),
        publishHash,
        publishGas: Number(publishGas),
        publishGasUsed: Number(published.gasUsed),
        bundleHash,
      };
    },
  );

  const report = { openHash, closeHash, ...result };
  writeFileSync("deployments/spike-gas.json", `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
