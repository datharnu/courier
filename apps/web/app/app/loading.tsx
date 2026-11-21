export default function Loading() {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="flex h-full flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_320px]"
    >
      <div className="flex flex-col gap-4 p-4">
        <div className="space-y-2 border-b border-line pb-4">
          <p className="text-[13px] font-medium text-muted">Loading recorded testnet run…</p>
          <div className="h-5 w-48 animate-pulse rounded-md bg-surface-elevated" />
          <div className="flex gap-2 pt-1">
            <div className="h-9 w-24 animate-pulse rounded-full bg-surface-elevated" />
            <div className="h-9 w-24 animate-pulse rounded-full bg-surface-elevated" />
            <div className="h-9 w-24 animate-pulse rounded-full bg-surface-elevated" />
          </div>
        </div>
        <div className="h-24 max-w-xl animate-pulse rounded-xl bg-surface-elevated" />
        <div className="ml-auto h-20 w-4/5 max-w-md animate-pulse rounded-xl bg-brand-soft" />
        <div className="h-24 max-w-xl animate-pulse rounded-xl bg-surface-elevated" />
      </div>
      <div className="hidden border-l border-line p-4 lg:block">
        <div className="h-44 animate-pulse rounded-xl bg-surface-elevated" />
        <div className="mt-4 h-36 animate-pulse rounded-xl bg-surface-elevated" />
      </div>
    </div>
  );
}
