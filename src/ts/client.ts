import { signRecipientCard, verifyRecipientCard, type RecipientCard, type SealKeyPair } from "@qorechain/qoreseal";
import { createSiwqMessage, signSiwq, type ClassicalKey } from "@qorechain/qoresign";
import { bytesToHex, hexToBytes, keccak256, type Hex } from "viem";

import { bundleHash, type Bundle, type BundleSecrets } from "./bundle.js";
import { canonical, CourierError, isCourierError, utf8, type CourierCode } from "./bytes.js";
import { toCosmos, toEvm, type ChainReader } from "./chain.js";
import { openFile, sealFile, type FileBlob } from "./file.js";
import {
  checkGroupId,
  checkGroupPayload,
  newGroupId,
  normalizeMembers,
  type GroupInfo,
  type GroupPayload,
} from "./group.js";
import { acceptHandshake, startHandshake, type HandshakeMessage } from "./handshake.js";
import { checkInvoice, ciphertextHash, verifyInvoice, type Invoice } from "./invoice.js";
import { checkReceipt, signReceipt, verifyReceipt, type DeliveryReceipt } from "./receipt.js";
import { safetyNumberFor } from "./safety.js";
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
  | ({ t: "invoice" } & Invoice)
  | ({ t: "receipt" } & DeliveryReceipt)
  | GroupPayload;

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
      counter: number;
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
  private readonly groupMap = new Map<string, GroupInfo>();
  private readonly receiptMap = new Map<string, DeliveryReceipt>();
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

  groups(): GroupInfo[] {
    return [...this.groupMap.values()].map((g) => ({ ...g, members: [...g.members] }));
  }

  group(groupId: string): GroupInfo | undefined {
    const found = this.groupMap.get(groupId.toLowerCase());
    return found ? { ...found, members: [...found.members] } : undefined;
  }

  /** Computes the shared 60-digit safety number from both accounts' on-chain ML-DSA-87 keys. */
  async safetyNumber(peer: string): Promise<string> {
    return safetyNumberFor(this.chain, this.identity.evm, peer);
  }

  /** Sign and send an ML-DSA-87 delivery acknowledgement for a received message. */
  async ack(received: Extract<Received, { ok: true }>): Promise<{ receipt: DeliveryReceipt; posted: Posted }> {
    const receipt = signReceipt(this.identity.mldsaSecret, {
      conversationId: received.conversationId as Hex,
      counter: received.counter,
      ciphertextHash: received.ciphertextHash,
      recipient: this.identity.evm,
    });
    const postedMsg = await this.send(received.conversationId, { t: "receipt", ...receipt });
    return { receipt, posted: postedMsg };
  }

  /** Verified delivery receipts kept by this device, optionally filtered by conversation. */
  receipts(conversationId?: string): DeliveryReceipt[] {
    const target = conversationId?.toLowerCase();
    const out: DeliveryReceipt[] = [];
    for (const item of this.receiptMap.values()) {
      if (!target || item.conversationId === target) out.push({ ...item });
    }
    return out;
  }

  /** Look up a kept, verified delivery receipt for a specific message. */
  receiptFor(conversationId: string, counter: number): DeliveryReceipt | undefined {
    const found = this.receiptMap.get(`${conversationId.toLowerCase()}:${counter}`);
    return found ? { ...found } : undefined;
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

  async start(peer: string, payload: Payload, groupId?: string): Promise<Posted & { conversationId: string }> {
    if (payload.t === "invoice") checkInvoice(payload);
    if (payload.t === "receipt") checkReceipt(payload);
    if (isGroupPayload(payload)) checkGroupPayload(payload);
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
      groupId,
    });
    await this.post(evm, { type: "handshake", handshake });
    this.sessions.set(session.conversationId, session);
    return { conversationId: session.conversationId, ...posted(handshake.ciphertext) };
  }

  async send(conversationId: string, payload: Payload, groupId?: string): Promise<Posted> {
    if (payload.t === "invoice") checkInvoice(payload);
    if (payload.t === "receipt") checkReceipt(payload);
    if (isGroupPayload(payload)) checkGroupPayload(payload);
    const session = this.session(conversationId);
    const envelope = session.send(utf8(canonical(payload)), groupId);
    await this.post(session.peer, { type: "message", from: this.identity.evm, conversationId, envelope });
    return posted(envelope.ciphertext);
  }

  async sendText(conversationId: string, body: string): Promise<Posted> {
    return this.send(conversationId, { t: "text", body });
  }

  /** Create a pairwise group and notify all other members over their ratchets. The creator is the group admin. */
  async createGroup(name: string, members: string[]): Promise<GroupInfo> {
    const normalized = normalizeMembers([this.identity.evm, ...members]);
    const id = newGroupId();
    const info: GroupInfo = { id, name, admin: this.identity.evm, epoch: 1, members: normalized };
    const payload: GroupPayload = {
      t: "group.state",
      groupId: id,
      name,
      admin: this.identity.evm,
      epoch: 1,
      members: normalized,
    };
    checkGroupPayload(payload);
    this.groupMap.set(id, info);
    for (const member of normalized) {
      if (member === this.identity.evm) continue;
      await this.sendToPeer(member, payload, id);
    }
    return { ...info, members: [...info.members] };
  }

  /** Send a text message to every current member of the group through their own ratchet, binding `groupId` in AAD. */
  async sendGroupText(groupId: string, body: string): Promise<Record<string, Posted>> {
    const group = this.requireGroup(groupId);
    const payload: GroupPayload = { t: "group.text", groupId: group.id, epoch: group.epoch, body };
    const results: Record<string, Posted> = {};
    for (const member of group.members) {
      if (member === this.identity.evm) continue;
      results[member] = await this.sendToPeer(member, payload, group.id);
    }
    return results;
  }

  /**
   * Seal a file once with a fresh random 32-byte key, upload it once, and wrap the key to each current group member.
   * Removed members never receive keys for future files. Files they already opened remain readable.
   */
  async sendGroupFile(
    groupId: string,
    name: string,
    data: Uint8Array,
  ): Promise<{ fileId: Hex; posted: Record<string, Posted> }> {
    const group = this.requireGroup(groupId);
    const { blob, key } = sealFile(data);
    const fileId = keccak256(blob.ciphertext as `0x${string}`);
    await this.call("PUT", `/v1/files/${fileId}`, blob);
    const results: Record<string, Posted> = {};
    try {
      const payload: GroupPayload = {
        t: "group.file",
        groupId: group.id,
        epoch: group.epoch,
        id: fileId,
        key: bytesToHex(key),
        hash: blob.hash,
        name,
        size: data.length,
      };
      for (const member of group.members) {
        if (member === this.identity.evm) continue;
        results[member] = await this.sendToPeer(member, payload, group.id);
      }
    } finally {
      key.fill(0);
    }
    return { fileId, posted: results };
  }

  /**
   * Remove a member from the group and bump the epoch. Only the group admin may change membership.
   * Future messages and file keys exclude the removed member. Already-read files cannot be clawed back.
   */
  async removeGroupMember(groupId: string, member: string): Promise<GroupInfo> {
    const group = this.requireGroup(groupId);
    if (group.admin !== this.identity.evm) throw new CourierError("GROUP", "only the group admin can remove members");
    const target = toEvm(member);
    if (target === this.identity.evm) throw new CourierError("GROUP", "cannot remove self");
    if (!group.members.includes(target)) throw new CourierError("GROUP", "address is not a member of this group");
    const nextMembers = group.members.filter((m) => m !== target);
    if (nextMembers.length < 2) throw new CourierError("GROUP", "a group needs at least two members");
    const updated: GroupInfo = {
      id: group.id,
      name: group.name,
      admin: group.admin,
      epoch: group.epoch + 1,
      members: nextMembers,
    };
    const payload: GroupPayload = {
      t: "group.state",
      groupId: updated.id,
      name: updated.name,
      admin: updated.admin,
      epoch: updated.epoch,
      members: updated.members,
      removed: target,
    };
    this.groupMap.set(updated.id, updated);
    for (const peer of updated.members) {
      if (peer === this.identity.evm) continue;
      await this.sendToPeer(peer, payload, updated.id);
    }
    return { ...updated, members: [...updated.members] };
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

  async fetchFile(payload: Extract<Payload, { t: "file" | "group.file" }>): Promise<Uint8Array> {
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
        await this.verifyPayload(payload, session.peer, wire.conversationId, wire.envelope.groupId);
        return {
          ok: true,
          seq,
          from: session.peer,
          conversationId: wire.conversationId,
          counter: wire.envelope.counter,
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
    // The session stays even when an application payload is refused, so a later message in this conversation still opens.
    this.sessions.set(session.conversationId, session);
    await this.verifyPayload(payload, sender, session.conversationId, handshake.groupId);
    return {
      ok: true,
      seq,
      from: sender,
      conversationId: session.conversationId,
      counter: 0,
      payload,
      first: true,
      ciphertextHash: ciphertextHash(handshake.ciphertext),
    };
  }

  private async verifyPayload(
    payload: Payload,
    sender: string,
    conversationId: string,
    aadGroupId: string | undefined,
  ): Promise<void> {
    if (payload.t === "invoice") {
      await verifyInvoice(this.chain, payload);
      return;
    }
    if (payload.t === "receipt") {
      await verifyReceipt(this.chain, payload, { expectedRecipient: sender, expectedConversationId: conversationId });
      const kept: DeliveryReceipt = {
        conversationId: payload.conversationId.toLowerCase() as Hex,
        counter: payload.counter,
        ciphertextHash: payload.ciphertextHash.toLowerCase() as Hex,
        recipient: toEvm(payload.recipient),
        signature: payload.signature,
      };
      this.receiptMap.set(`${kept.conversationId}:${kept.counter}`, kept);
      return;
    }
    if (isGroupPayload(payload)) {
      if (aadGroupId !== payload.groupId) {
        throw new CourierError("GROUP", "groupId in payload does not match the AEAD AAD");
      }
      if (payload.t === "group.state") {
        const members = normalizeMembers(payload.members);
        const admin = toEvm(payload.admin);
        const existing = this.groupMap.get(payload.groupId);
        if (!existing) {
          if (sender !== admin) {
            throw new CourierError("GROUP", "only the group admin can create a group");
          }
          if (!members.includes(sender) || !members.includes(this.identity.evm)) {
            throw new CourierError("GROUP", "sender and recipient must belong to the new group");
          }
          this.groupMap.set(payload.groupId, {
            id: payload.groupId,
            name: payload.name,
            admin,
            epoch: payload.epoch,
            members,
          });
          return;
        }
        if (sender !== existing.admin || admin !== existing.admin) {
          throw new CourierError("GROUP", "only the group admin can update membership");
        }
        if (payload.epoch <= existing.epoch) {
          throw new CourierError("GROUP", "stale group epoch");
        }
        if (!members.includes(this.identity.evm)) {
          this.groupMap.delete(payload.groupId);
          return;
        }
        this.groupMap.set(payload.groupId, {
          id: payload.groupId,
          name: payload.name,
          admin: existing.admin,
          epoch: payload.epoch,
          members,
        });
        return;
      }
      const group = this.groupMap.get(payload.groupId);
      if (!group) throw new CourierError("GROUP", "unknown group");
      if (!group.members.includes(sender)) throw new CourierError("GROUP", "sender is not a current group member");
      if (!group.members.includes(this.identity.evm)) throw new CourierError("GROUP", "this device is no longer in the group");
      if (payload.epoch !== group.epoch) {
        throw new CourierError("GROUP", `expected group epoch ${group.epoch}, got ${payload.epoch}`);
      }
    }
  }

  private requireGroup(groupId: string): GroupInfo {
    const id = checkGroupId(groupId);
    const group = this.groupMap.get(id);
    if (!group) throw new CourierError("GROUP", `unknown group ${id}`);
    if (!group.members.includes(this.identity.evm)) throw new CourierError("GROUP", "this device is not in the group");
    return group;
  }

  private async sendToPeer(peer: string, payload: Payload, groupId?: string): Promise<Posted> {
    const evm = toEvm(peer);
    for (const [conversationId, session] of this.sessions) {
      if (session.peer === evm) return this.send(conversationId, payload, groupId);
    }
    const started = await this.start(evm, payload, groupId);
    return { ciphertext: started.ciphertext, ciphertextHash: started.ciphertextHash };
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

function isGroupPayload(payload: Payload): payload is GroupPayload {
  return payload.t === "group.text" || payload.t === "group.file" || payload.t === "group.state";
}

function decode(bytes: Uint8Array): Payload {
  const value = JSON.parse(new TextDecoder().decode(bytes)) as Payload;
  if (value?.t === "text" && typeof value.body === "string") return value;
  if (value?.t === "file" && typeof value.id === "string" && typeof value.key === "string") return value;
  if (value?.t === "invoice") {
    checkInvoice(value);
    return value;
  }
  if (value?.t === "receipt") {
    checkReceipt(value);
    return value;
  }
  if (value && isGroupPayload(value)) {
    checkGroupPayload(value);
    return value;
  }
  throw new CourierError("BUNDLE_SHAPE", "payload is not a recognized Courier message type");
}
