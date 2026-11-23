import { expect, test } from "@playwright/test";

/** /app/try against the real chain: no mocks. Reads only. Set COURIER_LIVE=1. */
test.describe("live /app/try", () => {
  test.skip(!process.env.COURIER_LIVE, "set COURIER_LIVE=1 to read the testnet");
  test.setTimeout(90_000);

  test.beforeEach(async ({ page }) => {
    await page.goto("/app/try");
    await expect(page.getByTestId("chain-state")).toContainText("Live.", { timeout: 60_000 });
    await expect(page.getByTestId("client-key")).toContainText("registered on chain, with proof of possession");
  });

  test("honest relay delivers the message, the invoice and the reply", async ({ page }) => {
    await page.getByRole("button", { name: "Send message and invoice" }).click();
    await expect(page.getByTestId("delivered")).toContainText("1568-byte ML-KEM-1024 ciphertext", { timeout: 30_000 });
    await expect(page.getByTestId("vendor-pane")).toContainText("Client's ML-DSA-87 signature verifies");
    await expect(page.getByTestId("invoice")).toContainText('"invoiceId":"INV-0007"');
    await expect(page.getByTestId("client-pane")).toContainText("Received INV-0007.");
  });

  test("lying relay is refused with BUNDLE_HASH against the on-chain hash", async ({ page }) => {
    await page.getByRole("radio", { name: /Lying/ }).click();
    await page.getByRole("button", { name: "Send message and invoice" }).click();
    await expect(page.getByTestId("refusal")).toContainText("Refused BUNDLE_HASH by the client", { timeout: 30_000 });
    await expect(page.getByTestId("sealed-bytes")).toHaveText("0");
    const chainHash = await page.getByTestId("chain-hash").textContent();
    await expect(page.getByTestId("relay-hash")).not.toHaveText(chainHash ?? "");
    console.log(`chain hash ${chainHash}`);
  });

  test("a flipped byte is refused with AEAD", async ({ page }) => {
    await page.getByLabel("Flip one byte of the file-key message in transit").check();
    await page.getByRole("button", { name: "Send message and invoice" }).click();
    await expect(page.getByTestId("refusal")).toContainText("Refused AEAD by the vendor", { timeout: 30_000 });
  });
});
