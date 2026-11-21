"use client";

import { useState } from "react";
import { summarize, verifyRecorded, type CheckState, type Verdict } from "@/lib/check";
import { browserRpc } from "@/lib/rpc";
import { CAROL_EXPIRY, RECORDED_CHECKS, VENDOR_EXPIRY, bundleLine, type RecordedCheck } from "@/lib/recorded";

const WORD: Record<CheckState, string> = {
  pass: "Pass",
  fail: "Fail",
  "could-not-check": "Could not check",
};

const TONE: Record<CheckState, string> = {
  pass: "text-ink",
  fail: "text-refused",
  "could-not-check": "text-muted",
};

function standing(check: RecordedCheck): string {
  if (check.id === "vendor-bundle") return bundleLine(VENDOR_EXPIRY);
  if (check.id === "carol-bundle") return bundleLine(CAROL_EXPIRY);
  return "The receipt does not expire.";
}

export function VerifyRecord() {
  const [results, setResults] = useState<Record<string, Verdict>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  async function run(checks: RecordedCheck[]) {
    setBusy(checks.length === 1 ? checks[0].id : "all");
    for (let i = 0; i < checks.length; i++) {
      const check = checks[i];
      setProgress(checks.length === 1 ? `Checking ${check.title}` : `Checking ${i + 1} of ${checks.length}. ${check.title}`);
      setResults((current) => {
        const next = { ...current };
        delete next[check.id];
        return next;
      });
      const verdict = await verifyRecorded(check, browserRpc());
      setResults((current) => ({ ...current, [check.id]: verdict }));
    }
    setProgress(null);
    setBusy(null);
  }

  const failed = RECORDED_CHECKS.some((check) => results[check.id]?.networkError);

  return (
    <section className="mt-8 rounded-xl border border-line bg-surface/90 p-4 sm:p-5">
      <h2 className="text-[16px] font-semibold tracking-[-0.01em]">Verify this step</h2>
      <p className="mt-2 max-w-[62ch] text-[14px] leading-relaxed text-muted">
        Reads the testnet. Sends nothing. The signature is taken from the recorded transaction. The relay is not called.
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button
          type="button"
          onClick={() => void run(RECORDED_CHECKS)}
          disabled={busy !== null}
          aria-busy={busy === "all"}
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-brand px-4 text-[14px] font-medium text-on-brand disabled:opacity-40"
        >
          Verify all
        </button>
        {failed && busy === null ? (
          <button
            type="button"
            onClick={() => void run(RECORDED_CHECKS.filter((check) => results[check.id]?.networkError))}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-canvas px-4 text-[14px] font-medium text-ink"
          >
            Retry
          </button>
        ) : null}
      </div>
      {progress ? (
        <p role="status" className="mt-2 text-[14px] text-ink">
          {progress}
        </p>
      ) : null}
      {failed && busy === null ? (
        <p role="alert" className="mt-2 text-[14px] text-refused">
          Could not reach the testnet
        </p>
      ) : null}
      <ol className="mt-4 space-y-3">
        {RECORDED_CHECKS.map((check, index) => {
          const verdict = results[check.id];
          const checking = busy === check.id || (busy === "all" && progress?.endsWith(check.title) === true);
          return (
            <li key={check.id} className="min-w-0 rounded-lg border border-line bg-canvas/70 p-3">
              <p className="text-[12px] font-medium tracking-[0.08em] text-muted uppercase">
                {index + 1} {check.title}
              </p>
              <p className="mt-1 text-[14px] text-ink" data-testid={`${check.id}-state`}>
                {standing(check)}
              </p>
              <p className="mt-1 font-mono text-[12px] break-all text-muted">{check.hash}</p>
              <button
                type="button"
                onClick={() => void run([check])}
                disabled={busy !== null}
                className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-line bg-surface px-3 text-[14px] font-medium text-ink disabled:opacity-40 sm:w-auto"
              >
                Verify this step
              </button>
              {checking ? (
                <p role="status" className="mt-2 text-[14px] text-muted">
                  Checking this step
                </p>
              ) : null}
              {verdict ? <VerdictLines verdict={verdict} onRetry={() => void run([check])} busy={busy !== null} /> : null}
            </li>
          );
        })}
      </ol>
      <p className="mt-3 max-w-[62ch] text-[13px] text-muted">
        The flipped signature and the second record were eth_calls. They have no transaction to fetch.
      </p>
    </section>
  );
}

function VerdictLines({ verdict, onRetry, busy }: { verdict: Verdict; onRetry: () => void; busy: boolean }) {
  return (
    <div className="mt-3">
      {verdict.networkError ? (
        <p role="alert" className="text-[14px] text-refused">
          Could not reach the testnet{" "}
          <button type="button" onClick={onRetry} disabled={busy} className="underline">
            Retry
          </button>
        </p>
      ) : (
        <p className="text-[14px]">{summarize(verdict)}</p>
      )}
      <ul className="mt-2 space-y-2" aria-live="polite">
        {verdict.lines.map((line) => (
          <li key={line.id} className="grid min-w-0 gap-1 border-t border-line pt-2 sm:grid-cols-[9.5rem_minmax(0,1fr)]">
            <span className="text-[13px] text-muted">{line.label}</span>
            <span className={`min-w-0 text-[14px] break-words ${TONE[line.state]}`}>
              <span className="font-medium">{WORD[line.state]}.</span> {line.reason}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
