"use client";

import { useEffect, useState } from "react";
import { utcStamp } from "@/lib/recorded";
import { browserRpc } from "@/lib/rpc";
import { readDemoChain, type DemoChain } from "@/lib/try/chain";
import { DEMO_WARNING, parseDemoFixture, type DemoFixture } from "@/lib/try/demo-keys";
import { bundleState, runDemo, short, type DemoRun, type PaneLine, type RelayMode } from "@/lib/try/flow";

const INVOICE_NAME = "INV-0007.json";
const INVOICE_TEXT = JSON.stringify({ invoiceId: "INV-0007", amount: "10000", token: "fUSD", payee: "registered payout", due: "2026-12-02" });

const TONE: Record<PaneLine["tone"], string> = {
  sent: "border-brand/40 bg-brand-soft text-ink",
  received: "border-line-strong bg-surface-elevated text-ink",
  check: "border-transparent text-muted",
  refused: "border-refused/40 bg-refused-soft text-refused",
  file: "border-line bg-canvas text-ink",
};

function Pane({ title, who, lines, empty }: { title: string; who: string; lines: PaneLine[]; empty: string }) {
  return (
    <section aria-label={title} className="flex min-h-[260px] flex-col rounded-xl border border-line bg-surface/90 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
        <span className="truncate font-mono text-[11px] text-muted">{who}</span>
      </div>
      <ol className="mt-3 flex flex-col gap-2" data-testid={`${title.toLowerCase()}-pane`}>
        {lines.length === 0 ? <li className="text-[13px] text-muted">{empty}</li> : null}
        {lines.map((line, i) => (
          <li key={i} className={`rounded-lg border px-3 py-2 text-[13.5px] leading-relaxed ${TONE[line.tone]}`}>
            <span className="break-words">{line.text}</span>
            {line.detail ? <span className="mt-1 block text-[12px] text-muted">{line.detail}</span> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

function ChainCard({ chain, fixture }: { chain: DemoChain | null; fixture: DemoFixture | null }) {
  if (!chain || !fixture) {
    return <p className="text-[14px] text-muted">Reading PrekeyDirectory.current(courier-demo-vendor) from qorechain-diana…</p>;
  }
  if (!chain.ok) {
    return (
      <p data-testid="chain-state" className="text-[14px] text-refused">
        Could not reach the testnet: {chain.reason} Nothing below can run without the on-chain hash, and the page will not pretend it has one.
      </p>
    );
  }
  const state = bundleState(chain.view);
  return (
    <div className="grid gap-2 text-[13.5px]">
      <p data-testid="chain-state" className={state.kind === "live" && chain.matchesFixture ? "text-ink" : "text-refused"}>
        {state.kind === "unpublished"
          ? "The demo vendor's bundle has not been published on chain yet (npm run demo:identities -- --broadcast). The client will refuse to seal."
          : state.kind === "expired"
            ? `The demo vendor's bundle expired at ${utcStamp(state.expiry)}. PrekeyDirectory caps a bundle at 7 days; it has not been renewed (npm run renew -- --send). The client will refuse with BUNDLE_EXPIRED.`
            : chain.matchesFixture
              ? `Live. The chain holds the demo vendor's bundle until ${utcStamp(state.expiry)} (${Math.floor(state.hoursLeft)} hours left).`
              : "The chain holds a bundle hash that is not the demo vendor's published keys. The demo keys are public, so anyone can republish; npm run renew -- --send restores it. The client will refuse with BUNDLE_HASH."}
      </p>
      <p className="font-mono text-[12px] break-all text-muted">
        current({short(fixture.vendor.evm)}) = {chain.view.hash}
      </p>
      <p data-testid="client-key" className={chain.clientKey === "registered" ? "text-muted" : "text-refused"}>
        {chain.clientKey === "registered"
          ? "The demo client's ML-DSA-87 key is registered on chain, with proof of possession. The vendor checks the first message against it."
          : chain.clientKey === "different"
            ? "The chain holds a different ML-DSA-87 key for the demo client. The vendor will refuse its first message."
            : "The demo client has no registered ML-DSA-87 key on chain yet. The vendor will refuse its first message."}
      </p>
    </div>
  );
}

export function TryDemo() {
  const [fixture, setFixture] = useState<DemoFixture | null>(null);
  const [chain, setChain] = useState<DemoChain | null>(null);
  const [relay, setRelay] = useState<RelayMode>("honest");
  const [tamper, setTamper] = useState(false);
  const [message, setMessage] = useState("Invoice INV-0007 is attached. Please confirm the payee.");
  const [reply, setReply] = useState("Received INV-0007. Paying it through MemoPay today.");
  const [run, setRun] = useState<DemoRun | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh(loaded: DemoFixture) {
    setChain(null);
    setChain(await readDemoChain(browserRpc(), loaded));
  }

  useEffect(() => {
    let live = true;
    void import("@/fixtures/demo/identities.json").then(async (module) => {
      const loaded = parseDemoFixture(module.default);
      if (!live) return;
      setFixture(loaded);
      const read = await readDemoChain(browserRpc(), loaded);
      if (live) setChain(read);
    });
    return () => {
      live = false;
    };
  }, []);

  function send() {
    if (!fixture || !chain?.ok) return;
    setBusy(true);
    setRun(null);
    // Let the button repaint before ML-KEM and ML-DSA run on this thread.
    window.setTimeout(() => {
      try {
        setRun(runDemo({ fixture, chain: chain.view, relay, tamper, message, reply, invoice: { name: INVOICE_NAME, text: INVOICE_TEXT } }));
      } finally {
        setBusy(false);
      }
    }, 30);
  }

  const ready = Boolean(fixture && chain?.ok && bundleState(chain.view).kind !== "unpublished");

  return (
    <div className="mt-6 flex flex-col gap-5">
      <p data-testid="demo-warning" className="rounded-xl border border-refused/40 bg-refused-soft px-4 py-3 text-[13.5px] text-ink">
        <strong className="font-semibold">{DEMO_WARNING}</strong> The client and vendor keys are in{" "}
        <code className="font-mono text-[12px]">apps/web/fixtures/demo/identities.json</code> so this page can run both sides. A real
        Courier device never ships its secret keys.
      </p>

      <section className="rounded-xl border border-line bg-surface/90 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[16px] font-semibold tracking-[-0.01em]">What the chain says</h2>
          {fixture ? (
            <button type="button" onClick={() => void refresh(fixture)} className="min-h-9 rounded-lg border border-line px-3 text-[13px] text-muted hover:text-ink">
              Read again
            </button>
          ) : null}
        </div>
        <div className="mt-3">
          <ChainCard chain={chain} fixture={fixture} />
        </div>
      </section>

      <section className="rounded-xl border border-line bg-surface/90 p-4 sm:p-5">
        <fieldset>
          <legend className="text-[14px] font-semibold">Relay</legend>
          <div role="radiogroup" aria-label="Relay" className="mt-2 inline-flex rounded-xl border border-line-strong p-1">
            {(["honest", "lying"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={relay === mode}
                onClick={() => setRelay(mode)}
                className={`min-h-10 rounded-lg px-4 text-[14px] font-medium ${
                  relay === mode ? (mode === "lying" ? "bg-refused text-white" : "bg-brand text-on-brand") : "text-muted hover:text-ink"
                }`}
              >
                {mode === "honest" ? "Honest" : "Lying (swap the vendor's prekey bundle)"}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="mt-3 flex items-center gap-2 text-[14px]">
          <input type="checkbox" checked={tamper} onChange={(event) => setTamper(event.target.checked)} className="size-4" />
          Flip one byte of the file-key message in transit
        </label>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="text-[13px] text-muted">
            Client&rsquo;s message
            <input value={message} onChange={(event) => setMessage(event.target.value)} className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-[14px] text-ink" />
          </label>
          <label className="text-[13px] text-muted">
            Vendor&rsquo;s reply
            <input value={reply} onChange={(event) => setReply(event.target.value)} className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-[14px] text-ink" />
          </label>
        </div>
        <p className="mt-3 text-[13px] text-muted">
          Attached file: <code className="font-mono text-[12px]">{INVOICE_NAME}</code> ({new TextEncoder().encode(INVOICE_TEXT).length} bytes)
        </p>
        <button
          type="button"
          onClick={send}
          disabled={!ready || busy}
          className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-brand px-6 text-[15px] font-semibold text-on-brand disabled:opacity-50"
        >
          {busy ? "Sealing…" : "Send message and invoice"}
        </button>
      </section>

      {run?.outcome === "refused" ? (
        <section data-testid="refusal" role="alert" className="rounded-xl border-2 border-refused bg-refused-soft p-4 sm:p-5">
          <p className="font-mono text-[13px] text-refused">
            Refused {run.refusal?.code} by the {run.refusal?.by}
          </p>
          <p className="mt-1 text-[18px] font-semibold text-ink">
            {run.refusal?.code === "BUNDLE_HASH"
              ? "The relay's bundle is not the one on chain. Nothing was sealed."
              : run.refusal?.code === "AEAD"
                ? "A flipped byte failed the AEAD tag. The vendor dropped the message without decrypting it."
                : run.refusal?.reason}
          </p>
          {run.refusal?.code === "BUNDLE_HASH" ? (
            <dl className="mt-3 grid gap-1 font-mono text-[12.5px] break-all">
              <div>
                <dt className="inline text-muted">Relay sent: </dt>
                <dd className="inline text-refused" data-testid="relay-hash">{run.relayHash}</dd>
              </div>
              <div>
                <dt className="inline text-muted">Chain says: </dt>
                <dd className="inline text-ink" data-testid="chain-hash">{run.chainHash}</dd>
              </div>
              <div>
                <dt className="inline text-muted">Bytes sealed by the client: </dt>
                <dd className="inline text-ink" data-testid="sealed-bytes">{run.sealedBytes}</dd>
              </div>
            </dl>
          ) : null}
        </section>
      ) : null}
      {run?.outcome === "delivered" ? (
        <p data-testid="delivered" className="rounded-xl border border-paid/40 bg-paid-soft px-4 py-3 text-[14px] text-ink">
          Delivered. The bundle matched the chain, the vendor opened the message and {INVOICE_NAME}, and the reply came back
          {run.kemStep ? ` with a ${run.kemStep.ciphertextBytes}-byte ML-KEM-1024 ciphertext (a ratchet step)` : ""}.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr_1fr]">
        <Pane title="Client" who={fixture ? short(fixture.client.evm) : ""} lines={run?.client ?? []} empty="Nothing sent yet." />
        <section aria-label="Relay" className="flex flex-col rounded-xl border border-dashed border-line-strong bg-canvas p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-[15px] font-semibold tracking-[-0.01em]">What the relay sees</h2>
            <span className={`font-mono text-[11px] ${relay === "lying" ? "text-refused" : "text-muted"}`}>{relay}</span>
          </div>
          <ol className="mt-3 flex flex-col gap-2" data-testid="relay-pane">
            {(run?.relay ?? []).length === 0 ? <li className="text-[13px] text-muted">Nothing yet.</li> : null}
            {(run?.relay ?? []).map((item, i) => (
              <li key={i} className={`rounded-lg border px-3 py-2 ${item.tampered ? "border-refused/50" : "border-line"}`}>
                <p className="text-[12.5px] text-ink">
                  {item.label} <span className="text-muted">· {item.bytes.toLocaleString("en")} bytes · from {item.from}</span>
                </p>
                <p className="mt-1 font-mono text-[11px] break-all text-muted">{item.preview}…</p>
              </li>
            ))}
          </ol>
        </section>
        <Pane title="Vendor" who={fixture ? short(fixture.vendor.evm) : ""} lines={run?.vendor ?? []} empty="Nothing received yet." />
      </div>

      {run?.invoiceText ? (
        <section className="rounded-xl border border-line bg-surface/90 p-4">
          <h2 className="text-[14px] font-semibold">The vendor opened {INVOICE_NAME}</h2>
          <pre data-testid="invoice" className="mt-2 overflow-x-auto font-mono text-[12px] text-ink">{run.invoiceText}</pre>
        </section>
      ) : null}

      <section className="rounded-xl border border-line bg-surface/90 p-4 text-[13.5px] leading-relaxed text-muted sm:p-5">
        <h2 className="text-[15px] font-semibold text-ink">What is real here, and what is simplified</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5">
          <li>
            Real: the handshake (X25519 x3 + ML-KEM-1024), the ML-DSA-87 signature on the first message, the double ratchet
            (XChaCha20-Poly1305), the file encryption, and every refusal are Courier&rsquo;s <code className="font-mono">src/ts</code> files, copied
            unchanged except for the <code className="font-mono">.js</code> suffix on relative imports (CI checks the copy). The bundle hash is read live from PrekeyDirectory, and the client&rsquo;s key from the chain&rsquo;s PQC
            registry.
          </li>
          <li>
            The relay runs in this page instead of on a server, so it can be told to lie. It never gets a key: it holds the bundle, the
            ciphertext, and the encrypted file.
          </li>
          <li>
            Every run uses the vendor&rsquo;s last-resort ML-KEM prekey, not a one-time prekey. The demo keys are public and each page load starts
            a fresh vendor, so a one-time prekey could not stay one-time. The last-resort prekey is the one the protocol already reuses; each run
            still has a fresh ephemeral X25519 key and a fresh ML-KEM encapsulation. One-time prekeys, erased after use, are covered by the CLI
            tests and the recorded testnet exchange.
          </li>
          <li>
            The vendor&rsquo;s identity ML-KEM key and X25519 card key are taken from the demo file. The chain&rsquo;s REST API does not allow
            reads from a browser, so this page does not re-read the KEM registry; <code className="font-mono">npm run demo:identities</code> checks
            it before publishing.
          </li>
          <li>
            The ML-KEM ratchet step is set to every 2 messages (the default is 20), so the vendor&rsquo;s first reply already carries one.
          </li>
          <li>Nothing here is sent to the chain. No payment, receipt or relay call is made.</li>
        </ul>
      </section>
    </div>
  );
}
