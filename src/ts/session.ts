import { mlkem1024 } from "@qorechain/pqc";

import { bytes, CourierError, wipe } from "./bytes.js";
import {
  aadBytes,
  freshNonce,
  KEM_CIPHERTEXT_BYTES,
  KEM_PUBLIC_BYTES,
  mixDirection,
  open,
  peek,
  seal,
} from "./crypto.js";
import { expectKey } from "./bundle.js";

export const KEM_EVERY = 20;

export type Envelope = {
  counter: number;
  nonce: string;
  ciphertext: string;
  kemPublic?: string;
  kemCiphertext?: string;
};

export type SessionInit = {
  self: string;
  peer: string;
  conversationId: string;
  kemEvery: number;
  sendRoot: Uint8Array;
  recvRoot: Uint8Array;
  sendChain: Uint8Array;
  recvChain: Uint8Array;
  sendN: number;
  recvN: number;
};

/**
 * Each direction has its own root and chain, so a step in one direction never breaks
 * messages already in flight the other way.
 * Encapsulating to the peer's offered key rekeys the sender's own direction, at that message.
 * A message that offers a key without carrying a ciphertext is answered with a ciphertext and a
 * counter-offer, so the offerer's direction is rekeyed on its next send.
 */
export class Session {
  readonly self: string;
  readonly peer: string;
  readonly conversationId: string;
  readonly kemEvery: number;

  private sendRoot: Uint8Array;
  private recvRoot: Uint8Array;
  private sendChain: Uint8Array;
  private recvChain: Uint8Array;
  private sendN: number;
  private recvN: number;
  private pendingKem?: Uint8Array;
  private theirKem?: Uint8Array;
  private offerNext = false;

  private constructor(init: SessionInit) {
    if (!Number.isInteger(init.kemEvery) || init.kemEvery < 1) {
      throw new CourierError("KEM_STEP", "the KEM interval is at least 1");
    }
    this.self = init.self;
    this.peer = init.peer;
    this.conversationId = init.conversationId;
    this.kemEvery = init.kemEvery;
    this.sendRoot = init.sendRoot;
    this.recvRoot = init.recvRoot;
    this.sendChain = init.sendChain;
    this.recvChain = init.recvChain;
    this.sendN = init.sendN;
    this.recvN = init.recvN;
  }

  static create(init: SessionInit): Session {
    return new Session(init);
  }

  /** The next message offers a fresh ML-KEM key, unless an offer is already waiting. */
  markCopied(): void {
    this.offerNext = true;
  }

  clone(): Session {
    const copy = new Session({
      self: this.self,
      peer: this.peer,
      conversationId: this.conversationId,
      kemEvery: this.kemEvery,
      sendRoot: this.sendRoot.slice(),
      recvRoot: this.recvRoot.slice(),
      sendChain: this.sendChain.slice(),
      recvChain: this.recvChain.slice(),
      sendN: this.sendN,
      recvN: this.recvN,
    });
    copy.pendingKem = this.pendingKem?.slice();
    copy.theirKem = this.theirKem?.slice();
    copy.offerNext = this.offerNext;
    return copy;
  }

  send(plain: Uint8Array): Envelope {
    const counter = this.sendN;
    let sendRoot = this.sendRoot.slice();
    let sendChain = this.sendChain.slice();
    let pending = this.pendingKem?.slice();
    let their = this.theirKem?.slice();
    let offerNext = this.offerNext;
    let kemCiphertext: Uint8Array | undefined;

    if (their) {
      const encapsulated = mlkem1024.encapsulate(their);
      kemCiphertext = bytes(encapsulated.cipherText);
      const shared = bytes(encapsulated.sharedSecret);
      wipe(encapsulated.sharedSecret);
      const mixed = mixDirection(sendRoot, shared, counter);
      wipe(shared);
      wipe(sendRoot);
      wipe(sendChain);
      wipe(their);
      sendRoot = mixed.root;
      sendChain = mixed.chain;
      their = undefined;
    }

    let kemPublic: Uint8Array | undefined;
    const due = offerNext || (counter + 1) % this.kemEvery === 0;
    if (due && !pending) {
      const pair = mlkem1024.keygen();
      kemPublic = bytes(pair.publicKey);
      pending = bytes(pair.secretKey);
      wipe(pair.secretKey);
      offerNext = false;
    }

    const next = peek(sendChain);
    const nonce = freshNonce();
    const aad = aadBytes(this.self, this.peer, this.conversationId, counter, kemPublic, kemCiphertext);
    const ciphertext = seal(next.key, nonce, aad, plain);
    wipe(next.key);
    wipe(sendChain);
    this.commit({
      sendRoot,
      recvRoot: this.recvRoot,
      sendChain: next.next,
      recvChain: this.recvChain,
      pending,
      their,
      offerNext,
      sendN: counter + 1,
      recvN: this.recvN,
    });
    return {
      counter,
      nonce: hex(nonce),
      ciphertext: hex(ciphertext),
      ...(kemPublic ? { kemPublic: hex(kemPublic) } : {}),
      ...(kemCiphertext ? { kemCiphertext: hex(kemCiphertext) } : {}),
    };
  }

