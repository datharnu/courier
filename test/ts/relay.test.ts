import assert from "node:assert/strict";
import { before, test } from "node:test";

import { deriveSealKeys } from "@qorechain/qoreseal";
import { classicalKeyFromPrivate, createSiwqMessage, signSiwq } from "@qorechain/qoresign";
import { deriveUnifiedAccount, generateMnemonic } from "@qorechain/sdk";
import { bytesToHex, hexToBytes, keccak256, toBytes, type Hex } from "viem";

import { bundleHash, createBundle } from "../../src/ts/bundle.js";
import { toEvm, type ChainReader } from "../../src/ts/chain.js";
import { CourierClient, RelayError, type Identity, type Received } from "../../src/ts/client.js";
import { FUSD, STEWARD_GATE, signInvoice } from "../../src/ts/invoice.js";
import { createRelay } from "../../src/ts/relay.js";

const CHAIN_ID = "qorechain-diana";
const BASE = "https://relay.test";
const text = new TextDecoder();

type Fake = { mldsa: Uint8Array; kem: string; directory?: { hash: string; expiry: number; live: boolean } };
const chainState = new Map<string, Fake>();

const chain: ChainReader = {
  chainId: CHAIN_ID,
  async mldsaKey(evm) {
    const entry = chainState.get(toEvm(evm));
    if (!entry) throw new Error("no ML-DSA key is registered");
    return entry.mldsa;
  },
  async kemKey(evm) {
    const entry = chainState.get(toEvm(evm));
    if (!entry) throw new Error("no KEM key");
    return entry.kem;
  },
  async directory(evm) {
    return chainState.get(toEvm(evm))?.directory ?? { hash: `0x${"00".repeat(32)}`, expiry: 0, live: false };
  },
  async now() {
    return Math.floor(Date.now() / 1000);
  },
};

type Fetch = typeof fetch;

function relayFetch(): Fetch {
  const handler = createRelay({ chain, domain: "relay.test", uri: BASE });
  return (async (input: RequestInfo | URL, init?: RequestInit) => handler(new Request(input, init))) as Fetch;
}

/** A relay that rewrites answers on the way to the client. */
function lying(inner: Fetch, rewrite: (path: string, body: any) => any): Fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await inner(input, init);
    const path = new URL(String(input)).pathname;
    if ((init?.method ?? "GET") !== "GET" || !res.ok) return res;
    const body = rewrite(path, await res.json());
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as Fetch;
}

async function identity(): Promise<Identity> {
  const mnemonic = generateMnemonic(256);
  const account = await deriveUnifiedAccount(mnemonic);
  const seal = deriveSealKeys({ mnemonic });
  const evm = toEvm(account.evm);
  chainState.set(evm, { mldsa: account.pqc.publicKey, kem: bytesToHex(seal.mlkemPublicKey) });
  return {
    cosmos: account.cosmos,
    evm,
    mldsaSecret: account.pqc.secretKey,
    classicalKey: classicalKeyFromPrivate(hexToBytes(account.privateKey as Hex), "eth_secp256k1"),
    seal,
  };
}

function client(who: Identity, http: Fetch): CourierClient {
  return new CourierClient({ relay: BASE, chain, identity: who, fetch: http });
}

/** Publishes a bundle "on chain" and to the relay, like `deploy-directory` then `publishBundle`. */
async function withBundle(device: CourierClient): Promise<void> {
  const evm = device.identity.evm;
  const made = createBundle(device.identity.seal.mlkemPublicKey, Math.floor(Date.now() / 1000) + 86400);
  chainState.get(evm)!.directory = { hash: bundleHash(made.bundle), expiry: made.bundle.expiry, live: true };
  device.usePrekeys({ ...made, used: new Set() });
  await device.publishBundle();
}

function texts(items: Received[]): string[] {
  return items.map((item) => (item.ok && item.payload.t === "text" ? item.payload.body : `refused:${item.ok ? "?" : item.code}`));
}

async function refusal(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof RelayError) return `${error.status}:${error.code}`;
    if (error && typeof error === "object" && "code" in error) return String((error as { code: string }).code);
    throw error;
  }
  throw new Error("did not refuse");
}

