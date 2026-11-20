import { readFileSync, writeFileSync } from "node:fs";
import { classicalKeyFromPrivate } from "@qorechain/qoresign";
import { hexToBytes, keccak256, type Hex } from "viem";

import { bundleHash, createBundle, type Bundle, type BundleSecrets } from "../src/ts/bundle.js";
import { testnetReader, toEvm } from "../src/ts/chain.js";
import { CourierClient, type Identity, type Received } from "../src/ts/client.js";
import { createRelay } from "../src/ts/relay.js";
import { evmClient, loadAccount, loadSealKeys } from "./lib/chain.js";
import { prekeyPath, writePrivate } from "./lib/secrets.js";
import { serve } from "./lib/serve.js";

const SENDER = "spike";
const RECIPIENT = "steward-vendor";
const PORT = 8788;
const REPORT = "deployments/live-exchange.json";

type StoredPrekeys = {
  owner: string;
  bundleHash: string;
  expiry: number;
  signedPrekey: string;
  lastResortKem: string;
  oneTime: { kem: string; x25519: string }[];
  used: number[];
};

async function identity(name: string): Promise<Identity> {
  const account = await loadAccount(name);
  return {
    cosmos: account.cosmos,
    evm: toEvm(account.evm),
    mldsaSecret: account.pqc.secretKey,
    classicalKey: classicalKeyFromPrivate(hexToBytes(account.privateKey as Hex), "eth_secp256k1"),
    seal: loadSealKeys(name),
  };
}

function loadPrekeys(name: string): { stored: StoredPrekeys; secrets: BundleSecrets; used: Set<number> } {
  const stored = JSON.parse(readFileSync(prekeyPath(name), "utf8")) as StoredPrekeys;
  const bytes = (hex: string) => (hex ? hexToBytes(hex as Hex) : new Uint8Array());
  return {
    stored,
    secrets: {
      signedPrekey: bytes(stored.signedPrekey),
      lastResortKem: bytes(stored.lastResortKem),
      oneTime: stored.oneTime.map((entry) => ({ kem: bytes(entry.kem), x25519: bytes(entry.x25519) })),
    },
    used: new Set(stored.used),
  };
}

/** A consumed entry's secrets are erased from the file too, not only from memory. */
function savePrekeys(name: string, stored: StoredPrekeys, used: Set<number>): void {
  const next: StoredPrekeys = {
    ...stored,
    used: [...used].sort((a, b) => a - b),
    oneTime: stored.oneTime.map((entry, i) => (used.has(i) ? { kem: "", x25519: "" } : entry)),
  };
  writePrivate(prekeyPath(name), `${JSON.stringify(next, null, 2)}\n`);
}

function summary(items: Received[]): string[] {
  return items.map((item) => {
    if (!item.ok) return `refused ${item.code}`;
    if (item.payload.t === "text") return `text "${item.payload.body}"`;
    if (item.payload.t === "file") return `file ${item.payload.name} (${item.payload.size} bytes)`;
    if (item.payload.t === "invoice") return `invoice ${item.payload.invoiceId}`;
    if (item.payload.t === "receipt") return `receipt #${item.payload.counter}`;
    return `${item.payload.t} ${item.payload.groupId.slice(0, 10)}`;
  });
}

