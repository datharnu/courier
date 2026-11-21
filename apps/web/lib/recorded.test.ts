import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CAROL_BUNDLE, CAROL_EXPIRY, CAROL_PUBLISH, RECORD_HASH, VENDOR_BUNDLE, VENDOR_EXPIRY, VENDOR_PUBLISH, bundleLine } from "./recorded";

describe("recorded expiries", () => {
  it("states the recorded expiry and does not say whether the bundle is live", () => {
    expect(bundleLine(VENDOR_EXPIRY)).toBe("Recorded expiry 26 November 2026, 20:11 UTC. The signature can still be checked after that.");
    expect(bundleLine(CAROL_EXPIRY)).toBe("Recorded expiry 27 November 2026, 11:45 UTC. The signature can still be checked after that.");
    expect(bundleLine(VENDOR_EXPIRY)).not.toMatch(/Live|Expired/);
  });

  it("matches the deployment files", () => {
    const vendor = JSON.parse(readFileSync(join(process.cwd(), "../../deployments/prekey-directory.json"), "utf8")) as {
      publish: { publishHash: string; bundleHash: string; expiry: number };
    };
    const carol = JSON.parse(readFileSync(join(process.cwd(), "../../deployments/prekeys-courier-carol.json"), "utf8")) as {
      publishHash: string;
      bundleHash: string;
      expiry: number;
    };
    const group = JSON.parse(readFileSync(join(process.cwd(), "../../deployments/live-group.json"), "utf8")) as {
      receipt: { recordHash: string };
    };
    expect(vendor.publish.publishHash).toBe(VENDOR_PUBLISH);
    expect(vendor.publish.bundleHash).toBe(VENDOR_BUNDLE);
    expect(vendor.publish.expiry).toBe(VENDOR_EXPIRY);
    expect(carol.publishHash).toBe(CAROL_PUBLISH);
    expect(carol.bundleHash).toBe(CAROL_BUNDLE);
    expect(carol.expiry).toBe(CAROL_EXPIRY);
    expect(group.receipt.recordHash).toBe(RECORD_HASH);
  });
});
