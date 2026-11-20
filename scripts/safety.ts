import { readFileSync } from "node:fs";

import { testnetReader } from "../src/ts/chain.js";
import { safetyNumberFor } from "../src/ts/safety.js";
import { evmClient, loadAccount } from "./lib/chain.js";

const { directory } = JSON.parse(readFileSync("deployments/prekey-directory.json", "utf8")) as { directory: string };
const chain = testnetReader({ client: evmClient(), directory });
const spike = await loadAccount("spike");
const vendor = await loadAccount("steward-vendor");
console.log(await safetyNumberFor(chain, spike.evm, vendor.evm));
