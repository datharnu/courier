import { expect, test } from "@playwright/test";

for (const width of [390, 1440]) {
  test(`receipt replay fits at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/app/receipt");
    await expect(page.getByRole("heading", { name: "What happened on testnet." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Verify this step" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Verify all" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Verify this step" })).toHaveCount(3);
    await expect(page.getByTestId("vendor-bundle-state")).toHaveText("Recorded expiry 26 November 2026, 20:11 UTC. The signature can still be checked after that.");
    await expect(page.getByTestId("carol-bundle-state")).toHaveText("Recorded expiry 27 November 2026, 11:45 UTC. The signature can still be checked after that.");
    await expect(page.getByTestId("receipt-state")).toHaveText("The receipt does not expire.");
    await expect(page.getByText("The relay is not called.")).toBeVisible();
    await expect(page.getByText("They have no transaction to fetch.")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}
