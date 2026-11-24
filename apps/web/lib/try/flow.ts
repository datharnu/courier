/**
 * The /app/try run: a client and a vendor in one page, an in-page relay between them, and the
 * vendor's bundle hash and the client's ML-DSA-87 key read from QoreChain. Every seal, open and
 * refusal below is the protocol code in `src/ts` (copied into `../protocol`, only the `.js` import suffixes dropped).
 *
 * The relay is the untrusted party. In "lying" mode it hands the client a bundle it made itself,
 * with keys it holds. The client compares that bundle's hash with `PrekeyDirectory.current(vendor)`
 * and refuses with BUNDLE_HASH before sealing anything.
 *
 * Every handshake uses the vendor's last-resort ML-KEM prekey (one-time index null). The demo keys
 * are public and every page load starts a fresh vendor, so a one-time entry could not stay
 * "one-time" across visitors. The last-resort prekey is the one the protocol already reuses; each
 * run still has a fresh ephemeral X25519 key and a fresh ML-KEM encapsulation.
 */
import { randomBytes } from "@noble/ciphers/utils.js";
import { verifyRecipientCard, x25519PublicKey, type RecipientCard } from "@qorechain/qoreseal";
import { bytesToHex, keccak256, type Hex } from "viem";
import { canonical, CourierError, utf8 } from "../protocol/bytes";
import { bundleHash, createBundle, type Bundle } from "../protocol/bundle";
import { openFile, sealFile, type FileBlob } from "../protocol/file";
import { acceptHandshake, startHandshake, type HandshakeMessage } from "../protocol/handshake";
import type { Envelope, Session } from "../protocol/session";
import { bytesOf, demoBundle, demoSecrets, type DemoFixture } from "./demo-keys";

/** A KEM step every 2 messages, so the vendor's first reply already carries an ML-KEM-1024 ciphertext. */
export const DEMO_KEM_EVERY = 2;
export const ZERO_HASH = `0x${"0".repeat(64)}`;

/** "lying" swaps the vendor's prekey bundle; "lying-card" swaps the X25519 key in the vendor's recipient card. */
export type RelayMode = "honest" | "lying" | "lying-card";

/**
 * What the page read from the chain. A null key means the chain has none (or could not be read): the
 * page never falls back to the demo file for it.
 */
export type ChainView = {
  hash: string;
  expiry: number;
  live: boolean;
  now: number;
  clientMldsa: Uint8Array | null;
  /** The vendor's ML-DSA-87 key from `pqcKeyStatus`. It verifies the vendor's recipient card. */
  vendorMldsa: Uint8Array | null;
  /** The vendor's ML-KEM-1024 key from the chain's KEM registry, lowercase 0x hex. */
  vendorRegistryKem: string | null;
};

/** What the client compared before sealing: chain on one side, relay on the other. */
export type KeyChecks = {
  registryKem: string | null;
  bundleIdentityKem: string;
  cardX25519: string;
  cardVerified: boolean;
};

export type BundleState =
  | { kind: "live"; hash: string; expiry: number; hoursLeft: number }
  | { kind: "expired"; hash: string; expiry: number }
  | { kind: "unpublished" };

export function bundleState(chain: Pick<ChainView, "hash" | "expiry" | "live" | "now">): BundleState {
  if (chain.hash.toLowerCase() === ZERO_HASH || chain.expiry === 0) return { kind: "unpublished" };
  if (!chain.live || chain.expiry < chain.now) return { kind: "expired", hash: chain.hash, expiry: chain.expiry };
  return { kind: "live", hash: chain.hash, expiry: chain.expiry, hoursLeft: (chain.expiry - chain.now) / 3600 };
}

export type PaneLine = {
  tone: "sent" | "received" | "check" | "refused" | "file";
  text: string;
  detail?: string;
};

export type RelayItem = {
  label: string;
  from: "client" | "vendor" | "relay";
  bytes: number;
  /** The start of what the relay holds, as hex. */
  preview: string;
  tampered?: boolean;
};

export type Refusal = { code: string; by: "client" | "vendor"; reason: string };

export type DemoRun = {
  outcome: "delivered" | "refused";
  refusal?: Refusal;
  /** keccak256 of the bundle the relay handed over, and the hash the chain holds. */
  relayHash: string;
  chainHash: string;
  /** Bytes the client sealed and posted. 0 when the bundle check refused. */
  sealedBytes: number;
  client: PaneLine[];
  vendor: PaneLine[];
  relay: RelayItem[];
  invoiceText?: string;
  kemStep?: { ciphertextBytes: number };
  keys?: KeyChecks;
};

