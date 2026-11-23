import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { encodeFunctionResult, toHex, type Hex } from "viem";
import { PQC_STATUS, directoryAbi, pqcAbi } from "../lib/check";
import { demoBundleHash, parseDemoFixture } from "../lib/try/demo-keys";

/**
 * /app/try against a mocked chain: the page's eth_call reads are answered here, so the test needs no
 * network and does not depend on the demo bundle being live. The protocol runs for real in the page.
 */
const fixture = parseDemoFixture(JSON.parse(readFileSync(join(process.cwd(), "fixtures/demo/identities.json"), "utf8")));
const NOW = Math.floor(Date.now() / 1000);

async function mockChain(page: Page, opts: { expiry: number; now: number; hash?: string }) {
  const hash = (opts.hash ?? demoBundleHash(fixture, opts.expiry)) as Hex;
  await page.route("https://evm-testnet.qore.host/**", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as { id: number; method: string; params: unknown[] };
    let result: unknown = null;
    if (body.method === "eth_chainId") result = toHex(9800);
    else if (body.method === "eth_getBlockByNumber") result = { timestamp: toHex(opts.now) };
    else if (body.method === "eth_call") {
      const to = String((body.params[0] as { to: string }).to).toLowerCase();
      if (to === fixture.directory) {
        result = encodeFunctionResult({ abi: directoryAbi, functionName: "current", result: [hash, BigInt(opts.expiry), opts.expiry >= opts.now] });
      } else if (to === PQC_STATUS) {
        result = encodeFunctionResult({ abi: pqcAbi, functionName: "pqcKeyStatus", result: [true, 1, fixture.client.mldsaPublic as Hex, true] });
      }
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ jsonrpc: "2.0", id: body.id, result }) });
  });
}

test("honest relay: the vendor opens the message and the invoice, and replies with a ratchet step", async ({ page }) => {
  await mockChain(page, { expiry: NOW + 3 * 24 * 3600, now: NOW });
  await page.goto("/app/try");
  await expect(page.getByRole("heading", { name: "Catch a lying relay." })).toBeVisible();
  await expect(page.getByTestId("demo-warning")).toContainText("public on purpose, hold nothing");
  await expect(page.getByTestId("chain-state")).toContainText("Live.");
  await page.getByRole("button", { name: "Send message and invoice" }).click();
  await expect(page.getByTestId("delivered")).toContainText("1568-byte ML-KEM-1024 ciphertext", { timeout: 20_000 });
  await expect(page.getByTestId("vendor-pane")).toContainText("Invoice INV-0007 is attached.");
  await expect(page.getByTestId("client-pane")).toContainText("Received INV-0007.");
  await expect(page.getByTestId("invoice")).toContainText('"invoiceId":"INV-0007"');
  await expect(page.getByTestId("relay-pane")).not.toContainText("INV-0007");
});

test("lying relay: the client refuses with BUNDLE_HASH and seals nothing", async ({ page }) => {
  await mockChain(page, { expiry: NOW + 3 * 24 * 3600, now: NOW });
  await page.goto("/app/try");
  await expect(page.getByTestId("chain-state")).toContainText("Live.");
  await page.getByRole("radio", { name: /Lying/ }).click();
  await page.getByRole("button", { name: "Send message and invoice" }).click();
  const refusal = page.getByTestId("refusal");
  await expect(refusal).toContainText("Refused BUNDLE_HASH by the client", { timeout: 20_000 });
  await expect(page.getByTestId("chain-hash")).toHaveText(demoBundleHash(fixture, NOW + 3 * 24 * 3600));
  await expect(page.getByTestId("relay-hash")).not.toHaveText(demoBundleHash(fixture, NOW + 3 * 24 * 3600));
  await expect(page.getByTestId("sealed-bytes")).toHaveText("0");
  await expect(page.getByTestId("vendor-pane")).toContainText("Nothing received yet.");
});

test("a byte flipped in transit is refused by the vendor", async ({ page }) => {
  await mockChain(page, { expiry: NOW + 3 * 24 * 3600, now: NOW });
  await page.goto("/app/try");
  await expect(page.getByTestId("chain-state")).toContainText("Live.");
  await page.getByLabel("Flip one byte of the file-key message in transit").check();
  await page.getByRole("button", { name: "Send message and invoice" }).click();
  await expect(page.getByTestId("refusal")).toContainText("Refused AEAD by the vendor", { timeout: 20_000 });
});

test("an expired bundle is named on the page, not failed silently", async ({ page }) => {
  await mockChain(page, { expiry: NOW - 3600, now: NOW });
  await page.goto("/app/try");
  await expect(page.getByTestId("chain-state")).toContainText("expired at");
  await page.getByRole("button", { name: "Send message and invoice" }).click();
  await expect(page.getByTestId("refusal")).toContainText("Refused BUNDLE_EXPIRED", { timeout: 20_000 });
});

test("the page fits at 390px and the home page links to it", async ({ page }) => {
  await mockChain(page, { expiry: NOW + 3 * 24 * 3600, now: NOW });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/");
  await page.getByRole("link", { name: "Try it: catch a lying relay" }).first().click();
  await expect(page).toHaveURL(/\/app\/try$/);
  await expect(page.getByTestId("chain-state")).toContainText("Live.");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
