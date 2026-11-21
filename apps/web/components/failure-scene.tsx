"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import { ShieldCheck } from "lucide-react";
import { CopyChip } from "./copy-chip";
import { short, type RecordFacts } from "@/lib/record";

const CYCLE_MS = 5600;
const EASE = [0.22, 1, 0.36, 1] as const;

type Stop = {
  id: string;
  num: string;
  title: string;
  detail: string;
  code: string;
  ring: 0 | 1 | 2 | 3;
  copy: string;
  copyLabel: string;
  note: string;
};

const RINGS = [
  { label: "BUNDLE HASH" },
  { label: "EPOCH" },
  { label: "pqcVerify" },
  { label: "ONCE" },
] as const;

export function FailureScene({ facts }: { facts: RecordFacts | null }) {
  const reduce = useReducedMotion() ?? false;
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { amount: 0.25 });
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  const cases: Stop[] = [
    {
      id: "bundle",
      num: "01",
      title: "The relay swaps the bundle",
      detail: "The first call of the live exchange offered a different valid bundle with the same identity key. The client checked the hash against PrekeyDirectory and sealed nothing.",
      code: "BUNDLE_HASH",
      ring: 0,
      copy: "BUNDLE_HASH",
      copyLabel: "refusal code",
      note: "No transaction. The refusal happened before a handshake.",
    },
    {
      id: "epoch",
      num: "02",
      title: "Carol posts after she is removed",
      detail: "Her device was never told, so she sent “I am still here.” Spike and the vendor refused it. The plaintext stayed sealed.",
      code: "GROUP",
      ring: 1,
      copy: facts?.groupId ?? "",
      copyLabel: "group id",
      note: "No transaction. Membership is checked on the device, against the epoch the admin set.",
    },
    {
      id: "sig",
      num: "03",
      title: "One byte of the receipt signature is flipped",
      detail: "An eth_call of record with that signature reverted. DeliveryReceipts did not store it.",
      code: "SignatureInvalid",
      ring: 2,
      copy: facts?.tampered ?? "",
      copyLabel: "revert data",
      note: "An eth_call, not a transaction. It spent nothing.",
    },
    {
      id: "twice",
      num: "04",
      title: "The same receipt is recorded twice",
      detail: "The first record is on chain. The second eth_call reverted with AlreadyRecorded for this receipt’s own id.",
      code: "AlreadyRecorded",
      ring: 3,
      copy: facts?.duplicate ?? "",
      copyLabel: "revert data",
      note: "The successful record is a transaction. The duplicate is an eth_call.",
    },
  ];

  useEffect(() => {
    if (reduce || paused || !inView) return;
    const id = window.setInterval(() => setActive((prev) => (prev + 1) % cases.length), CYCLE_MS);
    return () => window.clearInterval(id);
  }, [reduce, paused, inView, cases.length]);

  const item = cases[active]!;

  return (
    <section ref={ref} id="stops" className="scroll-mt-20 py-16 md:py-20" aria-labelledby="stops-heading">
      <div className="max-w-[680px]">
        <div className="inline-flex items-center gap-2 text-[13px] font-medium text-brand">
          <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden="true" />
          <span>Where a lie stops</span>
        </div>
        <h2 id="stops-heading" className="mt-2 text-[30px] leading-[1.12] font-medium tracking-[-0.03em] sm:text-[38px]">
          Four ways to offer the wrong thing. None of them opened a message.
        </h2>
        <p className="mt-3 text-[16px] text-muted">
          Two were refused before a transaction existed. Two were refused by DeliveryReceipts without a second write.
        </p>
      </div>

      <div
        className="mt-9 grid items-center gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        <div className="haven-stage p-4 sm:p-6">
          <div className="rounded-2xl border border-line-strong bg-canvas/90 p-4 sm:p-6">
            <Rings ring={item.ring} code={item.code} reduce={reduce} runKey={active} />
          </div>
        </div>
        <ul className="divide-y divide-line border-y border-line">
          {cases.map((stop, idx) => {
            const on = idx === active;
            return (
              <li key={stop.id} className="py-3.5">
                <button type="button" aria-expanded={on} onClick={() => setActive(idx)} className="flex w-full items-start gap-3.5 text-left">
                  <span className={`mt-0.5 font-mono text-[12px] ${on ? "font-semibold text-brand" : "text-muted"}`}>{stop.num}</span>
                  <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                    <span className={`text-[15px] font-medium ${on ? "text-ink" : "text-muted"}`}>{stop.title}</span>
                    <span className="shrink-0 rounded bg-refused-soft px-1.5 py-0.5 font-mono text-[10.5px] text-refused">{stop.code}</span>
                  </span>
                </button>
                <AnimatePresence initial={false}>
                  {on ? (
                    <motion.div
                      initial={reduce ? false : { height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={reduce ? undefined : { height: 0, opacity: 0 }}
                      className="overflow-hidden pl-8"
                    >
                      <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{stop.detail}</p>
                      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[12px] text-muted">{stop.note}</p>
                        {stop.copy ? <CopyChip value={stop.copy} display={short(stop.copy)} label={stop.copyLabel} /> : null}
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </li>
            );
          })}
        </ul>
      </div>
      <p className="mt-4 flex items-start gap-2.5 text-[12.5px] leading-relaxed text-muted">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
        Carol keeps the file she had already opened. A refusal does not reach back and lock that.
      </p>
    </section>
  );
}

function Rings({ ring, code, reduce, runKey }: { ring: number; code: string; reduce: boolean; runKey: number }) {
  const cx = 210;
  const cy = 168;
  const radii = [148, 112, 78, 46];
  return (
    <svg viewBox="0 0 420 340" className="block h-auto w-full" role="img" aria-label={`${code} stops at ring ${ring + 1}. The message stays sealed.`}>
      {radii.map((radius, index) => {
        const hit = index === ring;
        const passed = index < ring;
        return (
          <circle
            key={radius}
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke={hit ? "var(--color-refused)" : passed ? "rgba(var(--brand-rgb), 0.4)" : "rgba(var(--ink-rgb), 0.16)"}
            strokeWidth={hit ? 2.2 : 1.15}
            strokeDasharray={hit ? undefined : "4 5"}
          />
        );
      })}
      {RINGS.map((item, index) => (
        <text key={item.label} x={cx} y={cy - radii[index]! - 8} textAnchor="middle" fill={index === ring ? "var(--color-refused)" : "var(--color-muted)"} className="font-mono text-[9px]">
          {item.label}
        </text>
      ))}
      <circle cx={cx} cy={cy} r={28} fill="var(--color-surface)" stroke="var(--color-brand)" />
      <text x={cx} y={cy - 2} textAnchor="middle" fill="var(--color-brand)" className="font-mono text-[9px] font-semibold">
        TEXT
      </text>
      <text x={cx} y={cy + 12} textAnchor="middle" fill="var(--color-muted)" className="font-mono text-[8px]">
        SEALED
      </text>
      <motion.line
        key={runKey}
        x1={18}
        y1={cy}
        x2={cx - radii[ring]!}
        y2={cy}
        stroke="var(--color-refused)"
        strokeWidth="2.4"
        initial={reduce ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.55, ease: EASE }}
      />
      <text x={cx} y={328} textAnchor="middle" fill="var(--color-muted)" className="font-mono text-[10px]">
        STOPPED AT RING {ring + 1} · {code}
      </text>
    </svg>
  );
}
