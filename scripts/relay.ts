import { readFileSync } from "node:fs";
import { createRelay } from "../src/ts/relay.js";
import { testnetReader } from "../src/ts/chain.js";
import { evmClient } from "./lib/chain.js";
import { serve } from "./lib/serve.js";

const port = Number(process.env.PORT ?? "8787");
const { directory } = JSON.parse(readFileSync("deployments/prekey-directory.json", "utf8")) as { directory: string };
const domain = `127.0.0.1:${port}`;
const relay = createRelay({
  chain: testnetReader({ client: evmClient(), directory }),
  domain,
  uri: `http://${domain}`,
});
await serve(relay, port);
console.log(`relay on http://${domain}, directory ${directory}. State is in memory.`);
