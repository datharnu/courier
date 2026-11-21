/** Public fields copied from `deployments/`. The signature bytes are not here. */

export const DIRECTORY = "0x3d9a5821d0a24220a5f244a63a4a641d2acd9c2d";
export const DELIVERY_RECEIPTS = "0x06b52afc4a151b0efa260e2adcdf2d477632cb56";

export const VENDOR = "0xf09cc23e992a4591a456836d7223655399d0bb90";
export const VENDOR_PUBLISH = "0x1d38945c94ea384f8d0f4c1338d858d6edc7d34fd54cf2cf251242e44e61555e";
export const VENDOR_BUNDLE = "0x9306826eb46977b32639a004ad992c868c5614d703fbb9a8e8cc08309b13e79f";
export const VENDOR_EXPIRY = 1795723898;

export const CAROL = "0x5f704d258733e4cc8a776ec8306144c84f1ebacf";
export const CAROL_PUBLISH = "0x994a39fc67a0082ac29cb0932ce95e1e4d8f1df0893325b808d4fb89b835adf0";
export const CAROL_BUNDLE = "0x157c35bd5c1ffd5eb7606d33bc93183096184fc438155048e5d5bd5f07dbf6f0";
export const CAROL_EXPIRY = 1795779952;

export const RECORD_HASH = "0x3dfdb6bdf8a11a81792129083642f706a9b4547a62d4d8ebbe3eceb645566a89";
export const CONVERSATION = "0xee9e929e97f3b026bd1c537e98d628c60005d8d522b74a4104d94055012cb714";
export const RECEIPT_COUNTER = 1;
export const CIPHERTEXT = "0xfc27eb2fe70148486add26083d5b15ccdbd8e5a2ad9b913280fe9349fb4e6e4f";
export const SUBMITTER = "0xac52f45e6787c08e3b22f45e7f35803fc13e7396";

export type RecordedCheck = {
  id: string;
  title: string;
  hash: string;
  kind: "bundle" | "receipt";
};

export const RECORDED_CHECKS: RecordedCheck[] = [
  { id: "vendor-bundle", title: "Vendor bundle", hash: VENDOR_PUBLISH, kind: "bundle" },
  { id: "carol-bundle", title: "Carol bundle", hash: CAROL_PUBLISH, kind: "bundle" },
  { id: "receipt", title: "Delivery receipt", hash: RECORD_HASH, kind: "receipt" },
];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function utcStamp(unix: number): string {
  const date = new Date(unix * 1000);
  const hours = date.getUTCHours().toString().padStart(2, "0");
  const minutes = date.getUTCMinutes().toString().padStart(2, "0");
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}, ${hours}:${minutes} UTC`;
}

/** The standing line. It states the recorded expiry and does not say whether the bundle is live. */
export function bundleLine(expiryUnix: number): string {
  return `Recorded expiry ${utcStamp(expiryUnix)}. The signature can still be checked after that.`;
}
