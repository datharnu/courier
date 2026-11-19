import { signRecipientCard, verifyRecipientCard, type RecipientCard, type SealKeyPair } from "@qorechain/qoreseal";
import { createSiwqMessage, signSiwq, type ClassicalKey } from "@qorechain/qoresign";
import { bytesToHex, hexToBytes, keccak256, type Hex } from "viem";

import { bundleHash, type Bundle, type BundleSecrets } from "./bundle.js";
import { canonical, CourierError, isCourierError, utf8, type CourierCode } from "./bytes.js";
import { toCosmos, toEvm, type ChainReader } from "./chain.js";
import { openFile, sealFile, type FileBlob } from "./file.js";
import { acceptHandshake, startHandshake, type HandshakeMessage } from "./handshake.js";
import { checkInvoice, ciphertextHash, verifyInvoice, type Invoice } from "./invoice.js";
import { type Envelope, type Session } from "./session.js";

export type Identity = {
  cosmos: string;
  evm: string;
  mldsaSecret: Uint8Array;
  classicalKey: ClassicalKey;
  seal: SealKeyPair;
};

export type Prekeys = { bundle: Bundle; secrets: BundleSecrets; used: Set<number> };

export type Payload =
  | { t: "text"; body: string }
  | { t: "file"; id: string; key: string; hash: string; name: string; size: number }
  | ({ t: "invoice" } & Invoice);

/** What was just posted. `ciphertextHash` is the word MemoPay stores. */
export type Posted = { ciphertext: Hex; ciphertextHash: Hex };

type Wire =
  | { type: "handshake"; handshake: HandshakeMessage }
  | { type: "message"; from: string; conversationId: string; envelope: Envelope };

export type Received =
  | {
      ok: true;
      seq: number;
      from: string;
      conversationId: string;
      payload: Payload;
      first: boolean;
      ciphertextHash: Hex;
    }
  | { ok: false; seq: number; from?: string; code: CourierCode | "WIRE"; reason: string };

export class RelayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RelayError";
  }
}

/**
 * One device. Nothing the relay returns is used until the chain agrees with it:
 * a bundle must hash to the directory, a card must verify under the on-chain ML-DSA key and
 * name the registry KEM key, and a first message must verify under the sender's on-chain key.
 */
export class CourierClient {
  readonly identity: Identity;
  private readonly relay: string;
  private readonly chain: ChainReader;
  private readonly http: typeof fetch;
  private readonly kemEvery?: number;
  private readonly sessions = new Map<string, Session>();
  private prekeys?: Prekeys;
  private token?: string;
  private cursor = -1;
  private instance?: string;

  constructor(opts: { relay: string; chain: ChainReader; identity: Identity; fetch?: typeof fetch; kemEvery?: number }) {
    this.relay = opts.relay.replace(/\/$/, "");
    this.chain = opts.chain;
    this.identity = { ...opts.identity, evm: toEvm(opts.identity.evm) };
    this.http = opts.fetch ?? fetch;
    this.kemEvery = opts.kemEvery;
  }

  conversations(): string[] {
    return [...this.sessions.keys()];
  }

  peerOf(conversationId: string): string {
    return this.session(conversationId).peer;
  }

  usePrekeys(prekeys: Prekeys): void {
    this.prekeys = prekeys;
  }

  async publishCard(): Promise<RecipientCard> {
    const card = signRecipientCard({
      chainId: this.chain.chainId,
      address: this.identity.cosmos,
      keys: this.identity.seal,
      classicalKey: this.identity.classicalKey,
      pqKey: { secretKey: this.identity.mldsaSecret },
    });
    await this.call("PUT", `/v1/cards/${this.identity.evm}`, { card });
    return card;
  }

  /** Entries this device already accepted are retired on the relay, so a restarted relay does not hand them out again. */
  async publishBundle(): Promise<void> {
    if (!this.prekeys) throw new CourierError("BUNDLE_SHAPE", "no prekeys loaded");
    const spent = [...this.prekeys.used].sort((a, b) => a - b);
    if (spent.length === 0) {
      await this.call("PUT", `/v1/bundles/${this.identity.evm}`, { bundle: this.prekeys.bundle });
      return;
    }
    const put = () =>
      this.call("PUT", `/v1/bundles/${this.identity.evm}`, { bundle: this.prekeys!.bundle, spent }, {
        authorization: `Bearer ${this.token}`,
      });
    if (!this.token) await this.signIn();
    try {
      await put();
    } catch (error) {
      if (!(error instanceof RelayError) || error.status !== 401) throw error;
      await this.signIn();
      await put();
    }
  }

