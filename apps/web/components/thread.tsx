"use client";

import Link from "next/link";
import { useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  EyeOff,
  FileText,
  KeyRound,
  Lock,
  Paperclip,
  Radio,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  UserX,
} from "lucide-react";
import { CopyChip } from "./copy-chip";
import { SAFETY_NUMBER, short, type RecordFacts, type Row, type ThreadKey, type Viewpoint } from "@/lib/record";

type LookDef = {
  id: Viewpoint;
  label: string;
  role: string;
  hint: string;
  self: string | null;
  icon: typeof Radio;
  tone: "relay" | "member" | "removed";
};

const ALL_LOOKS: LookDef[] = [
  {
    id: "relay",
    label: "Relay",
    role: "Untrusted",
    hint: "Stores ciphertext only. Reads no plaintext, member list, or file keys.",
    self: null,
    icon: Radio,
    tone: "relay",
  },
  {
    id: "spike",
    label: "Spike",
    role: "Admin",
    hint: "Created the group, recorded the on-chain receipt, then removed Carol in Epoch 2.",
    self: "spike",
    icon: KeyRound,
    tone: "member",
  },
  {
    id: "vendor",
    label: "Vendor",
    role: "Member",
    hint: "Stayed in through Epoch 2. Signed Receipt #1 and received milestone-2.json.",
    self: "steward-vendor",
    icon: UserCheck,
    tone: "member",
  },
  {
    id: "carol",
    label: "Carol",
    role: "Removed",
    hint: "Removed in Epoch 2. Keeps milestone-1.json; receives no later keys and posts are refused.",
    self: "courier-carol",
    icon: UserX,
    tone: "removed",
  },
];

const THREAD_META: Record<ThreadKey, { title: string; subtitle: string; looks: Viewpoint[] }> = {
  group: {
    title: "Haven demo · Group",
    subtitle: "3-member pairwise group with Epoch 2 removal & on-chain delivery receipt",
    looks: ["relay", "spike", "vendor", "carol"],
  },
  direct: {
    title: "Invoice INV-0007 · Direct",
    subtitle: "1-to-1 PQXDH handshake between spike and steward-vendor after swapped-bundle refusal",
    looks: ["relay", "spike", "vendor"],
  },
  memo: {
    title: "MemoPay · 10,000 fUSD",
    subtitle: "Encrypted Steward invoice settled on chain with 132 bytes of hash-only calldata",
    looks: ["relay", "spike", "vendor"],
  },
};

const toneClass = {
  open: "border-line bg-surface-elevated text-ink",
  cipher: "border-line bg-canvas font-mono text-[13px] text-muted",
  refused: "border-refused/45 border-l-4 bg-refused-soft text-ink",
  absent: "border-dashed border-line-strong bg-transparent text-muted",
} as const;

