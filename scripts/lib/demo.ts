import { readFileSync } from "node:fs";
import { deriveUnifiedAccount, type UnifiedAccount } from "@qorechain/sdk";
import { parseDemoFixture, type DemoFixture } from "../../apps/web/lib/try/demo-keys.js";

/** The public demo identities behind /app/try. Public on purpose: they hold nothing. */
export const DEMO_FIXTURE = "apps/web/fixtures/demo/identities.json";

export function loadDemo(path = DEMO_FIXTURE): DemoFixture {
  return parseDemoFixture(JSON.parse(readFileSync(path, "utf8")));
}

/** Derives the account from the fixture's (public) mnemonic and checks it is the recorded address. */
export async function demoAccount(fixture: DemoFixture, role: "vendor" | "client"): Promise<UnifiedAccount> {
  const identity = fixture[role];
  const account = await deriveUnifiedAccount(identity.mnemonic);
  if (account.evm.toLowerCase() !== identity.evm) throw new Error(`${identity.name}: the mnemonic does not derive ${identity.evm}`);
  return account;
}
