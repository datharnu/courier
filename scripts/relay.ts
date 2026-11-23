import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRelay } from "../src/ts/relay.js";
import { fileStore } from "../src/ts/relay-store.js";
import { testnetReader } from "../src/ts/chain.js";
import { evmClient } from "./lib/chain.js";
import { serve } from "./lib/serve.js";

const port = Number(process.env.PORT ?? "8787");
const { directory } = JSON.parse(readFileSync("deployments/prekey-directory.json", "utf8")) as { directory: string };
const domain = `127.0.0.1:${port}`;
/** `RELAY_STATE_FILE=memory` keeps the old in-memory behaviour. */
const stateSetting = process.env.RELAY_STATE_FILE ?? ".relay-state.json";
const statePath = stateSetting === "memory" ? undefined : resolve(stateSetting);
const relay = createRelay({
  chain: testnetReader({ client: evmClient(), directory }),
  domain,
  uri: `http://${domain}`,
  store: statePath ? fileStore(statePath) : undefined,
});
await serve(relay, port);
console.log(
  `relay on http://${domain}, directory ${directory}. ` +
    (statePath ? `State is saved to ${statePath}.` : "State is in memory."),
);
