import { existsSync } from "node:fs";
import { join } from "node:path";
import { TESTNET } from "haven-pq-kit/network";
import { broadcast, loadAccount } from "./lib/chain.js";
import { havenDir } from "./lib/secrets.js";

const NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;
const AMOUNT = 3_000_000n;
const ENOUGH = 2_000_000n;

function bank(address: string): Promise<bigint> {
  return fetch(`${TESTNET.rest}/cosmos/bank/v1beta1/balances/${address}`, { headers: { "user-agent": "haven" } })
    .then((res) => res.json() as Promise<{ balances: { denom: string; amount: string }[] }>)
    .then((body) => BigInt(body.balances.find((coin) => coin.denom === "uqor")?.amount ?? "0"));
}

async function main(): Promise<void> {
  const name = process.argv[2] ?? "";
  if (!NAME.test(name)) throw new Error("bad account name");
  if (name === "steward-agent") throw new Error("refusing steward-agent");
  if (name === "spike") throw new Error("refusing to fund spike");
  if (!existsSync(join(havenDir(), `${name}.env`))) {
    throw new Error(`create it first: cd ../haven-pq-kit && npm run pq -- new-account ${name}`);
  }

  const account = await loadAccount(name);
  const balance = await bank(account.cosmos);
  if (balance >= ENOUGH) {
    console.log(`already funded ${balance}`);
    return;
  }

  const deployer = await loadAccount("spike");
  const hash = await broadcast(
    deployer,
    [
      {
        typeUrl: "/cosmos.bank.v1beta1.MsgSend",
        value: {
          fromAddress: deployer.cosmos,
          toAddress: account.cosmos,
          amount: [{ denom: "uqor", amount: AMOUNT.toString() }],
        },
      },
    ],
    "hybrid",
  );
  const next = await bank(account.cosmos);
  console.log(account.cosmos);
  console.log(account.evm);
  console.log(hash);
  console.log(next.toString());
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
