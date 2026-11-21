import { expect, test } from "@playwright/test";

test("verify all reads the three recorded signatures", async ({ page }) => {
  test.skip(!process.env.COURIER_LIVE, "set COURIER_LIVE=1 to read the testnet");
  test.setTimeout(90_000);
  await page.goto("/app/receipt");
  await page.getByRole("button", { name: "Verify all" }).click();
  await expect(page.getByText("The signature matches the registered key and the message this call builds.")).toHaveCount(3, { timeout: 60_000 });
  await expect(page.getByText("Could not reach the testnet")).toHaveCount(0);
});
