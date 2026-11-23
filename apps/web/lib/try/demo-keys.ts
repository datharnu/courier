/**
 * The two demo identities behind /app/try. Their secret keys are in the repository on purpose:
 * anyone can read them, so they protect nothing and hold nothing. They exist so a visitor can run
 * the real handshake and ratchet in a browser against a bundle hash that is really on chain.
 *
 * `scripts/demo-identities.ts --create` wrote `apps/web/fixtures/demo/identities.json`. The vendor's
 * prekeys are fixed: a renewal publishes the same keys with a new expiry, so the page keeps working
 * after `npm run renew -- --send` without a redeploy.
 */
import { hexToBytes, type Hex } from "viem";
import { bundleHash, type Bundle, type BundleSecrets, type OneTimePublic } from "../protocol/bundle";

export const DEMO_WARNING = "Demo keys: public on purpose, hold nothing. Anyone can sign as these two testnet accounts; they carry only test QOR for fees.";
export const DEMO_VENDOR = "courier-demo-vendor";
export const DEMO_CLIENT = "courier-demo-client";

export type DemoVendor = {
  name: typeof DEMO_VENDOR;
  mnemonic: string;
  cosmos: string;
  evm: string;
  /** ML-KEM-1024 identity key: the key `pq register-kem` puts in the chain's KEM registry. */
  identityKem: string;
  identityX25519Public: string;
  identityX25519Secret: string;
  prekeys: {
    signedPrekey: string;
    lastResortKem: string;
    oneTime: OneTimePublic[];
    secrets: { signedPrekey: string; lastResortKem: string; oneTime: { kem: string; x25519: string }[] };
  };
};

export type DemoClient = {
  name: typeof DEMO_CLIENT;
  mnemonic: string;
  cosmos: string;
  evm: string;
  mldsaPublic: string;
  mldsaSecret: string;
  identityX25519Public: string;
  identityX25519Secret: string;
};

export type DemoFixture = {
  warning: string;
  network: "qorechain-diana";
  directory: string;
  vendor: DemoVendor;
  client: DemoClient;
};

const HEX = /^0x[0-9a-f]*$/;

export function parseDemoFixture(value: unknown): DemoFixture {
  const fixture = value as DemoFixture;
  const ok =
    fixture &&
    fixture.network === "qorechain-diana" &&
    fixture.vendor?.name === DEMO_VENDOR &&
    fixture.client?.name === DEMO_CLIENT &&
    /^0x[0-9a-f]{40}$/.test(fixture.directory) &&
    /^0x[0-9a-f]{40}$/.test(fixture.vendor.evm) &&
    /^0x[0-9a-f]{40}$/.test(fixture.client.evm) &&
    [fixture.vendor.identityKem, fixture.vendor.identityX25519Secret, fixture.client.mldsaSecret].every(
      (hex) => typeof hex === "string" && HEX.test(hex),
    );
  if (!ok) throw new Error("the demo identities file is not in the expected shape");
  return fixture;
}

/** The vendor's published bundle for a given expiry. Only the expiry changes between renewals. */
export function demoBundle(fixture: DemoFixture, expiry: number): Bundle {
  const prekeys = fixture.vendor.prekeys;
  return {
    expiry,
    identityKem: fixture.vendor.identityKem,
    lastResortKem: prekeys.lastResortKem,
    oneTime: prekeys.oneTime.map((entry) => ({ kem: entry.kem, x25519: entry.x25519 })),
    signedPrekey: prekeys.signedPrekey,
  };
}

export function demoBundleHash(fixture: DemoFixture, expiry: number): string {
  return bundleHash(demoBundle(fixture, expiry));
}

/** Fresh copies every call: the protocol wipes secrets it has used. */
export function demoSecrets(fixture: DemoFixture): BundleSecrets {
  const secrets = fixture.vendor.prekeys.secrets;
  return {
    signedPrekey: bytesOf(secrets.signedPrekey),
    lastResortKem: bytesOf(secrets.lastResortKem),
    oneTime: secrets.oneTime.map((entry) => ({ kem: bytesOf(entry.kem), x25519: bytesOf(entry.x25519) })),
  };
}

export function bytesOf(hex: string): Uint8Array {
  return hexToBytes(hex as Hex);
}
