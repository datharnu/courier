import Link from "next/link";
import { ReceiptRail } from "@/components/receipt-rail";
import { RunNotice } from "@/components/run-notice";
import { Thread } from "@/components/thread";
import { loadExchange, loadGroup, loadMemoPayment } from "@/lib/load-group";
import { directRows, factsOf, memoRows, rows, type ThreadKey } from "@/lib/record";

function previewOf(value: string | string[] | undefined) {
  const state = Array.isArray(value) ? value[0] : value;
  return state === "empty" || state === "error" ? state : null;
}

function threadOf(value: string | string[] | undefined): ThreadKey {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "direct" || raw === "memo" ? raw : "group";
}

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ state?: string | string[]; thread?: string | string[] }>;
}) {
  const params = await searchParams;
  const preview = previewOf(params.state);
  const threadKey = threadOf(params.thread);
  const group = preview === "empty" ? null : loadGroup();
  const failed = preview === "error" || Boolean(group && !group.ok);
  const facts = group && group.ok && preview !== "error" ? factsOf(group, loadExchange(), loadMemoPayment()) : null;

  const activeRows =
    threadKey === "direct" ? directRows(facts) : threadKey === "memo" ? memoRows(facts) : rows(facts);

  return (
    <div className="flex flex-col pb-20 lg:grid lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_320px] lg:pb-0">
      {preview ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface px-4 py-2 text-[12px] text-muted lg:col-span-2">
          <span>
            Previewing the <strong className="text-ink">{preview}</strong> state. The deployment files on disk are unchanged.
          </span>
          <Link href="/app" className="font-medium text-brand hover:underline">
            Exit preview →
          </Link>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col">
        {facts ? (
          <Thread rows={activeRows} pane threadKey={threadKey} facts={facts} />
        ) : (
          <RunNotice kind={failed ? "failed" : "missing"} preview={Boolean(preview)} />
        )}
      </div>
      <div className="hidden lg:block">
        <div className="sticky top-0">
          <ReceiptRail facts={facts} threadKey={threadKey} />
        </div>
      </div>
    </div>
  );
}
