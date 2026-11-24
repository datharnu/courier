import { expect, test } from "@playwright/test";

/** /app/try against the real chain: no mocks. Reads only. Set COURIER_LIVE=1. */
test.describe("live /app/try", () => {
  test.skip(!process.env.COURIER_LIVE, "set COURIER_LIVE=1 to read the testnet");
  test.setTimeout(90_000);

  test.beforeEach(async ({ page }) => {
    await page.goto("/app/try");
    await expect(page.getByTestId("chain-state")).toContainText("Live.", { timeout: 60_000 });
    await expect(page.getByTestId("client-key")).toContainText("registered on chain, with proof of possession");
    await expect(page.getByTestId("vendor-registry")).toContainText("registered ML-KEM-1024 key");
    await expect(page.getByTestId("vendor-key")).toContainText("registered on chain");
  });

  test("honest relay delivers the message, the invoice and the reply", async ({ page }) => {
    await page.getByRole("button", { name: "Send message and invoice" }).click();
    await expect(page.getByTestId("delivered")).toContainText("1568-byte ML-KEM-1024 ciphertext", { timeout: 30_000 });
    await expect(page.getByTestId("vendor-pane")).toContainText("Client's ML-DSA-87 signature verifies");
    await expect(page.getByTestId("invoice")).toContainText('"invoiceId":"INV-0007"');
    await expect(page.getByTestId("client-pane")).toContainText("Received INV-0007.");
    await expect(page.getByTestId("kem-check")).toContainText("match");
    await expect(page.getByTestId("card-check")).toContainText("signature verifies");
  });

  test("lying relay is refused with BUNDLE_HASH against the on-chain hash", async ({ page }) => {
    await page.getByRole("radio", { name: "Lying (swap the vendor's prekey bundle)" }).click();
    await page.getByRole("button", { name: "Send message and invoice" }).click();
    await expect(page.getByTestId("refusal")).toContainText("Refused BUNDLE_HASH by the client", { timeout: 30_000 });
    await expect(page.getByTestId("sealed-bytes")).toHaveText("0");
    const chainHash = await page.getByTestId("chain-hash").textContent();
    await expect(page.getByTestId("relay-hash")).not.toHaveText(chainHash ?? "");
    console.log(`chain hash ${chainHash}`);
  });

  test("lying relay is refused with CARD when it swaps the card's X25519 key", async ({ page }) => {
    await page.getByRole("radio", { name: "Lying (swap the vendor's card key)" }).click();
    await page.getByRole("button", { name: "Send message and invoice" }).click();
    await expect(page.getByTestId("refusal")).toContainText("Refused CARD by the client", { timeout: 30_000 });
  });

  test("the REST rewrite serves only the KEM route", async ({ request }) => {
    const kem = await request.get("/chain-rest/kem/qor1ee5ypk25qvppjs7hqk7fcvf354rkcc9sqcak0u");
    expect(kem.ok()).toBe(true);
    expect(((await kem.json()) as { key?: { algorithm_id?: number } }).key?.algorithm_id).toBe(2);
    expect((await request.get("/chain-rest/kem/not-an-address")).status()).toBe(404);
    expect((await request.get("/chain-rest/cosmos/bank/v1beta1/balances/qor1ee5ypk25qvppjs7hqk7fcvf354rkcc9sqcak0u")).status()).toBe(404);
  });

  test("a flipped byte is refused with AEAD", async ({ page }) => {
    await page.getByLabel("Flip one byte of the file-key message in transit").check();
    await page.getByRole("button", { name: "Send message and invoice" }).click();
    await expect(page.getByTestId("refusal")).toContainText("Refused AEAD by the vendor", { timeout: 30_000 });
  });
});
