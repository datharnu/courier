import { StargateClient } from "@cosmjs/stargate";
import { deriveSealKeys, type SealKeyPair } from "@qorechain/qoreseal";
import {
  EthNativeSigner,
  closeEvmWindowMsg,
  deriveUnifiedAccount,
  fetchEvmWindow,
  openEvmWindowMsg,
  type UnifiedAccount,
} from "@qorechain/sdk";
import { TESTNET, qorechainDiana } from "haven-pq-kit/network";
import { createPublicClient, createWalletClient, http, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readMnemonic } from "./secrets.js";

export const CHAIN_ID = TESTNET.chainId;
/** The fee Steward's EVM-heavy transactions land with. Lower ones have been refused. */
const FEE = { amount: [{ denom: "uqor", amount: "180000" }], gas: "1200000" };

export function evmClient(): PublicClient {
  return createPublicClient({ chain: qorechainDiana, transport: http(TESTNET.evmRpc) });
}

export function loadAccount(name: string): Promise<UnifiedAccount> {
  return deriveUnifiedAccount(readMnemonic(name));
}

export function loadSealKeys(name: string, index = 0): SealKeyPair {
  return deriveSealKeys({ mnemonic: readMnemonic(name), index });
}

async function accountSequence(account: UnifiedAccount): Promise<{ accountNumber: bigint; sequence: bigint }> {
  const [res, nonce] = await Promise.all([
    fetch(`${TESTNET.rest}/cosmos/auth/v1beta1/accounts/${account.cosmos}`, { headers: { "user-agent": "haven" } }),
    evmClient().getTransactionCount({ address: account.evm as Address, blockTag: "pending" }),
  ]);
  if (!res.ok) throw new Error(`account ${account.cosmos} is not on chain (${res.status})`);
  const body = (await res.json()) as { account?: { account_number?: string } };
  if (!body.account?.account_number) throw new Error(`account ${account.cosmos} has no account_number on chain`);
  return { accountNumber: BigInt(body.account.account_number), sequence: BigInt(nonce) };
}

export type NativeMessages = Parameters<EthNativeSigner["sign"]>[0]["messages"];

export async function broadcast(
  account: UnifiedAccount,
  messages: NativeMessages,
  signMode: "hybrid" | "classical" = "hybrid",
): Promise<string> {
  const auth = await accountSequence(account);
  const signer = new EthNativeSigner(account, { signMode, rest: TESTNET.rest, signBytesVersion: "auto" });
  const node = await StargateClient.connect(TESTNET.rpc);
  try {
    const result = await signer.signAndBroadcast(node, {
      chainId: CHAIN_ID,
      messages,
      fee: FEE,
      accountNumber: auth.accountNumber,
      sequence: auth.sequence,
    });
    if (result.code !== 0) {
      throw new Error(`tx ${result.transactionHash} failed with code ${result.code}: ${result.rawLog ?? ""}`);
    }
    return result.transactionHash;
  } finally {
    node.disconnect();
  }
}

/** Opens a scoped EVM window, runs `body`, and always closes it. The value cap also pays gas. */
export async function withEvmWindow<T>(
  name: string,
  spec: { txs: number; maxValueUqor: string; targets?: string[]; blocks?: number },
  body: (account: UnifiedAccount) => Promise<T>,
): Promise<{ result: T; openHash: string; closeHash: string }> {
  const account = await loadAccount(name);
  const openHash = await broadcast(account, [
    openEvmWindowMsg({
      sender: account.cosmos,
      blocks: spec.blocks ?? 120,
      maxTxs: spec.txs,
      maxValue: spec.maxValueUqor,
      allowedTargets: spec.targets && spec.targets.length > 0 ? spec.targets : undefined,
    }),
  ]);
  const win = await fetchEvmWindow({ rest: TESTNET.rest, address: account.cosmos });
  if (!win.live) throw new Error(`window ${openHash} did not become live`);
  let result!: T;
  let bodyError: unknown;
  try {
    result = await body(account);
  } catch (error) {
    bodyError = error;
  }
  await new Promise((r) => setTimeout(r, 1000));
  const closeHash = await broadcast(account, [closeEvmWindowMsg(account.cosmos)]);
  if (bodyError) throw bodyError;
  return { result, openHash, closeHash };
}

export async function sendScopedContractTx(opts: { account: UnifiedAccount; to: Address; data: Hex }): Promise<Hex> {
  const client = evmClient();
  const signer = privateKeyToAccount(opts.account.privateKey as Hex);
  const wallet = createWalletClient({ account: signer, chain: qorechainDiana, transport: http(TESTNET.evmRpc) });
  const gas = await client.estimateGas({ account: signer, to: opts.to, data: opts.data });
  const hash = await wallet.sendTransaction({ to: opts.to, data: opts.data, gas });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`EVM tx ${hash} reverted`);
  return hash;
}