  /** The peer's X25519 identity key, accepted only from a card the chain's keys verify. */
  async verifiedX25519(peer: string): Promise<string> {
    const evm = toEvm(peer);
    const { card } = await this.call<{ card: RecipientCard }>("GET", `/v1/cards/${evm}`);
    try {
      const recipient = verifyRecipientCard({
        card,
        chainId: this.chain.chainId,
        address: toCosmos(evm),
        pqPublicKey: await this.chain.mldsaKey(evm),
        mlkemPublicKey: hexToBytes((await this.chain.kemKey(evm)) as `0x${string}`),
      });
      if (!recipient.x25519PublicKey) throw new CourierError("SENDER_CARD", "the card has no X25519 key");
      return bytesToHex(recipient.x25519PublicKey);
    } catch (error) {
      throw new CourierError("SENDER_CARD", error instanceof Error ? error.message : "card refused");
    }
  }

  async start(peer: string, payload: Payload): Promise<Posted & { conversationId: string }> {
    if (payload.t === "invoice") checkInvoice(payload);
    const evm = toEvm(peer);
    const peerX25519 = await this.verifiedX25519(evm);
    const { bundle, oneTimeIndex } = await this.call<{ bundle: Bundle; oneTimeIndex: number | null }>(
      "GET",
      `/v1/bundles/${evm}`,
    );
    const onChain = await this.chain.directory(evm);
    if (!onChain.live) throw new CourierError("BUNDLE_EXPIRED", "the directory has no live bundle for this address");
    if (bundleHash(bundle) !== onChain.hash) throw new CourierError("BUNDLE_HASH", "the relay's bundle is not the one on chain");
    const { handshake, session } = startHandshake({
      sender: {
        address: this.identity.evm,
        mldsaSecret: this.identity.mldsaSecret,
        identityX25519Secret: this.identity.seal.x25519SecretKey,
      },
      recipient: { address: evm, identityX25519Public: hexToBytes(peerX25519 as `0x${string}`) },
      bundle,
      chainHash: onChain.hash,
      registryKem: await this.chain.kemKey(evm),
      oneTimeIndex,
      now: await this.chain.now(),
      plaintext: utf8(canonical(payload)),
      kemEvery: this.kemEvery,
    });
    await this.post(evm, { type: "handshake", handshake });
    this.sessions.set(session.conversationId, session);
    return { conversationId: session.conversationId, ...posted(handshake.ciphertext) };
  }

  async send(conversationId: string, payload: Payload): Promise<Posted> {
    if (payload.t === "invoice") checkInvoice(payload);
    const session = this.session(conversationId);
    const envelope = session.send(utf8(canonical(payload)));
    await this.post(session.peer, { type: "message", from: this.identity.evm, conversationId, envelope });
    return posted(envelope.ciphertext);
  }

  async sendText(conversationId: string, body: string): Promise<Posted> {
    return this.send(conversationId, { t: "text", body });
  }

  /** The file is stored once. Each conversation gets only its 32-byte key, inside its own ratchet. */
  async sendFile(conversationIds: string[], name: string, bytes: Uint8Array): Promise<string> {
    const { blob, key } = sealFile(bytes);
    const id = keccak256(blob.ciphertext as `0x${string}`);
    await this.call("PUT", `/v1/files/${id}`, blob);
    try {
      for (const conversationId of conversationIds) {
        await this.send(conversationId, { t: "file", id, key: bytesToHex(key), hash: blob.hash, name, size: bytes.length });
      }
    } finally {
      key.fill(0);
    }
    return id;
  }

  async fetchFile(payload: Extract<Payload, { t: "file" }>): Promise<Uint8Array> {
    const blob = await this.call<FileBlob>("GET", `/v1/files/${payload.id}`);
    if (keccak256(blob.ciphertext as `0x${string}`) !== payload.id) {
      throw new CourierError("FILE_HASH", "the relay returned a different file");
    }
    if (blob.hash !== payload.hash) throw new CourierError("FILE_HASH", "the file hash is not the one the sender signed");
    return openFile(blob, hexToBytes(payload.key as `0x${string}`));
  }

  async signIn(): Promise<void> {
    const { nonce, domain, uri, chainId } = await this.call<{ nonce: string; domain: string; uri: string; chainId: string }>(
      "POST",
      "/v1/auth/nonce",
      { address: this.identity.evm },
    );
    if (chainId !== this.chain.chainId) throw new RelayError(400, "SIWQ", `relay is on ${chainId}`);
    const issuedAt = new Date();
    const message = createSiwqMessage({
      domain,
      address: this.identity.cosmos,
      statement: "Read my Courier inbox.",
      uri,
      version: "1",
      chainId,
      nonce,
      issuedAt: issuedAt.toISOString(),
      expirationTime: new Date(issuedAt.getTime() + 10 * 60 * 1000).toISOString(),
    });
    const signature = signSiwq({
      message,
      classicalKey: this.identity.classicalKey,
      pqKey: { secretKey: this.identity.mldsaSecret },
    });
    const { token } = await this.call<{ token: string }>("POST", "/v1/auth/verify", { message, signature });
    this.token = token;
  }

