import Link from "next/link";
import { ArrowRight, CheckCircle2, ShieldCheck } from "lucide-react";
import { CopyChip } from "./copy-chip";
import { SAFETY_NUMBER, short, type RecordFacts, type ThreadKey } from "@/lib/record";

export function ReceiptRail({
  facts,
  threadKey = "group",
}: {
  facts: RecordFacts | null;
  threadKey?: ThreadKey;
}) {
  return (
    <aside className="border-t border-line bg-canvas/40 lg:border-t-0 lg:border-l">
      <div className="flex flex-col gap-5 p-4">
        <div className="rounded-xl border border-line bg-surface p-3.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium tracking-[0.08em] text-muted uppercase">
              {threadKey === "memo" ? "MemoPay settlement" : threadKey === "direct" ? "Prekey directory" : "Delivery receipt"}
            </p>
            {facts ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-paid-soft px-2 py-0.5 text-[11px] font-medium text-paid">
                <CheckCircle2 className="h-3 w-3" />
                Verified
              </span>
            ) : null}
          </div>

          {!facts ? (
            <p className="mt-2 text-[13px] text-muted" role="status">
              No on-chain record to copy until the recorded run is on disk.
            </p>
          ) : threadKey === "memo" && facts.memo ? (
            <>
              <p className="mt-2 text-[15px] font-semibold text-ink">10,000 base units fUSD</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
                Calldata is 132 bytes: token, payee, amount, and <code className="font-mono text-ink">keccak256(ciphertext)</code>. Plaintext memo stays off chain.
              </p>
              <div className="mt-3 space-y-2">
                <div>
                  <span className="mb-1 block text-[11px] text-muted">Pay transaction</span>
                  <CopyChip value={facts.memo.payHash} display={short(facts.memo.payHash)} label="the MemoPay transaction hash" />
                </div>
                <div>
                  <span className="mb-1 block text-[11px] text-muted">Ciphertext hash (on chain)</span>
                  <CopyChip value={facts.memo.ciphertextHash} display={short(facts.memo.ciphertextHash)} label="the ciphertext hash" />
                </div>
              </div>
            </>
          ) : threadKey === "direct" && facts.exchange ? (
            <>
              <p className="mt-2 text-[15px] font-semibold text-ink">Swapped bundle caught</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
                Spike verified <code className="font-mono text-ink">PrekeyDirectory.current</code> before sealing, refused a lying relay, then opened INV-0007.json.
              </p>
              <div className="mt-3 space-y-2">
                <div>
                  <span className="mb-1 block text-[11px] text-muted">Bundle hash on chain</span>
                  <CopyChip value={facts.exchange.bundleHash} display={short(facts.exchange.bundleHash)} label="the on-chain bundle hash" />
                </div>
                <div>
                  <span className="mb-1 block text-[11px] text-muted">INV-0007.json file ID</span>
                  <CopyChip value={facts.exchange.fileId} display={short(facts.exchange.fileId)} label="the invoice file ID" />
                </div>
              </div>
            </>
          ) : (
            <>
              <p className="mt-2 text-[15px] font-semibold text-ink">Recorded by spike</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
                The vendor signed receipt #1 ({facts.gasUsed.toLocaleString()} gas). A flipped signature and a duplicate call both reverted before writing.
              </p>
              <div className="mt-3 space-y-2">
                <div>
                  <span className="mb-1 block text-[11px] text-muted">Receipt transaction</span>
                  <CopyChip value={facts.recordHash} display={short(facts.recordHash)} label="the receipt hash" />
                </div>
                <div>
                  <span className="mb-1 block text-[11px] text-muted">Group ID</span>
                  <CopyChip value={facts.groupId} display={short(facts.groupId)} label="the group id" />
                </div>
              </div>
            </>
          )}
        </div>

        <div className="rounded-xl border border-line bg-surface p-3.5">
          <div className="flex items-center justify-between gap-2">
            <p className="inline-flex items-center gap-1.5 text-[11px] font-medium tracking-[0.08em] text-muted uppercase">
              <ShieldCheck className="h-3.5 w-3.5 text-brand" />
              Safety number
            </p>
            <span className="font-mono text-[10px] text-muted">SHA-256 · 12×5</span>
          </div>
          <div className="mt-2.5 grid grid-cols-3 gap-1.5 rounded-lg border border-line bg-canvas/80 p-2.5 font-mono text-[12px] text-ink">
            {SAFETY_NUMBER.split(" ").map((group, index) => (
              <span key={`${group}-${index}`} className="text-center">
                {group}
              </span>
            ))}
          </div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
            Spike ↔ Vendor ML-DSA-87 keys (20 Nov 2026). Modelled on Signal; uses SHA-256.
          </p>
          <div className="mt-2.5">
            <CopyChip value={SAFETY_NUMBER} display="Copy safety number" label="the safety number" />
          </div>
        </div>

        <Link
          href="/app/receipt"
          className="inline-flex min-h-11 items-center justify-between rounded-xl border border-line bg-surface px-3.5 text-[13.5px] font-medium text-brand hover:border-brand/50"
        >
          <span>Full on-chain ledger</span>
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </aside>
  );
}
