import { CourierMark } from "./brand-mark";

export function Footer() {
  return (
    <footer className="mt-auto border-t border-line/80">
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-4 px-6 py-8 text-[13px] text-muted md:px-10">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-line bg-surface text-ink">
            <CourierMark size={15} />
          </span>
          <span className="font-medium text-ink">Courier</span>
          <span className="text-line-strong">·</span>
          <span className="font-mono text-[12px]">qorechain-diana · EVM 9800</span>
        </div>
        <a
          href="https://github.com/datharnu/steward"
          className="hover:text-ink"
        >
          Steward, the other Haven entry
        </a>
      </div>
    </footer>
  );
}
