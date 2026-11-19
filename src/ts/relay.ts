import { verifyRecipientCard, type RecipientCard } from "@qorechain/qoreseal";
import { parseSiwqMessage, verifySiwq, type SiwqSignature } from "@qorechain/qoresign";
import { randomBytes } from "@noble/ciphers/utils.js";
import { bytesToHex, hexToBytes, keccak256 } from "viem";

import { bundleHash, ONE_TIME_KEYS, type Bundle } from "./bundle.js";
import { isCourierError } from "./bytes.js";
import { toCosmos, toEvm, type ChainReader } from "./chain.js";

export type RelayOptions = {
  chain: ChainReader;
  /** The host clients sign in to, for example `localhost:8787`. */
  domain: string;
  uri: string;
  maxMessageBytes?: number;
  maxFileBytes?: number;
  maxInbox?: number;
  tokenTtlSeconds?: number;
  nowMs?: () => number;
};

type InboxItem = { seq: number; at: number; message: unknown };

/**
 * Holds ciphertext and public keys, and is never trusted for either.
 * It refuses a bundle whose hash is not the directory's, and a card the chain's keys do not
 * verify, so honest clients are not handed junk. Clients check both again: a relay that lies
 * is caught there. Only an inbox's owner, signed in with SIWQ and ML-DSA, can read it.
 * Anyone can post to an inbox; the first message is ML-DSA-signed and later ones fail the AEAD.
 */