  /** Every inbox item gets a result. A refused item is reported and skipped, never decrypted another way. */
  async receive(): Promise<Received[]> {
    if (!this.token) await this.signIn();
    type Page = { instance: string; items: { seq: number; message: Wire }[] };
    const read = () =>
      this.call<Page>("GET", `/v1/inbox/${this.identity.evm}?after=${this.cursor}`, undefined, {
        authorization: `Bearer ${this.token}`,
      });
    let page: Page;
    try {
      page = await read();
    } catch (error) {
      // A restarted relay forgets its tokens. Sign in once more; a second refusal is real.
      if (!(error instanceof RelayError) || error.status !== 401) throw error;
      await this.signIn();
      page = await read();
    }
    if (page.instance !== this.instance) {
      const fresh = this.instance !== undefined;
      this.instance = page.instance;
      if (fresh && this.cursor >= 0) {
        this.cursor = -1;
        page = await read();
      }
    }
    const { items } = page;
    const out: Received[] = [];
    for (const item of items) {
      this.cursor = Math.max(this.cursor, item.seq);
      out.push(await this.handle(item.seq, item.message));
    }
    return out;
  }

  private async handle(seq: number, wire: Wire): Promise<Received> {
    try {
      if (wire?.type === "handshake") return await this.accept(seq, wire.handshake);
      if (wire?.type === "message") {
        const session = this.sessions.get(wire.conversationId);
        if (!session) throw new CourierError("COUNTER", "no conversation with this id");
        if (toEvm(wire.from) !== session.peer) throw new CourierError("ADDRESS", "sender is not this conversation's peer");
        const payload = decode(session.receive(wire.envelope));
        if (payload.t === "invoice") await verifyInvoice(this.chain, payload);
        return {
          ok: true,
          seq,
          from: session.peer,
          conversationId: wire.conversationId,
          payload,
          first: false,
          ciphertextHash: ciphertextHash(wire.envelope.ciphertext),
        };
      }
      return { ok: false, seq, code: "WIRE", reason: "unknown item" };
    } catch (error) {
      const from = wire?.type === "handshake" ? wire.handshake?.sender : wire?.type === "message" ? wire.from : undefined;
      if (isCourierError(error)) return { ok: false, seq, from, code: error.code, reason: error.message };
      return { ok: false, seq, from, code: "WIRE", reason: error instanceof Error ? error.message : String(error) };
    }
  }

  private async accept(seq: number, handshake: HandshakeMessage): Promise<Received> {
    if (!this.prekeys) throw new CourierError("BUNDLE_SHAPE", "no prekeys loaded");
    if (toEvm(handshake.recipient) !== this.identity.evm) throw new CourierError("ADDRESS", "handshake is for someone else");
    const sender = toEvm(handshake.sender);
    const onChain = await this.chain.directory(this.identity.evm);
    const { plaintext, session } = acceptHandshake({
      handshake,
      bundle: this.prekeys.bundle,
      secrets: this.prekeys.secrets,
      recipientIdentityX25519Secret: this.identity.seal.x25519SecretKey,
      senderMldsaPublic: await this.chain.mldsaKey(sender),
      senderCardX25519: await this.verifiedX25519(sender),
      chainHash: onChain.hash,
      registryKem: await this.chain.kemKey(this.identity.evm),
      now: await this.chain.now(),
      used: this.prekeys.used,
      kemEvery: this.kemEvery,
    });
    if (this.sessions.has(session.conversationId)) throw new CourierError("ONE_TIME_REUSED", "conversation already open");
    const payload = decode(plaintext);
    // The session stays even when the invoice is refused, so a later message in this conversation still opens.
    this.sessions.set(session.conversationId, session);
    if (payload.t === "invoice") await verifyInvoice(this.chain, payload);
    return {
      ok: true,
      seq,
      from: sender,
      conversationId: session.conversationId,
      payload,
      first: true,
      ciphertextHash: ciphertextHash(handshake.ciphertext),
    };
  }

  private session(conversationId: string): Session {
    const session = this.sessions.get(conversationId);
    if (!session) throw new CourierError("COUNTER", "no conversation with this id");
    return session;
  }

  private async post(to: string, message: Wire): Promise<void> {
    await this.call("POST", `/v1/inbox/${toEvm(to)}`, { message });
  }

  private async call<T = unknown>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const res = await this.http(`${this.relay}${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const parsed = text ? (JSON.parse(text) as { error?: string; message?: string }) : {};
    if (!res.ok) throw new RelayError(res.status, parsed.error ?? "RELAY", parsed.message ?? `relay answered ${res.status}`);
    return parsed as T;
  }
}

function posted(ciphertext: string): Posted {
  return { ciphertext: ciphertext as Hex, ciphertextHash: ciphertextHash(ciphertext) };
}

function decode(bytes: Uint8Array): Payload {
  const value = JSON.parse(new TextDecoder().decode(bytes)) as Payload;
  if (value?.t === "text" && typeof value.body === "string") return value;
  if (value?.t === "file" && typeof value.id === "string" && typeof value.key === "string") return value;
  if (value?.t === "invoice") {
    checkInvoice(value);
    return value;
  }
  throw new CourierError("BUNDLE_SHAPE", "payload is not a text, a file, or an invoice");
}