  receive(envelope: Envelope): Uint8Array {
    if (!Number.isSafeInteger(envelope.counter) || envelope.counter !== this.recvN) {
      throw new CourierError("COUNTER", `expected counter ${this.recvN}`);
    }
    const nonce = fromHex(envelope.nonce, 24, "nonce");
    const ciphertext = fromHex(envelope.ciphertext, undefined, "ciphertext");
    if (ciphertext.length < 16) throw new CourierError("AEAD", "ciphertext is too short");
    const kemPublic = envelope.kemPublic ? fromHex(envelope.kemPublic, KEM_PUBLIC_BYTES, "KEM public key") : undefined;
    const kemCiphertext = envelope.kemCiphertext
      ? fromHex(envelope.kemCiphertext, KEM_CIPHERTEXT_BYTES, "KEM ciphertext")
      : undefined;

    let recvRoot = this.recvRoot.slice();
    let recvChain = this.recvChain.slice();
    let pending = this.pendingKem;

    if (kemCiphertext) {
      if (!pending) {
        wipe(recvRoot);
        wipe(recvChain);
        throw new CourierError("KEM_STEP", "no offering secret for this ciphertext");
      }
      const shared = bytes(mlkem1024.decapsulate(pending, kemCiphertext));
      const mixed = mixDirection(recvRoot, shared, envelope.counter);
      wipe(shared);
      wipe(recvRoot);
      wipe(recvChain);
      recvRoot = mixed.root;
      recvChain = mixed.chain;
      pending = undefined;
    }

    const next = peek(recvChain);
    const aad = aadBytes(this.peer, this.self, this.conversationId, envelope.counter, kemPublic, kemCiphertext);
    let plain: Uint8Array;
    try {
      plain = open(next.key, nonce, aad, ciphertext);
    } catch (err) {
      wipe(next.key);
      wipe(next.next);
      wipe(recvRoot);
      wipe(recvChain);
      if (err instanceof CourierError) throw err;
      throw new CourierError("AEAD", "tag failed");
    }
    wipe(next.key);
    wipe(recvChain);

    let their = this.theirKem;
    let offerNext = this.offerNext;
    if (kemPublic) {
      their = kemPublic;
      // An offer without a ciphertext means the offerer's own direction has not been rekeyed yet.
      if (!kemCiphertext && !pending) offerNext = true;
    }
    this.commit({
      sendRoot: this.sendRoot,
      recvRoot,
      sendChain: this.sendChain,
      recvChain: next.next,
      pending,
      their,
      offerNext,
      sendN: this.sendN,
      recvN: this.recvN + 1,
    });
    return plain;
  }

  /** Refusal tests seal under this key with a different AAD. It does not advance the session. */
  recvChainForTest(): Uint8Array {
    return this.recvChain.slice();
  }

  private commit(next: {
    sendRoot: Uint8Array;
    recvRoot: Uint8Array;
    sendChain: Uint8Array;
    recvChain: Uint8Array;
    pending: Uint8Array | undefined;
    their: Uint8Array | undefined;
    offerNext: boolean;
    sendN: number;
    recvN: number;
  }): void {
    if (this.sendRoot !== next.sendRoot) wipe(this.sendRoot);
    if (this.recvRoot !== next.recvRoot) wipe(this.recvRoot);
    if (this.sendChain !== next.sendChain) wipe(this.sendChain);
    if (this.recvChain !== next.recvChain) wipe(this.recvChain);
    if (this.pendingKem && this.pendingKem !== next.pending) wipe(this.pendingKem);
    if (this.theirKem && this.theirKem !== next.their) wipe(this.theirKem);
    this.sendRoot = next.sendRoot;
    this.recvRoot = next.recvRoot;
    this.sendChain = next.sendChain;
    this.recvChain = next.recvChain;
    this.pendingKem = next.pending;
    this.theirKem = next.their;
    this.offerNext = next.offerNext;
    this.sendN = next.sendN;
    this.recvN = next.recvN;
  }
}

function hex(value: Uint8Array): string {
  let out = "0x";
  for (const byte of value) out += byte.toString(16).padStart(2, "0");
  return out;
}

function fromHex(value: string, byteLength: number | undefined, label: string): Uint8Array {
  if (byteLength !== undefined) return hexToChecked(expectKey(value, byteLength, label));
  if (typeof value !== "string" || !/^0x[0-9a-f]*$/.test(value) || value.length % 2 !== 0) {
    throw new CourierError("BUNDLE_SHAPE", `${label} is not lowercase hex`);
  }
  return hexToChecked(value);
}

function hexToChecked(value: string): Uint8Array {
  const out = new Uint8Array((value.length - 2) / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(value.slice(2 + i * 2, 4 + i * 2), 16);
  return out;
}