export function Thread({
  rows,
  pane = false,
  threadKey = "group",
  facts = null,
}: {
  rows: Row[];
  pane?: boolean;
  threadKey?: ThreadKey;
  facts?: RecordFacts | null;
}) {
  const meta = THREAD_META[threadKey];
  const looks = ALL_LOOKS.filter((item) => meta.looks.includes(item.id));
  const [who, setWho] = useState<Viewpoint>("vendor");
  const [showMobileProof, setShowMobileProof] = useState(false);

  const activeWho: Viewpoint = meta.looks.includes(who) ? who : "vendor";
  const look = looks.find((item) => item.id === activeWho) ?? looks[1] ?? looks[0]!;
  const visible = rows.filter((row) => row.views[activeWho].tone !== "absent");
  const refusedCount = rows.filter((row) => row.views[activeWho].tone === "refused").length;
  const missed = rows.length - visible.length;

  const summaryBadge =
    activeWho === "relay"
      ? `${rows.length} ciphertexts · 0 plaintext`
      : `${visible.length} visible${missed > 0 ? ` · ${missed} not delivered` : ""}${refusedCount > 0 ? ` · ${refusedCount} refused` : ""}`;

  const switcher = (
    <div role="group" aria-label="Inspect device viewpoint" className="mt-3 flex flex-wrap gap-2">
      {looks.map((item) => {
        const on = item.id === activeWho;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={on}
            onClick={() => setWho(item.id)}
            className={`inline-flex min-h-10 items-center gap-2 rounded-full border px-3.5 text-[13px] font-medium transition-colors ${
              on
                ? item.tone === "removed"
                  ? "border-refused/50 bg-refused-soft text-ink"
                  : item.tone === "relay"
                    ? "border-line-strong bg-canvas text-ink"
                    : "border-brand/50 bg-brand-soft text-ink"
                : "border-line bg-surface text-muted hover:border-line-strong hover:text-ink"
            }`}
          >
            <Icon className={`h-3.5 w-3.5 ${on ? (item.tone === "removed" ? "text-refused" : "text-brand") : ""}`} />
            <span>{item.label}</span>
            <span className="hidden rounded bg-canvas/70 px-1.5 py-0.5 font-mono text-[10px] text-muted sm:inline">
              {item.role}
            </span>
          </button>
        );
      })}
    </div>
  );

  const mobileThreadPicker = pane ? (
    <div className="flex gap-1.5 overflow-x-auto border-b border-line bg-surface/60 px-3 py-2 md:hidden" aria-label="Switch conversation">
      {(
        [
          { key: "group", label: "Group" },
          { key: "direct", label: "INV-0007" },
          { key: "memo", label: "MemoPay" },
        ] as const
      ).map((tab) => {
        const on = tab.key === threadKey;
        return (
          <Link
            key={tab.key}
            href={`/app?thread=${tab.key}`}
            className={`inline-flex min-h-9 shrink-0 items-center rounded-lg border px-3 text-[12.5px] font-medium ${
              on ? "border-brand/50 bg-brand-soft text-ink" : "border-line bg-canvas text-muted"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  ) : null;

  const mobileProofDrawer =
    pane && facts ? (
      <div className="border-b border-line bg-surface/40 lg:hidden">
        <button
          type="button"
          aria-expanded={showMobileProof}
          onClick={() => setShowMobileProof((open) => !open)}
          className="flex min-h-11 w-full items-center justify-between gap-2 px-4 text-left text-[13px]"
        >
          <span className="inline-flex items-center gap-2 font-medium text-ink">
            <ShieldCheck className="h-4 w-4 text-paid" />
            <span>On-chain proof &amp; safety number</span>
          </span>
          <ChevronDown className={`h-4 w-4 text-muted transition-transform ${showMobileProof ? "rotate-180" : ""}`} />
        </button>
        {showMobileProof ? (
          <div className="space-y-3 border-t border-line/70 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[12px] text-muted">
                {threadKey === "memo" && facts.memo ? "MemoPay tx" : "Delivery receipt tx"}
              </span>
              <CopyChip
                value={threadKey === "memo" && facts.memo ? facts.memo.payHash : facts.recordHash}
                display={short(threadKey === "memo" && facts.memo ? facts.memo.payHash : facts.recordHash)}
                label="the transaction hash"
              />
            </div>
            <div>
              <p className="text-[11px] font-medium tracking-[0.08em] text-muted uppercase">Safety number (Spike ↔ Vendor)</p>
              <p className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-[12px] text-ink">
                {SAFETY_NUMBER.split(" ").map((group, idx) => (
                  <span key={`${group}-${idx}`}>{group}</span>
                ))}
              </p>
            </div>
          </div>
        ) : null}
      </div>
    ) : null;

  let lastEpoch: number | undefined;
  const messages = (
    <ol className={`flex flex-col gap-3.5 ${pane ? "px-4 py-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto" : "px-4 py-4 sm:px-5"}`}>
      {rows.map((row) => {
        const view = row.views[activeWho];
        const mine = look.self === row.from && view.tone !== "absent";
        const bubble = mine && view.tone === "open" ? "border-brand/35 bg-brand-soft text-ink" : toneClass[view.tone];
        const showEpochDivider = threadKey === "group" && row.epoch !== undefined && row.epoch !== lastEpoch;
        if (row.epoch !== undefined) lastEpoch = row.epoch;

        const KindIcon =
          view.tone === "refused"
            ? ShieldAlert
            : view.tone === "absent"
              ? EyeOff
              : view.tone === "cipher"
                ? Lock
                : row.kind === "file"
                  ? Paperclip
                  : row.kind === "receipt"
                    ? CheckCircle2
                    : row.kind === "payment"
                      ? FileText
                      : null;

        return (
          <li key={row.id} className="flex min-w-0 flex-col">
            {showEpochDivider ? (
              <div className="my-2 flex items-center gap-3" aria-label={`Epoch ${row.epoch}`}>
                <span className="h-px flex-1 bg-line" />
                <span className="rounded-full border border-line bg-surface px-2.5 py-0.5 font-mono text-[11px] text-muted">
                  {row.epoch === 1 ? "Epoch 1 · 3 members" : "Epoch 2 · Carol removed"}
                </span>
                <span className="h-px flex-1 bg-line" />
              </div>
            ) : null}
            <div className={`flex min-w-0 flex-col ${mine ? "items-end" : "items-start"}`}>
              <p className={`mb-1 flex items-center gap-1.5 text-[12px] text-muted ${mine ? "justify-end text-right" : ""}`}>
                <span>from</span>
                <span className="font-medium text-ink">{row.from}</span>
              </p>
              <div
                className={`rounded-xl border px-3.5 py-3 ${
                  mine ? "w-fit max-w-[88%] rounded-br-md" : "w-full max-w-[680px] rounded-bl-md"
                } ${bubble}`}
              >
                <div className="flex items-center gap-2">
                  {KindIcon ? (
                    <KindIcon
                      className={`h-3.5 w-3.5 shrink-0 ${
                        view.tone === "refused"
                          ? "text-refused"
                          : row.kind === "receipt" && view.tone === "open"
                            ? "text-paid"
                            : view.tone === "open"
                              ? "text-brand"
                              : "text-muted"
                      }`}
                    />
                  ) : null}
                  <p className="text-[13px] font-semibold">{view.title}</p>
                </div>
                <p className="mt-1 text-[14px] leading-relaxed break-words">{view.body}</p>
                {row.meta && view.tone !== "absent" ? (
                  <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-line/60 pt-2">
                    <span className="text-[11px] font-medium text-muted">{row.meta.label}</span>
                    <CopyChip value={row.meta.value} display={short(row.meta.value)} label={row.meta.label} />
                  </div>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );

  if (pane) {
    return (
      <div className="flex flex-col lg:h-full lg:min-h-0">
        {mobileThreadPicker}
        <div className="shrink-0 border-b border-line bg-surface/40 px-4 py-3.5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h1 className="text-[17px] font-semibold tracking-[-0.02em] text-ink">{meta.title}</h1>
              <p className="mt-0.5 text-[13px] text-muted">{look.hint}</p>
            </div>
            <span className="rounded-full border border-line bg-canvas px-2.5 py-1 font-mono text-[11.5px] text-muted">
              {summaryBadge}
            </span>
          </div>
          {switcher}
        </div>
        {mobileProofDrawer}
        {messages}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-line bg-surface/40 px-4 py-2.5 text-[12px] text-muted">
          <span>Read-only inspection of recorded testnet runs. Switch viewpoints above to compare ciphertext vs decrypted state.</span>
          <Link href="/#stops" className="font-medium text-brand hover:underline">
            Where lies stop →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-[220px_minmax(0,1fr)] md:gap-10">
      <div>
        <p className="text-[13px] font-medium text-brand">Look through</p>
        {switcher}
        <p className="mt-3 text-[13px] text-muted">{look.hint}</p>
      </div>
      <div className="min-w-0 rounded-2xl border border-line bg-surface">
        <div className="flex flex-col gap-1 border-b border-line px-4 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:px-5">
          <p className="text-[14px] font-medium">{meta.title}</p>
          <p className="font-mono text-[12px] text-muted">{summaryBadge}</p>
        </div>
        {messages}
      </div>
    </div>
  );
}