async function main(): Promise<void> {
  const { directory } = JSON.parse(readFileSync("deployments/prekey-directory.json", "utf8")) as { directory: string };
  const chain = testnetReader({ client: evmClient(), directory });
  const domain = `127.0.0.1:${PORT}`;
  const server = await serve(createRelay({ chain, domain, uri: `http://${domain}` }), PORT);
  const relay = `http://${domain}`;

  try {
    const sender = await identity(SENDER);
    const recipient = await identity(RECIPIENT);
    const { stored, secrets, used } = loadPrekeys(RECIPIENT);
    const bundle = JSON.parse(readFileSync(`deployments/bundles/${RECIPIENT}.json`, "utf8")) as Bundle;
    const onChain = await chain.directory(recipient.evm);
    if (bundleHash(bundle) !== onChain.hash || stored.bundleHash !== onChain.hash) {
      throw new Error("the local bundle is not the one on chain; run npm run deploy:directory");
    }
    if (!onChain.live) throw new Error("the bundle on chain has expired; run npm run deploy:directory");

    const vendor = new CourierClient({ relay, chain, identity: recipient });
    const spike = new CourierClient({ relay, chain, identity: sender });
    vendor.usePrekeys({ bundle, secrets, used });
    await vendor.publishCard();
    await spike.publishCard();
    await vendor.publishBundle();

    const steps: { step: string; result: string[] }[] = [];

    const liar = new CourierClient({
      relay,
      chain,
      identity: sender,
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const res = await fetch(input, init);
        if (!new URL(String(input)).pathname.startsWith("/v1/bundles/")) return res;
        const body = (await res.json()) as { bundle: Bundle; oneTimeIndex: number | null };
        const swapped = createBundle(hexToBytes(body.bundle.identityKem as Hex), body.bundle.expiry).bundle;
        return new Response(JSON.stringify({ ...body, bundle: swapped }), { status: 200 });
      }) as typeof fetch,
    });
    try {
      await liar.start(recipient.evm, { t: "text", body: "this must not be sealed" });
      throw new Error("a swapped bundle was accepted");
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "BUNDLE_HASH") throw error;
      steps.push({ step: "a relay swaps the vendor's bundle", result: [`refused ${code}, nothing sealed`] });
    }

    const conversationId = (
      await spike.start(recipient.evm, {
        t: "text",
        body: "Invoice INV-0007 is ready. Reply to confirm the payee.",
      })
    ).conversationId;
    const first = await vendor.receive();
    savePrekeys(RECIPIENT, stored, used);
    steps.push({ step: "spike opens a conversation with the vendor", result: summary(first) });

    await vendor.sendText(conversationId, "Confirmed. Pay the registered payout address.");
    steps.push({ step: "the vendor replies", result: summary(await spike.receive()) });

    const invoice = new TextEncoder().encode(
      JSON.stringify({ invoiceId: "INV-0007", amount: "10000", token: "fUSD", payee: "registered payout" }),
    );
    const fileId = await vendor.sendFile([conversationId], "INV-0007.json", invoice);
    const got = await spike.receive();
    let fileCheck = "missing";
    if (got[0]?.ok && got[0].payload.t === "file") {
      const opened = await spike.fetchFile(got[0].payload);
      fileCheck = keccak256(opened) === keccak256(invoice) ? "opened, hash matches" : "opened, hash differs";
    }
    steps.push({ step: "the vendor sends the invoice as a file", result: [...summary(got), fileCheck] });

    await spike.sendText(conversationId, "Received. Queued for payment.");
    steps.push({ step: "spike answers", result: summary(await vendor.receive()) });

    const ok = steps.every((s) => !s.result.some((line) => line.startsWith("refused") && !s.step.startsWith("a relay")));
    const report = {
      network: chain.chainId,
      ranAt: new Date().toISOString(),
      relay: "in-process, real HTTP on 127.0.0.1, state in memory",
      directory,
      sender: { name: SENDER, cosmos: sender.cosmos, evm: sender.evm },
      recipient: { name: RECIPIENT, cosmos: recipient.cosmos, evm: recipient.evm },
      bundleHashOnChain: onChain.hash,
      bundleExpiry: onChain.expiry,
      oneTimeEntriesUsed: [...used].sort((a, b) => a - b),
      conversationId,
      fileId,
      chainReads: [
        "PrekeyDirectory.current(vendor) through eth_call",
        "pqcKeyStatus for both accounts, possession proven, 2,592-byte ML-DSA-87 keys",
        "the KEM registry for both accounts, checked against each recipient card's SHA3-256",
      ],
      steps,
      ok,
    };
    writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    if (!ok) process.exitCode = 1;
  } finally {
    server.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