let alice: Identity;
let bob: Identity;
let carol: Identity;
let mallory: Identity;

before(async () => {
  [alice, bob, carol, mallory] = await Promise.all([identity(), identity(), identity(), identity()]);
});

test("two accounts exchange messages and a file through the relay", async () => {
  const http = relayFetch();
  const a = client(alice, http);
  const b = client(bob, http);
  await a.publishCard();
  await b.publishCard();
  await withBundle(b);

  const conversation = (await a.start(bob.evm, { t: "text", body: "hello bob" })).conversationId;
  const first = await b.receive();
  assert.deepEqual(texts(first), ["hello bob"]);
  assert.equal(first[0].ok && first[0].first, true);
  assert.equal(first[0].ok && first[0].conversationId, conversation);

  await b.sendText(conversation, "hi alice");
  await b.sendText(conversation, "second");
  assert.deepEqual(texts(await a.receive()), ["hi alice", "second"]);

  const contents = new TextEncoder().encode("invoice INV-0042, 1200 fUSD");
  await a.sendFile([conversation], "inv.txt", contents);
  const got = await b.receive();
  assert.equal(got.length, 1);
  assert.ok(got[0].ok && got[0].payload.t === "file");
  if (got[0].ok && got[0].payload.t === "file") {
    assert.equal(text.decode(await b.fetchFile(got[0].payload)), "invoice INV-0042, 1200 fUSD");
  }
  assert.deepEqual(await b.receive(), []);
});

test("the relay refuses a bundle the directory does not hold, and a card the chain does not verify", async () => {
  const http = relayFetch();
  const b = client(bob, http);
  const made = createBundle(bob.seal.mlkemPublicKey, Math.floor(Date.now() / 1000) + 86400);
  chainState.get(bob.evm)!.directory = { hash: `0x${"11".repeat(32)}`, expiry: made.bundle.expiry, live: true };
  b.usePrekeys({ ...made, used: new Set() });
  assert.equal(await refusal(() => b.publishBundle()), "409:BUNDLE_HASH");

  const mallorysCard = await client(mallory, http).publishCard();
  const put = await http(`${BASE}/v1/cards/${bob.evm}`, { method: "PUT", body: JSON.stringify({ card: mallorysCard }) });
  assert.equal(put.status, 409);
  assert.equal((await put.json()).error, "CARD");
});

