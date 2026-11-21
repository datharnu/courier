import type { Metadata } from "next";
import { Ledger } from "@/components/ledger";
import { RunNotice } from "@/components/run-notice";
import { VerifyRecord } from "@/components/verify-record";
import { loadFacts, loadGroup } from "@/lib/load-group";

export const metadata: Metadata = { title: "Courier · Receipt" };

export default function ReceiptPage() {
  const facts = loadFacts();
  const group = loadGroup();

  return (
    <div className="mx-auto max-w-[1040px] px-5 pb-24">
      <div className="pt-8">
        <p className="text-[13px] font-medium text-brand">On-chain record</p>
        <h1 className="mt-2 text-[30px] leading-[1.12] font-medium tracking-[-0.03em] sm:text-[38px]">What happened on testnet.</h1>
        <p className="mt-3 max-w-[62ch] text-[15px] text-muted">
          The safety number both devices showed, then the hashes from the recorded run. Copy one and check it. The two refusals are revert data, not transactions.
        </p>
      </div>
      <div className="mt-8">
        {facts ? (
          <>
            <VerifyRecord />
            <div className="mt-8">
              <Ledger facts={facts} />
            </div>
          </>
        ) : (
          <RunNotice heading="p" kind={group && !group.ok ? "failed" : "missing"} />
        )}
      </div>
    </div>
  );
}
