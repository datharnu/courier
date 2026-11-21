"use client";

import Link from "next/link";
import { RefreshCw, ShieldAlert } from "lucide-react";

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="m-4 max-w-xl rounded-2xl border border-refused/40 bg-refused-soft p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-refused/40 bg-canvas text-refused">
          <ShieldAlert className="h-4 w-4" />
        </span>
        <div>
          <h1 className="text-[17px] font-semibold text-ink">This screen did not open.</h1>
          <p className="mt-1.5 text-[14px] leading-relaxed text-muted">
            The recorded runs are still safely on disk and nothing was sent. Retry loading this screen or return to the overview.
          </p>
          <div className="mt-4 flex flex-wrap gap-2.5">
            <button
              type="button"
              onClick={reset}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-brand px-4 text-[13.5px] font-medium text-on-brand hover:brightness-110"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Try again
            </button>
            <Link
              href="/"
              className="inline-flex min-h-10 items-center rounded-lg border border-line-strong bg-surface px-4 text-[13.5px] font-medium text-ink hover:border-brand/50"
            >
              Back to overview
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