test("an inbox opens only to its owner, and a sign-in nonce works once", async () => {
  const http = relayFetch();
  const a = client(alice, http);
  const res = await http(`${BASE}/v1/inbox/${bob.evm}`);
  assert.equal(res.status, 401);

  await a.signIn();
  const token = (a as unknown as { token: string }).token;
  const peek = await http(`${BASE}/v1/inbox/${bob.evm}`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(peek.status, 403);

  const signIn = async (address: string) => {
    const issued = await (
      await http(`${BASE}/v1/auth/nonce`, { method: "POST", body: JSON.stringify({ address }) })
    ).json();
    const message = createSiwqMessage({
      domain: "relay.test",
      address: mallory.cosmos,
      uri: BASE,
      version: "1",
      chainId: CHAIN_ID,
      nonce: issued.nonce,
      issuedAt: new Date().toISOString(),
    });
    const signature = signSiwq({ message, classicalKey: mallory.classicalKey, pqKey: { secretKey: mallory.mldsaSecret } });
    return { message, signature };
  };
  const verify = async (body: unknown) =>
    (await http(`${BASE}/v1/auth/verify`, { method: "POST", body: JSON.stringify(body) })).json();

  const forAlice = await signIn(alice.evm);
  assert.equal((await verify(forAlice)).error, "SIWQ_NONCE", "a nonce issued for alice does not sign mallory in");
  const own = await signIn(mallory.evm);
  const asAlice = { ...own, message: own.message.replace(mallory.cosmos, alice.cosmos) };
  assert.equal((await verify(asAlice)).error, "SIWQ_NONCE", "rewriting the address does not move the nonce");
  const fresh = await signIn(mallory.evm);
  assert.ok((await verify(fresh)).token);
  assert.equal((await verify(fresh)).error, "SIWQ_NONCE", "a nonce works once");

  const aliceIssued = await (
    await http(`${BASE}/v1/auth/nonce`, { method: "POST", body: JSON.stringify({ address: alice.evm }) })
  ).json();
  const signedAsMallory = await signIn(mallory.evm);
  const stolen = {
    signature: signedAsMallory.signature,
    message: signedAsMallory.message
      .replace(mallory.cosmos, alice.cosmos)
      .replace(/Nonce: \w+/, `Nonce: ${aliceIssued.nonce}`),
  };
  assert.equal((await verify(stolen)).error, "SIWQ", "mallory's signature does not sign alice in");
});

test("a relay that swaps the bundle or the card is refused before anything is sealed", async () => {
  const honest = relayFetch();
  const b = client(bob, honest);
  const c = client(carol, honest);
  await b.publishCard();
  await c.publishCard();
  await withBundle(b);
  await withBundle(c);
  const carolBundle = await (await honest(`${BASE}/v1/bundles/${carol.evm}`)).json();

  const swapBundle = lying(honest, (path, body) => (path.startsWith("/v1/bundles/") ? carolBundle : body));
  await client(alice, swapBundle).publishCard();
  assert.equal(await refusal(() => client(alice, swapBundle).start(bob.evm, { t: "text", body: "x" })), "BUNDLE_HASH");

  const carolCard = await (await honest(`${BASE}/v1/cards/${carol.evm}`)).json();
  const swapCard = lying(honest, (path, body) => (path === `/v1/cards/${bob.evm}` ? carolCard : body));
  assert.equal(await refusal(() => client(alice, swapCard).start(bob.evm, { t: "text", body: "x" })), "SENDER_CARD");
});

test("one entry handed to two senders opens the first and refuses the second", async () => {
  const honest = relayFetch();
  const b = client(bob, honest);
  await b.publishCard();
  await withBundle(b);
  const sameIndex = lying(honest, (path, body) => (path.startsWith("/v1/bundles/") ? { ...body, oneTimeIndex: 0 } : body));
  const a = client(alice, sameIndex);
  const c = client(carol, sameIndex);
  await a.publishCard();
  await c.publishCard();
  await a.start(bob.evm, { t: "text", body: "from alice" });
  await c.start(bob.evm, { t: "text", body: "from carol" });
  assert.deepEqual(texts(await b.receive()), ["from alice", "refused:ONE_TIME_REUSED"]);
});

test("a forged first message and a tampered later one are refused, and the real ones still open", async () => {
  const http = relayFetch();
  const a = client(alice, http);
  const b = client(bob, http);
  await a.publishCard();
  await b.publishCard();
  await withBundle(b);
  const conversation = (await a.start(bob.evm, { t: "text", body: "real" })).conversationId;

  const inbox = async (who: CourierClient) => {
    await who.signIn();
    const token = (who as unknown as { token: string }).token;
    return (await (await http(`${BASE}/v1/inbox/${who.identity.evm}`, { headers: { authorization: `Bearer ${token}` } })).json())
      .items as { seq: number; message: any }[];
  };
  const [real] = await inbox(b);
  const forgedHandshake = {
    ...real.message.handshake,
    oneTimeIndex: 5,
    signature: `0x${"ab".repeat(4627)}`,
  };
  await http(`${BASE}/v1/inbox/${bob.evm}`, {
    method: "POST",
    body: JSON.stringify({ message: { type: "handshake", handshake: forgedHandshake } }),
  });
  assert.deepEqual(texts(await b.receive()), ["real", "refused:SIGNATURE"]);

  const held: { message: any }[] = [];
  const holdOutgoing = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST" && new URL(String(input)).pathname.startsWith("/v1/inbox/")) {
      held.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ seq: -1 }), { status: 200 });
    }
    return http(input, init);
  }) as Fetch;
  (b as unknown as { http: Fetch }).http = holdOutgoing;
  await b.sendText(conversation, "genuine");
  const genuine = held[0].message;
  const flipped = structuredClone(genuine);
  const hex = flipped.envelope.ciphertext as string;
  flipped.envelope.ciphertext = hex.slice(0, -1) + (hex.endsWith("0") ? "1" : "0");
  await http(`${BASE}/v1/inbox/${alice.evm}`, { method: "POST", body: JSON.stringify({ message: flipped }) });
  await http(`${BASE}/v1/inbox/${alice.evm}`, { method: "POST", body: JSON.stringify({ message: genuine }) });
  await http(`${BASE}/v1/inbox/${alice.evm}`, { method: "POST", body: JSON.stringify({ message: genuine }) });
  assert.deepEqual(texts(await a.receive()), ["refused:AEAD", "genuine", "refused:COUNTER"]);
});

