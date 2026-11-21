"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyChip({ value, display, label }: { value: string; display: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
    window.setTimeout(() => setState("idle"), 1600);
  }

  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={state === "failed" ? `Could not copy ${label}` : `Copy ${label}`}
      title={value}
      className="group inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-md border border-line bg-canvas/80 px-2.5 py-1 font-mono text-[12px] text-muted transition-colors hover:border-line-strong hover:text-ink"
    >
      <span className="truncate">{display}</span>
      {state === "copied" ? (
        <Check className="h-3.5 w-3.5 shrink-0 text-paid" />
      ) : state === "failed" ? (
        <span className="shrink-0 text-refused">Couldn’t copy</span>
      ) : (
        <Copy className="h-3.5 w-3.5 shrink-0 opacity-60 group-hover:opacity-100" />
      )}
      <span className="sr-only" role="status">
        {state === "copied" ? `${label} copied` : state === "failed" ? `${label} was not copied` : ""}
      </span>
    </button>
  );
}
