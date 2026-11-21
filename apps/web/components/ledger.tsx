"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Check, CheckCircle2, Copy, ShieldAlert } from "lucide-react";
import { SAFETY_NUMBER, short, type RecordFacts } from "@/lib/record";

function Hash({ label, hash }: { label: string; hash: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(hash);
      setState("copied");
    } catch {
      setState("failed");
    }
    window.setTimeout(() => setState("idle"), 1600);
  }
  return (
    <li className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-line bg-canvas/75 px-3 py-1.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="w-16 shrink-0 text-[12px] font-medium text-muted">{label}</span>
        <code className="min-w-0 truncate font-mono text-[12px] text-ink" title={hash}>
          {short(hash)}
        </code>
      </div>
      <button type="button" onClick={copy} aria-label={`Copy the ${label} value`} className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-muted hover:bg-surface hover:text-ink">
        {state === "copied" ? (
          <>
            <Check className="h-3.5 w-3.5 text-paid" />
            <span className="text-paid">Copied</span>
          </>
        ) : state === "failed" ? (
          <span className="text-refused">Couldn’t copy</span>
        ) : (
          <>
            <Copy className="h-3.5 w-3.5 opacity-70" />
            <span>Copy</span>
          </>
        )}
      </button>
    </li>
  );
}

export function Ledger({ facts }: { facts: RecordFacts }) {
  const rows = [
    {
      step: 1,
      title: "Carol’s bundle is the one the directory holds",
      detail: "Published by courier-carol, read back live, with the same hash. A forged signature on that publish was refused first.",
      state: "recorded" as const,
      layer: "PrekeyDirectory",
      hashes: [{ label: "Directory", hash: facts.directory }],
    },
    {
      step: 2,
      title: "DeliveryReceipts is on testnet",
      detail: "Deployed by spike. It stores who submitted a receipt. It does not store the message.",
      state: "recorded" as const,
      layer: "Contract",
      hashes: [{ label: "Contract", hash: facts.deliveryReceipts }],
    },
    {
      step: 3,
      title: "One receipt from the vendor, recorded by spike",
      detail: `Submitter ${short(facts.submitter)}. Gas and the window hashes are in docs/deployments.md.`,
      state: "recorded" as const,
      layer: "record",
      hashes: [{ label: "Record", hash: facts.recordHash }, { label: "Group", hash: facts.groupId }],
    },
    {
      step: 4,
      title: "The two receipt refusals spent nothing",
      detail: "A flipped signature and a second record were eth_calls. Both reverted. Neither is a transaction hash.",
      state: "refused" as const,
      layer: "eth_call",
      hashes: [
        { label: "Flipped", hash: facts.tampered },
        { label: "Twice", hash: facts.duplicate },
      ],
    },
    {
      step: 5,
      title: "The two files",
      detail: "milestone-1.json was opened by Carol before she was removed. milestone-2.json was not sent to her.",
      state: "recorded" as const,
      layer: "Files",
      hashes: facts.fileIds.filter(Boolean).map((hash, index) => ({ label: index === 0 ? "First" : "After", hash })),
    },
  ];

  return (
    <div>
      <p className="mb-6 flex flex-wrap gap-x-2 gap-y-1 font-mono text-[13px] text-ink sm:text-[14px]">
        {SAFETY_NUMBER.split(" ").map((group, index) => (
          <span key={`${group}-${index}`} className="whitespace-nowrap">
            {group}
          </span>
        ))}
      </p>
      <ol className="space-y-3">
        {rows.map((row, index) => {
          const refused = row.state === "refused";
          const Icon = refused ? ShieldAlert : CheckCircle2;
          const badge = refused
            ? "border-refused/35 bg-refused-soft text-refused"
            : "border-paid/35 bg-paid-soft text-paid";
          return (
            <motion.li
              key={row.step}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-30px" }}
              transition={{ duration: 0.35, delay: index * 0.04 }}
              className="grid gap-4 rounded-xl border border-line bg-surface/90 p-4 sm:p-5 md:grid-cols-[2.75rem_1fr_19.5rem] md:items-start"
            >
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line-strong bg-canvas font-mono text-[13px]">
                {String(row.step).padStart(2, "0")}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <p className="text-[16px] font-semibold tracking-[-0.01em]">{row.title}</p>
                  <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-medium ${badge}`}>
                    <Icon className="h-3.5 w-3.5" />
                    {refused ? "Refused" : "Recorded"}
                  </span>
                </div>
                <p className="mt-1.5 max-w-[56ch] text-[14px] leading-relaxed text-muted">{row.detail}</p>
                <div className="mt-2.5 inline-flex items-center gap-1.5 rounded-md border border-line bg-canvas/60 px-2 py-0.5 font-mono text-[11px] text-muted">
                  <span>Layer:</span>
                  <span className="text-ink">{row.layer}</span>
                </div>
              </div>
              <ul className="min-w-0 space-y-2">
                {row.hashes.map((item) => (
                  <Hash key={item.label + item.hash} label={item.label} hash={item.hash} />
                ))}
              </ul>
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}