test("a restarted relay does not hand out entries the owner already used, and only the owner can retire them", async () => {
  const first = relayFetch();
  const b = client(bob, first);
  await b.publishCard();
  await withBundle(b);
  const a = client(alice, first);
  await a.publishCard();
  await a.start(bob.evm, { t: "text", body: "before the restart" });
  assert.deepEqual(texts(await b.receive()), ["before the restart"]);

  const restarted = relayFetch();
  (b as unknown as { http: Fetch }).http = restarted;
  const bundle = (b as unknown as { prekeys: { bundle: unknown } }).prekeys.bundle;
  const put = (headers: Record<string, string>) =>
    restarted(`${BASE}/v1/bundles/${bob.evm}`, {
      method: "PUT",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ bundle, spent: [1, 2, 3] }),
    });
  assert.equal((await put({})).status, 401);
  const m = client(mallory, restarted);
  await m.signIn();
  assert.equal((await put({ authorization: `Bearer ${(m as unknown as { token: string }).token}` })).status, 403);

  await b.publishCard();
  await b.publishBundle();
  const again = client(alice, restarted);
  await again.publishCard();
  await again.start(bob.evm, { t: "text", body: "after the restart" });
  assert.deepEqual(texts(await b.receive()), ["after the restart"]);
});

test("an invoice opens, and its ciphertext hash is not the hash of the memo", async () => {
  const http = relayFetch();
  const a = client(alice, http);
  const b = client(bob, http);
  await a.publishCard();
  await b.publishCard();
  await withBundle(b);
  const opened = await a.start(bob.evm, { t: "text", body: "ready" });
  assert.equal((await b.receive())[0].ok, true);

  const memo = "Pay the registered payout.";
  const invoice = signInvoice(bob.mldsaSecret, {
    gate: STEWARD_GATE,
    vendor: bob.evm,
    payee: bob.evm,
    token: FUSD,
    amount: "10000",
    invoiceId: keccak256(toBytes("courier-inv-0007")),
    dueDate: Math.floor(Date.now() / 1000) + 86_400,
    memo,
  });
  const posted = await b.send(opened.conversationId, { t: "invoice", ...invoice });
  const got = await a.receive();
  assert.equal(got[0].ok, true);
  if (!got[0].ok || got[0].payload.t !== "invoice") throw new Error("invoice did not open");
  assert.equal(got[0].payload.memo, memo);
  assert.equal(got[0].ciphertextHash, posted.ciphertextHash);
  assert.notEqual(got[0].ciphertextHash, got[0].payload.memoHash);
  assert.equal(keccak256(posted.ciphertext), posted.ciphertextHash);
});

test("a bad vendor signature is refused and a later message still opens", async () => {
  const http = relayFetch();
  const a = client(alice, http);
  const b = client(bob, http);
  await a.publishCard();
  await b.publishCard();
  await withBundle(b);
  const invoice = signInvoice(mallory.mldsaSecret, {
    gate: STEWARD_GATE,
    vendor: alice.evm,
    payee: bob.evm,
    token: FUSD,
    amount: "10000",
    invoiceId: keccak256(toBytes("forged-inv")),
    dueDate: Math.floor(Date.now() / 1000) + 86_400,
    memo: "Pay someone else.",
  });
  const opened = await a.start(bob.evm, { t: "invoice", ...invoice });
  assert.deepEqual(texts(await b.receive()), ["refused:INVOICE"]);
  await a.sendText(opened.conversationId, "still here");
  assert.deepEqual(texts(await b.receive()), ["still here"]);
});
