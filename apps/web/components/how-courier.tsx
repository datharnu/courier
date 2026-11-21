"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import { FileKey2, KeyRound, Lock, ShieldCheck } from "lucide-react";

const STEP_MS = 6500;
const EASE = [0.22, 1, 0.36, 1] as const;

const STEPS = [
  {
    n: "01",
    label: "Bundle",
    state: "PrekeyDirectory",
    title: "The owner publishes a bundle the chain can check.",
    body: "Twenty one-time entries, one signed X25519 prekey, and a last-resort ML-KEM key. PrekeyDirectory stores the keccak256 and checks an ML-DSA-87 signature over the chain, the directory, the owner, the hash, and the expiry.",
    who: "The account that owns the inbox",
    onChain: "Hash and expiry. The 4,627-byte signature stays in the transaction.",
    never: "A bundle whose bytes do not hash to current(), or one past seven days",
    answer: "The relay’s copy is kept only if it hashes to the chain.",
    icon: FileKey2,
    trace: [
      ["entries", "20 one-time · numbered 0–19", "ok"],
      ["identity KEM", "matches the registry", "ok"],
      ["expiry", "at most 7 days", "dim"],
    ],
  },
  {
    n: "02",
    label: "Handshake",
    state: "ML-KEM-1024",
    title: "The first message is sealed to a one-time key.",
    body: "Four X25519 agreements, then ML-KEM-1024 to the one-time key, or to the last-resort prekey when none is left. The identity ML-KEM key is never an encapsulation target. The sender signs the transcript with ML-DSA-87.",
    who: "The sender’s device, after it has read the chain",
    onChain: "Nothing new. The client reads the directory, the registry, and pqcKeyStatus first.",
    never: "Sealing to the long-term identity KEM, which a later theft could open",
    answer: "The recipient accepts, then erases that entry’s secrets.",
    icon: KeyRound,
    trace: [
      ["X25519", "four agreements", "ok"],
      ["ML-KEM", "one-time, or last resort", "ok"],
      ["signature", "ML-DSA-87 · QoreSign", "dim"],
    ],
  },
  {
    n: "03",
    label: "Ratchet",
    state: "XChaCha20",
    title: "Every later message deletes the key that opened it.",
    body: "HKDF-SHA-256 derives the next key, then the old one is gone. The AEAD is XChaCha20-Poly1305. Counters must match exactly. A fresh ML-KEM step is offered every 20 sends, and after a device says it may have been copied.",
    who: "Each direction, on its own chain",
    onChain: "Nothing. A file key travels inside the ratchet and is never sealed to a long-term key.",
    never: "Skipping a counter, or opening a message with a key that was already deleted",
    answer: "One dropped message stalls that direction. The conversation has to start again.",
    icon: Lock,
    trace: [
      ["counter", "exact · no skipped keys", "ok"],
      ["file key", "32 random bytes, inside the message", "ok"],
      ["KEM step", "every 20 sends", "dim"],
    ],
  },
  {
    n: "04",
    label: "Receipt",
    state: "DeliveryReceipts",
    title: "The recipient can sign what they opened, and the sender can store it.",
    body: "The receipt is an ML-DSA-87 signature over the conversation, the counter, and the ciphertext hash. DeliveryReceipts checks it with pqcVerify and stores who submitted it. The contract never sees the message.",
    who: "The recipient signs. Anyone holding the signature can record it.",
    onChain: "submitter and recordedAt. A second record of the same receipt reverts.",
    never: "A signature with one byte flipped, or a receipt from a key the chain does not hold",
    answer: "The 20 Nov run recorded one. The tampered call and the duplicate were both refused.",
    icon: ShieldCheck,
    trace: [
      ["domain", "courier.receipt.v1", "dim"],
      ["check", "pqcVerify", "ok"],
      ["plaintext", "not in the transaction", "ok"],
    ],
  },
] as const;