export type DemoInput = {
  fixture: DemoFixture;
  chain: ChainView;
  relay: RelayMode;
  tamper: boolean;
  message: string;
  invoice: { name: string; text: string };
  reply: string;
};

type Payload = { t: "text"; body: string } | { t: "file"; id: string; key: string; hash: string; name: string; size: number };

/** The in-page relay. It stores ciphertext and hands out bundles. It can lie. */
class PageRelay {
  readonly items: RelayItem[] = [];
  readonly files = new Map<string, FileBlob>();
  private forged?: Bundle;

  constructor(
    private readonly mode: RelayMode,
    private readonly fixture: DemoFixture,
    private readonly chain: ChainView,
  ) {}

  /** The honest relay serves the vendor's signed bundle. The lying one serves a bundle whose keys it holds. */
  bundle(): Bundle {
    const genuine = demoBundle(this.fixture, this.chain.expiry);
    if (this.mode !== "lying") return genuine;
    this.forged ??= createBundle(bytesOf(this.fixture.vendor.identityKem), genuine.expiry).bundle;
    return this.forged;
  }

  /** The vendor's recipient card. The lying-card relay swaps in an X25519 key it holds. */
  card(): RecipientCard {
    const genuine = this.fixture.vendor.card;
    if (this.mode !== "lying-card") return genuine;
    const own = bytesToHex(x25519PublicKey(randomBytes(32))).slice(2);
    return { ...genuine, x25519PublicKey: own };
  }

  post(item: RelayItem): void {
    this.items.push(item);
  }
}

