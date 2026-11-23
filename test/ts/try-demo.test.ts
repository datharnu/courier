import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { bytesOf, demoBundleHash, parseDemoFixture } from "../../apps/web/lib/try/demo-keys.js";
import { ZERO_HASH, bundleState, runDemo, type ChainView, type DemoInput } from "../../apps/web/lib/try/flow.js";

/** The committed public demo identities. The chain read is mocked: no network. */
const fixture = parseDemoFixture(JSON.parse(readFileSync("apps/web/fixtures/demo/identities.json", "utf8")));
const NOW = 1_795_500_000;
const EXPIRY = NOW + 3 * 24 * 3600;
const INVOICE = JSON.stringify({ invoiceId: "INV-0007", amount: "10000", token: "fUSD", payee: "registered payout" });

function chain(overrides: Partial<ChainView> = {}): ChainView {
  return { hash: demoBundleHash(fixture, EXPIRY), expiry: EXPIRY, live: true, now: NOW, clientMldsa: bytesOf(fixture.client.mldsaPublic), ...overrides };
}

function input(overrides: Partial<DemoInput> = {}): DemoInput {
  return {
    fixture,
    chain: chain(),
    relay: "honest",
    tamper: false,
    message: "Invoice INV-0007 attached.",
    invoice: { name: "INV-0007.json", text: INVOICE },
    reply: "Received. Paying through MemoPay.",
    ...overrides,
  };
}

test("honest relay: handshake, message, invoice file and a reply with an ML-KEM ratchet step", () => {
  const run = runDemo(input());
  assert.equal(run.outcome, "delivered", JSON.stringify(run.refusal));
  assert.equal(run.relayHash, run.chainHash);
  assert.equal(run.invoiceText, INVOICE);
  assert.ok(run.vendor.some((line) => line.tone === "received" && line.text === "Invoice INV-0007 attached."));
  assert.ok(run.client.some((line) => line.tone === "received" && line.text === "Received. Paying through MemoPay."));
  assert.deepEqual(run.kemStep, { ciphertextBytes: 1568 });
  assert.ok(run.sealedBytes > 0);
  // The relay holds ciphertext only: neither the message nor the invoice appears in what it stored.
  const held = JSON.stringify(run.relay);
  assert.ok(!held.includes("INV-0007") && !held.includes(Buffer.from("INV-0007").toString("hex")));
});

test("every run is a fresh conversation, so the demo repeats", () => {
  const first = runDemo(input());
  const second = runDemo(input());
  assert.equal(first.outcome, "delivered");
  assert.equal(second.outcome, "delivered");
  assert.notEqual(first.relay[1].preview, second.relay[1].preview);
});

test("lying relay: the swapped bundle is refused with BUNDLE_HASH before anything is sealed", () => {
  const run = runDemo(input({ relay: "lying" }));
  assert.equal(run.outcome, "refused");
  assert.equal(run.refusal?.code, "BUNDLE_HASH");
  assert.equal(run.refusal?.by, "client");
  assert.notEqual(run.relayHash, run.chainHash);
  assert.equal(run.sealedBytes, 0);
  assert.ok(run.relay.every((item) => item.from === "relay"), "the client posted nothing");
  assert.equal(run.vendor.length, 0);
});

test("a byte flipped in transit is refused with AEAD by the vendor", () => {
  const run = runDemo(input({ tamper: true }));
  assert.equal(run.outcome, "refused");
  assert.equal(run.refusal?.code, "AEAD");
  assert.equal(run.refusal?.by, "vendor");
  assert.equal(run.invoiceText, undefined);
  assert.ok(run.relay.some((item) => item.tampered));
});

test("an expired bundle is refused with BUNDLE_EXPIRED and reported as expired", () => {
  const view = chain({ now: EXPIRY + 60, live: false });
  assert.equal(bundleState(view).kind, "expired");
  const run = runDemo(input({ chain: view }));
  assert.equal(run.refusal?.code, "BUNDLE_EXPIRED");
  assert.equal(run.sealedBytes, 0);
});

test("a bundle the chain does not hold is refused even from an honest relay", () => {
  const run = runDemo(input({ chain: chain({ hash: demoBundleHash(fixture, EXPIRY + 1) }) }));
  assert.equal(run.refusal?.code, "BUNDLE_HASH");
});

test("a client without a registered ML-DSA-87 key is refused by the vendor", () => {
  const run = runDemo(input({ chain: chain({ clientMldsa: null }) }));
  assert.equal(run.refusal?.code, "SIGNATURE");
  assert.equal(run.refusal?.by, "vendor");
});

test("bundle state: unpublished, live, expired", () => {
  assert.equal(bundleState({ hash: ZERO_HASH, expiry: 0, live: false, now: NOW }).kind, "unpublished");
  const live = bundleState(chain());
  assert.equal(live.kind, "live");
  assert.equal(live.kind === "live" && Math.round(live.hoursLeft), 72);
});
