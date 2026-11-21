"use client";

import Link from "next/link";
import { RefreshCw, ShieldAlert, Terminal } from "lucide-react";
import { CopyChip } from "./copy-chip";

export function RunNotice({
  kind,
  heading = "h1",
  preview = false,
}: {
  kind: "missing" | "failed";
  heading?: "h1" | "p";
  preview?: boolean;
}) {
  const missing = kind === "missing";
  const Title = heading;
  return (
    <div role="alert" className="m-4 max-w-2xl rounded-2xl border border-refused/40 bg-refused-soft p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-refused/40 bg-canvas text-refused">
          <ShieldAlert className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <Title className="text-[17px] font-semibold tracking-[-0.015em] text-ink">
            {missing ? "No recorded run on disk" : "The recorded run did not finish"}
          </Title>
          <p className="mt-1.5 text-[14px] leading-relaxed text-muted">
            {missing
              ? "deployments/live-group.json is missing. Courier refuses to invent a fake conversation—run the testnet group script from the repo root, then reload."
              : "deployments/live-group.json is present, but ok is not true. The thread stays closed so a failed run is never displayed as verified."}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2.5 rounded-xl border border-line bg-canvas/80 px-3 py-2.5">
            <Terminal className="h-4 w-4 shrink-0 text-muted" />
            <span className="text-[12px] text-muted">Recover from repo root:</span>
            <CopyChip value="npm run live:group" display="npm run live:group" label="the recovery command" />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-brand px-4 text-[13.5px] font-medium text-on-brand hover:brightness-110"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Reload workspace
            </button>
            {preview ? (
              <Link
                href="/app"
                className="inline-flex min-h-10 items-center rounded-lg border border-line-strong bg-surface px-4 text-[13.5px] font-medium text-ink hover:border-brand/50"
              >
                Return to recorded run
              </Link>
            ) : (
              <Link
                href="/#stops"
                className="inline-flex min-h-10 items-center rounded-lg border border-line-strong bg-surface px-4 text-[13.5px] font-medium text-ink hover:border-brand/50"
              >
                View refusal proofs
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