function Pipeline({ step, reduce }: { step: number; reduce: boolean }) {
  const nodes = [
    { x: 52, label: "Bundle" },
    { x: 162, label: "Handshake" },
    { x: 274, label: "Ratchet" },
    { x: 384, label: "Receipt" },
  ];
  const y = 78;
  return (
    <svg viewBox="0 0 436 150" className="block w-full max-w-[440px]" aria-hidden="true">
      {nodes.slice(0, -1).map((node, i) => {
        const next = nodes[i + 1]!;
        const lit = i < step;
        return (
          <g key={node.label}>
            <line x1={node.x + 28} y1={y} x2={next.x - 28} y2={y} stroke="rgba(var(--ink-rgb), 0.16)" strokeWidth="1.5" strokeDasharray="3 4" />
            {lit ? (
              <motion.line
                x1={node.x + 28}
                y1={y}
                x2={next.x - 28}
                y2={y}
                stroke="var(--color-brand)"
                strokeWidth="2"
                initial={reduce ? false : { pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.65, ease: EASE }}
              />
            ) : null}
          </g>
        );
      })}
      {nodes.map((node, i) => {
        const on = i === step;
        const done = i < step;
        return (
          <g key={node.label}>
            <rect
              x={node.x - 26}
              y={y - 26}
              width={52}
              height={52}
              rx={12}
              fill={on ? "rgba(45, 212, 191, 0.16)" : done ? "rgba(52, 211, 153, 0.12)" : "rgba(var(--ink-rgb), 0.04)"}
              stroke={on ? "var(--color-brand)" : done ? "var(--color-paid)" : "rgba(var(--ink-rgb), 0.18)"}
            />
            <text x={node.x} y={y + 4} textAnchor="middle" fill={on ? "var(--color-brand)" : done ? "var(--color-paid)" : "var(--color-muted)"} className="font-mono text-[11px] font-semibold">
              0{i + 1}
            </text>
            <text x={node.x} y={y + 46} textAnchor="middle" fill={on || done ? "var(--color-ink)" : "var(--color-muted)"} className="text-[11px] font-medium">
              {node.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function HowCourier() {
  const reduce = useReducedMotion() ?? false;
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { amount: 0.25 });
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (reduce || !inView || paused) return;
    const id = window.setInterval(() => setActive((prev) => (prev + 1) % STEPS.length), STEP_MS);
    return () => window.clearInterval(id);
  }, [reduce, inView, paused]);

  const current = STEPS[active]!;
  const Icon = current.icon;

  return (
    <section ref={ref} id="how" className="scroll-mt-20 py-16 md:py-20" aria-labelledby="how-heading">
      <div className="max-w-[660px]">
        <div className="inline-flex items-center gap-2 text-[13px] font-medium text-brand">
          <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden="true" />
          <span>How Courier works</span>
        </div>
        <h2 id="how-heading" className="mt-2 text-[30px] leading-[1.12] font-medium tracking-[-0.03em] sm:text-[38px]">
          From a published bundle to a receipt that names no plaintext.
        </h2>
        <p className="mt-3 text-[16px] text-muted">
          Four steps. The chain checks the keys. The device holds the message. The relay holds neither.
        </p>
      </div>

      <div role="tablist" aria-label="How a Courier message moves" className="mt-8 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {STEPS.map((step, idx) => {
          const StepIcon = step.icon;
          const on = idx === active;
          return (
            <button
              key={step.n}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setActive(idx)}
              className={`relative flex min-h-12 items-center gap-2.5 overflow-hidden rounded-xl border px-3.5 py-2.5 text-left ${
                on ? "border-line-strong bg-surface text-ink" : "border-line bg-surface/50 text-muted hover:border-line-strong hover:text-ink"
              }`}
            >
              <StepIcon className={`h-4 w-4 shrink-0 ${on ? "text-brand" : ""}`} />
              <span className="min-w-0 truncate text-[13px] font-medium">
                <span className="mr-1.5 font-mono text-[11px] text-muted">{step.n}</span>
                {step.label}
              </span>
              {on ? <span aria-hidden="true" className="absolute inset-x-3 bottom-0 h-[2px] rounded-full bg-brand" /> : null}
            </button>
          );
        })}
      </div>

      <div className="haven-stage mt-4 p-4 sm:p-7 md:p-9" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
        <div className="mx-auto grid max-w-[960px] gap-6 rounded-[18px] border border-line-strong bg-surface/95 p-5 sm:p-7 lg:grid-cols-2 lg:gap-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={current.n}
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25, ease: EASE }}
              className="flex min-w-0 flex-col gap-3.5"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-brand/35 bg-brand-soft text-brand">
                  <Icon className="h-5 w-5" />
                </span>
                <p className="font-mono text-[12px] text-muted">
                  Step {current.n} of 04 · <span className="text-ink">{current.state}</span>
                </p>
              </div>
              <h3 className="text-[22px] leading-[1.2] font-medium tracking-[-0.025em] sm:text-[25px]">{current.title}</h3>
              <p className="text-[14.5px] leading-[1.6] text-muted">{current.body}</p>
              <div className="mt-1 divide-y divide-line border-t border-line text-[13.5px]">
                <Fact label="Who acts" value={current.who} />
                <Fact label="On QoreChain" value={current.onChain} />
                <Fact label="Cannot happen" value={current.never} muted />
              </div>
            </motion.div>
          </AnimatePresence>
          <div className="flex min-w-0 flex-col justify-between gap-5 rounded-2xl border border-line bg-canvas/75 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2 text-[12px]">
              <span className="font-mono text-muted">Courier path</span>
              <span className="rounded-full border border-brand/35 bg-brand-soft px-2.5 py-0.5 font-mono text-[11px] text-brand">{current.state}</span>
            </div>
            <Pipeline step={active} reduce={reduce} />
            <div className="divide-y divide-line/80 rounded-xl border border-line bg-surface/80 px-3.5 py-1 font-mono text-[11.5px]">
              {current.trace.map(([key, value, tone]) => (
                <div key={key} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-muted">{key}</span>
                  <span className={`truncate ${tone === "ok" ? "text-paid" : "text-ink"}`}>{tone === "ok" ? "✓ " : ""}{value}</span>
                </div>
              ))}
            </div>
            <p className="text-[14.5px] font-medium tracking-[-0.01em]">{current.answer}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Fact({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="grid gap-1 py-2.5 sm:grid-cols-[106px_1fr] sm:gap-3">
      <p className="text-[12px] text-muted">{label}</p>
      <p className={muted ? "text-muted" : "text-ink"}>{value}</p>
    </div>
  );
}