export function runDemo(input: DemoInput): DemoRun {
  const { fixture, chain } = input;
  const relay = new PageRelay(input.relay, fixture, chain);
  const client: PaneLine[] = [];
  const vendor: PaneLine[] = [];
  const chainHash = chain.hash.toLowerCase();
  let sealedBytes = 0;
  let relayHash = "";
  const run = (outcome: DemoRun["outcome"], extra: Partial<DemoRun> = {}): DemoRun => ({
    outcome,
    relayHash,
    chainHash,
    sealedBytes,
    client,
    vendor,
    relay: relay.items,
    ...extra,
  });

  // 1. The client asks the relay for the vendor's bundle.
  const offered = relay.bundle();
  relayHash = bundleHash(offered);
  relay.post({ label: "Vendor bundle handed to the client", from: "relay", bytes: utf8(canonical(offered)).length, preview: preview(relayHash) });
  client.push({
    tone: "check",
    text: `Relay sent a bundle hashing to ${short(relayHash)}. The chain says ${short(chainHash)}.`,
  });

  // 2. The bundle against the chain: its hash against PrekeyDirectory, its identity key against the KEM registry.
  //    startHandshake repeats both checks; doing them here first lets the page show each one.
  const registryKem = chain.vendorRegistryKem?.toLowerCase() ?? null;
  const offeredCard = relay.card();
  relay.post({ label: "Vendor recipient card handed to the client", from: "relay", bytes: utf8(JSON.stringify(offeredCard)).length, preview: `0x${offeredCard.x25519PublicKey}` });
  const keys: KeyChecks = { registryKem, bundleIdentityKem: offered.identityKem, cardX25519: `0x${offeredCard.x25519PublicKey}`, cardVerified: false };
  const refuse = (code: string, reason: string): DemoRun => {
    const refusal: Refusal = { code, by: "client", reason };
    client.push({ tone: "refused", text: `Refused ${code}: ${reason}. Nothing was sealed.` });
    return run("refused", { refusal, keys });
  };
  if (relayHash !== chainHash) return refuse("BUNDLE_HASH", "bundle does not match the chain");
  if (!registryKem) return refuse("IDENTITY_KEM", "the chain's KEM registry could not be read for the vendor, and the page does not fall back to the demo file");
  if (offered.identityKem !== registryKem) return refuse("IDENTITY_KEM", "the bundle's identity ML-KEM key is not the key in the chain's KEM registry");
  client.push({ tone: "check", text: `Bundle identity ML-KEM-1024 key matches the chain's KEM registry (${short(registryKem)}).` });

  // 3. The recipient card: the X25519 key is not stored on chain. The card carries it, signed with the vendor's
  //    ML-DSA-87 key (read from the chain) and naming the registry ML-KEM key by its SHA3-256.
  if (!chain.vendorMldsa) return refuse("CARD", "the vendor has no registered ML-DSA-87 key on chain to check its card against");
  let vendorX25519: Uint8Array;
  try {
    const verified = verifyRecipientCard({
      card: offeredCard,
      chainId: fixture.network,
      address: fixture.vendor.cosmos,
      pqPublicKey: chain.vendorMldsa,
      mlkemPublicKey: bytesOf(registryKem),
    });
    if (!verified.x25519PublicKey) throw new Error("the card has no X25519 key");
    vendorX25519 = verified.x25519PublicKey;
  } catch (error) {
    return refuse("CARD", `the vendor's recipient card does not verify under its on-chain keys (${error instanceof Error ? error.message : "refused"})`);
  }
  keys.cardVerified = true;
  client.push({ tone: "check", text: `Recipient card X25519 key ${short(keys.cardX25519)} is signed by the vendor's on-chain ML-DSA-87 key.` });

  // 4. Handshake and first message. startHandshake checks the hash, the registry key and the expiry again.
  let handshake: HandshakeMessage;
  let clientSession: Session;
  try {
    ({ handshake, session: clientSession } = startHandshake({
      sender: {
        address: fixture.client.evm,
        mldsaSecret: bytesOf(fixture.client.mldsaSecret),
        identityX25519Secret: bytesOf(fixture.client.identityX25519Secret),
      },
      recipient: { address: fixture.vendor.evm, identityX25519Public: vendorX25519 },
      bundle: offered,
      chainHash,
      registryKem,
      oneTimeIndex: null,
      now: chain.now,
      plaintext: utf8(canonical({ t: "text", body: input.message })),
      kemEvery: DEMO_KEM_EVERY,
    }));
  } catch (error) {
    const refusal = refusalOf(error, "client");
    client.push({ tone: "refused", text: `Refused ${refusal.code}: ${refusal.reason}. Nothing was sealed.` });
    return run("refused", { refusal, keys });
  }
  const handshakeBytes = utf8(canonical(handshake)).length;
  sealedBytes += handshakeBytes;
  relay.post({ label: "Handshake + first message", from: "client", bytes: handshakeBytes, preview: preview(handshake.kemCiphertext) });
  client.push({ tone: "check", text: "Bundle hash matches the chain and the bundle is not expired." });
  client.push({ tone: "sent", text: input.message, detail: "Handshake: 3 X25519 + ML-KEM-1024 to the last-resort prekey, signed with ML-DSA-87." });

  // 3. The invoice file: its own random key, the key inside a ratchet message.
  const invoiceBytes = utf8(input.invoice.text);
  const { blob, key } = sealFile(invoiceBytes);
  const fileId = keccak256(blob.ciphertext as Hex);
  relay.files.set(fileId, blob);
  relay.post({ label: "Encrypted file (the name travels inside message 1)", from: "client", bytes: (blob.ciphertext.length - 2) / 2, preview: preview(blob.ciphertext) });
  const filePayload: Payload = { t: "file", id: fileId, key: bytesToHex(key), hash: blob.hash, name: input.invoice.name, size: invoiceBytes.length };
  key.fill(0);
  const fileEnvelope = clientSession.send(utf8(canonical(filePayload)));
  sealedBytes += (blob.ciphertext.length - 2) / 2 + (fileEnvelope.ciphertext.length - 2) / 2;
  const carried = input.tamper ? flipByte(fileEnvelope) : fileEnvelope;
  relay.post({
    label: input.tamper ? "Ratchet message 1 (file key) - one byte flipped in transit" : "Ratchet message 1 (file key)",
    from: "client",
    bytes: (carried.ciphertext.length - 2) / 2,
    preview: preview(carried.ciphertext),
    tampered: input.tamper || undefined,
  });
  client.push({ tone: "file", text: `${input.invoice.name} (${invoiceBytes.length} bytes) sealed with its own key; the key rides in ratchet message 1.` });

  // 4. The vendor opens the handshake. The client's signature is checked against its on-chain ML-DSA-87 key.
  if (!chain.clientMldsa) {
    const refusal: Refusal = { code: "SIGNATURE", by: "vendor", reason: "the client has no registered ML-DSA-87 key on chain" };
    vendor.push({ tone: "refused", text: `Refused ${refusal.code}: ${refusal.reason}.` });
    return run("refused", { refusal, keys });
  }
  let vendorSession: Session;
  try {
    const opened = acceptHandshake({
      handshake,
      bundle: demoBundle(fixture, chain.expiry),
      secrets: demoSecrets(fixture),
      recipientIdentityX25519Secret: bytesOf(fixture.vendor.identityX25519Secret),
      senderMldsaPublic: chain.clientMldsa,
      senderCardX25519: fixture.client.identityX25519Public,
      chainHash,
      registryKem,
      now: chain.now,
      used: new Set<number>(),
      kemEvery: DEMO_KEM_EVERY,
    });
    vendorSession = opened.session;
    const first = parsePayload(opened.plaintext);
    vendor.push({ tone: "check", text: "Client's ML-DSA-87 signature verifies under the key registered on chain." });
    vendor.push({ tone: "received", text: first.t === "text" ? first.body : "(not text)" });
  } catch (error) {
    const refusal = refusalOf(error, "vendor");
    vendor.push({ tone: "refused", text: `Refused ${refusal.code}: ${refusal.reason}.` });
    return run("refused", { refusal, keys });
  }

  // 5. The file key message, then the file from the relay.
  let invoiceText: string;
  try {
    const payload = parsePayload(vendorSession.receive(carried));
    if (payload.t !== "file") throw new CourierError("AEAD", "expected a file message");
    const stored = relay.files.get(payload.id);
    if (!stored || keccak256(stored.ciphertext as Hex) !== payload.id) throw new CourierError("FILE_HASH", "the relay returned a different file");
    invoiceText = new TextDecoder().decode(openFile(stored, bytesOf(payload.key)));
    vendor.push({ tone: "file", text: `Opened ${payload.name} (${payload.size} bytes). Its hash matches the one in the message.` });
  } catch (error) {
    const refusal = refusalOf(error, "vendor");
    vendor.push({
      tone: "refused",
      text: `Refused ${refusal.code}: ${refusal.reason}. The session did not move, so the untouched message would still open.`,
    });
    return run("refused", { refusal, keys });
  }

  // 6. The vendor replies. It encapsulates to the ML-KEM key the client offered: a ratchet step.
  const replyEnvelope = vendorSession.send(utf8(canonical({ t: "text", body: input.reply })));
  const kemStep = replyEnvelope.kemCiphertext ? { ciphertextBytes: (replyEnvelope.kemCiphertext.length - 2) / 2 } : undefined;
  relay.post({ label: "Vendor reply", from: "vendor", bytes: (replyEnvelope.ciphertext.length - 2) / 2, preview: preview(replyEnvelope.ciphertext) });
  if (replyEnvelope.kemCiphertext) {
    relay.post({ label: "ML-KEM-1024 ciphertext in the reply (ratchet step)", from: "vendor", bytes: kemStep!.ciphertextBytes, preview: preview(replyEnvelope.kemCiphertext) });
  }
  vendor.push({
    tone: "sent",
    text: input.reply,
    detail: kemStep ? `Ratchet step: encapsulated to the client's offered ML-KEM-1024 key (${kemStep.ciphertextBytes}-byte ciphertext).` : undefined,
  });
  try {
    const reply = parsePayload(clientSession.receive(replyEnvelope));
    client.push({ tone: "received", text: reply.t === "text" ? reply.body : "(not text)", detail: kemStep ? "Vendor-to-client direction rekeyed with ML-KEM-1024." : undefined });
  } catch (error) {
    const refusal = refusalOf(error, "client");
    client.push({ tone: "refused", text: `Refused ${refusal.code}: ${refusal.reason}.` });
    return run("refused", { refusal, keys });
  }
  return run("delivered", { invoiceText, kemStep, keys });
}

function parsePayload(plain: Uint8Array): Payload {
  return JSON.parse(new TextDecoder().decode(plain)) as Payload;
}

/** Flips one byte of the ciphertext, the way a relay or a network could. */
function flipByte(envelope: Envelope): Envelope {
  const at = 2 + 2 * 5;
  const byte = Number.parseInt(envelope.ciphertext.slice(at, at + 2), 16) ^ 0x01;
  return { ...envelope, ciphertext: `${envelope.ciphertext.slice(0, at)}${byte.toString(16).padStart(2, "0")}${envelope.ciphertext.slice(at + 2)}` };
}

function refusalOf(error: unknown, by: Refusal["by"]): Refusal {
  if (error instanceof CourierError) return { code: error.code, by, reason: error.message };
  return { code: "ERROR", by, reason: error instanceof Error ? error.message : String(error) };
}

function preview(hex: string): string {
  return hex.slice(0, 2 + 48);
}

export function short(hex: string): string {
  return hex.length > 14 ? `${hex.slice(0, 10)}…${hex.slice(-6)}` : hex;
}
