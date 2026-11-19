import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { encodeDeployData, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { qorechainDiana } from "haven-pq-kit/network";
import { evmClient, withEvmWindow } from "./lib/chain.js";

const DEPLOYER = "spike";
const REPORT = "deployments/memo-pay.json";
/** A window's value cap also pays gas. The directory deploy needed 43,097 uqor. */
const DEPLOY_CAP_UQOR = "5000000";

type Report = {
  network: string;
  memoPay?: Address;
  deployer?: string;
  token: Address;
  deploy?: { openHash: string; createHash: Hex; gasUsed: number; closeHash: string };
};

async function main(): Promise<void> {
  const report: Report = existsSync(REPORT)
    ? (JSON.parse(readFileSync(REPORT, "utf8")) as Report)
    : { network: "qorechain-diana", token: "0x97143B771D34ddb9130b807b135Ae675A5a963CA" };
  if (report.memoPay) {
    console.log(`memo pay ${report.memoPay}`);
    return;
  }

  const client = evmClient();
  const artifact = JSON.parse(readFileSync("out/MemoPay.sol/MemoPay.json", "utf8")) as {
    abi: unknown[];
    bytecode: { object: Hex };
  };
  const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: [] });
  const { result, openHash, closeHash } = await withEvmWindow(
    DEPLOYER,
    { txs: 1, maxValueUqor: DEPLOY_CAP_UQOR, blocks: 200 },
    async (account) => {
      const signer = privateKeyToAccount(account.privateKey as Hex);
      const nonce = await client.getTransactionCount({ address: signer.address, blockTag: "pending" });
      const gasPrice = await client.getGasPrice();
      const gas = await client.estimateGas({ account: signer, data });
      const signed = await signer.signTransaction({
        chainId: qorechainDiana.id,
        nonce,
        gas,
        maxFeePerGas: gasPrice,
        maxPriorityFeePerGas: gasPrice,
        data,
        type: "eip1559",
      });
      const createHash = await client.sendRawTransaction({ serializedTransaction: signed });
      const created = await client.waitForTransactionReceipt({ hash: createHash });
      if (created.status !== "success" || !created.contractAddress) throw new Error(`deploy failed: ${createHash}`);
      return { createHash, address: created.contractAddress, gasUsed: Number(created.gasUsed), deployer: account.evm };
    },
  );

  report.memoPay = result.address.toLowerCase() as Address;
  report.deployer = result.deployer;
  report.deploy = { openHash, createHash: result.createHash, gasUsed: result.gasUsed, closeHash };
  mkdirSync("deployments", { recursive: true });
  writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`memo pay ${report.memoPay}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