export function createRelay(opts: RelayOptions): (request: Request) => Promise<Response> {
  const maxMessage = opts.maxMessageBytes ?? 64 * 1024;
  const maxFile = opts.maxFileBytes ?? 4 * 1024 * 1024;
  const maxInbox = opts.maxInbox ?? 1000;
  const tokenTtl = (opts.tokenTtlSeconds ?? 3600) * 1000;
  const nowMs = opts.nowMs ?? (() => Date.now());

  const bundles = new Map<string, { bundle: Bundle; hash: string; handed: Set<number> }>();
  const cards = new Map<string, RecipientCard>();
  const inboxes = new Map<string, { next: number; items: InboxItem[] }>();
  const files = new Map<string, { nonce: string; ciphertext: string; hash: string }>();
  const nonces = new Map<string, { evm: string; expiresAt: number }>();
  const tokens = new Map<string, { evm: string; expiresAt: number }>();
  /** State is in memory, so sequence numbers restart with the process. A client that sees a new instance starts over. */
  const instance = bytesToHex(randomBytes(8)).slice(2);

  /** The address a live bearer token was issued to, or undefined. */
  function signedIn(request: Request): string | undefined {
    const auth = request.headers.get("authorization") ?? "";
    const session = tokens.get(auth.startsWith("Bearer ") ? auth.slice(7) : "");
    return session && session.expiresAt >= nowMs() ? session.evm : undefined;
  }

  async function route(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] !== "v1") return fail(404, "NOT_FOUND", "unknown path");
    const [, kind, id] = parts;
    const method = request.method;

    if (kind === "health" && method === "GET") return json(200, { ok: true });

    if (kind === "bundles" && id) {
      const evm = toEvm(id);
      if (method === "PUT") {
        const body = await readJson<{ bundle: Bundle; spent?: unknown }>(request, maxMessage * 4);
        let spent: number[] = [];
        if (body.spent !== undefined) {
          if (!Array.isArray(body.spent) || !body.spent.every((i) => Number.isInteger(i) && i >= 0 && i < ONE_TIME_KEYS)) {
            return fail(400, "SPENT", "spent is a list of one-time indexes");
          }
          // Only the owner may retire entries, or a stranger could push every sender to the last-resort key.
          const owner = signedIn(request);
          if (!owner) return fail(401, "AUTH", "sign in to mark entries spent");
          if (owner !== evm) return fail(403, "AUTH", "this is someone else's bundle");
          spent = body.spent as number[];
        }
        const hash = bundleHash(body.bundle);
        const onChain = await opts.chain.directory(evm);
        if (onChain.hash !== hash) return fail(409, "BUNDLE_HASH", "the bundle does not hash to the directory");
        if (!onChain.live) return fail(409, "BUNDLE_EXPIRED", "the directory's bundle has expired");
        const existing = bundles.get(evm);
        const entry = existing?.hash === hash ? existing : { bundle: body.bundle, hash, handed: new Set<number>() };
        for (const index of spent) entry.handed.add(index);
        bundles.set(evm, entry);
        return json(200, { hash });
      }
      if (method === "GET") {
        const entry = bundles.get(evm);
        if (!entry) return fail(404, "NO_BUNDLE", "no bundle for this address");
        let oneTimeIndex: number | null = null;
        for (let i = 0; i < ONE_TIME_KEYS; i++) {
          if (!entry.handed.has(i)) {
            oneTimeIndex = i;
            entry.handed.add(i);
            break;
          }
        }
        return json(200, { bundle: entry.bundle, oneTimeIndex });
      }
    }

    if (kind === "cards" && id) {
      const evm = toEvm(id);
      if (method === "PUT") {
        const body = await readJson<{ card: RecipientCard }>(request, maxMessage);
        try {
          verifyRecipientCard({
            card: body.card,
            chainId: opts.chain.chainId,
            address: toCosmos(evm),
            pqPublicKey: await opts.chain.mldsaKey(evm),
            mlkemPublicKey: hexToBytes((await opts.chain.kemKey(evm)) as `0x${string}`),
          });
        } catch (error) {
          return fail(409, "CARD", error instanceof Error ? error.message : "card refused");
        }
        cards.set(evm, body.card);
        return json(200, { ok: true });
      }
      if (method === "GET") {
        const card = cards.get(evm);
        return card ? json(200, { card }) : fail(404, "NO_CARD", "no card for this address");
      }
    }

    if (kind === "auth" && id === "nonce" && method === "POST") {
      const body = await readJson<{ address: string }>(request, 1024);
      const evm = toEvm(body.address);
      const nonce = bytesToHex(randomBytes(16)).slice(2);
      nonces.set(nonce, { evm, expiresAt: nowMs() + 5 * 60 * 1000 });
      return json(200, { nonce, domain: opts.domain, uri: opts.uri, chainId: opts.chain.chainId });
    }

    if (kind === "auth" && id === "verify" && method === "POST") {
      const body = await readJson<{ message: string; signature: SiwqSignature }>(request, 32 * 1024);
      let fields;
      try {
        fields = parseSiwqMessage(body.message);
      } catch {
        return fail(400, "SIWQ", "not a sign-in message");
      }
      const issued = nonces.get(fields.nonce);
      nonces.delete(fields.nonce);
      const evm = toEvm(fields.address);
      if (!issued || issued.expiresAt < nowMs() || issued.evm !== evm) {
        return fail(401, "SIWQ_NONCE", "the nonce was not issued for this address, or was used");
      }
      try {
        verifySiwq({
          message: body.message,
          signature: body.signature,
          domain: opts.domain,
          nonce: fields.nonce,
          chainId: opts.chain.chainId,
          pqPublicKey: await opts.chain.mldsaKey(evm),
          now: new Date(nowMs()),
        });
      } catch (error) {
        return fail(401, "SIWQ", error instanceof Error ? error.message : "sign-in refused");
      }
      const token = bytesToHex(randomBytes(32)).slice(2);
      const expiresAt = nowMs() + tokenTtl;
      tokens.set(token, { evm, expiresAt });
      return json(200, { token, expiresAt });
    }

    if (kind === "inbox" && id) {
      const evm = toEvm(id);
      if (method === "POST") {
        const body = await readJson<{ message: unknown }>(request, maxMessage);
        const inbox = inboxes.get(evm) ?? { next: 0, items: [] };
        if (inbox.items.length >= maxInbox) return fail(429, "INBOX_FULL", "this inbox is full");
        const seq = inbox.next++;
        inbox.items.push({ seq, at: nowMs(), message: body.message });
        inboxes.set(evm, inbox);
        return json(200, { seq });
      }
      if (method === "GET") {
        const owner = signedIn(request);
        if (!owner) return fail(401, "AUTH", "sign in first");
        if (owner !== evm) return fail(403, "AUTH", "this is someone else's inbox");
        const after = Number(url.searchParams.get("after") ?? "-1");
        const items = (inboxes.get(evm)?.items ?? []).filter((item) => item.seq > after);
        return json(200, { instance, items });
      }
    }

    if (kind === "files" && id) {
      if (!/^0x[0-9a-f]{64}$/.test(id)) return fail(400, "FILE_ID", "a file id is a keccak256");
      if (method === "PUT") {
        const body = await readJson<{ nonce: string; ciphertext: string; hash: string }>(request, maxFile * 2 + 1024);
        if (typeof body.ciphertext !== "string" || !/^0x[0-9a-f]*$/.test(body.ciphertext)) {
          return fail(400, "FILE", "ciphertext is not hex");
        }
        if (keccak256(body.ciphertext as `0x${string}`) !== id) return fail(409, "FILE_ID", "id is not the ciphertext's hash");
        files.set(id, { nonce: body.nonce, ciphertext: body.ciphertext, hash: body.hash });
        return json(200, { id });
      }
      if (method === "GET") {
        const file = files.get(id);
        return file ? json(200, file) : fail(404, "NO_FILE", "no such file");
      }
    }

    return fail(404, "NOT_FOUND", "unknown path");
  }

  return async (request: Request) => {
    try {
      return await route(request);
    } catch (error) {
      if (error instanceof BodyError) return fail(error.status, error.code, error.message);
      if (isCourierError(error)) return fail(400, error.code, error.message);
      return fail(500, "RELAY", "the relay failed");
    }
  };
}

class BodyError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function readJson<T>(request: Request, limit: number): Promise<T> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > limit) throw new BodyError(413, "TOO_LARGE", `body is over ${limit} bytes`);
  const text = await request.text();
  if (text.length > limit) throw new BodyError(413, "TOO_LARGE", `body is over ${limit} bytes`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new BodyError(400, "JSON", "body is not JSON");
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function fail(status: number, error: string, message: string): Response {
  return json(status, { error, message });
}
