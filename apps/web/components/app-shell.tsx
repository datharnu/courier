"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { MessageSquare, ReceiptText, ShieldCheck, Users, Waypoints } from "lucide-react";
import { CourierMark } from "./brand-mark";
import { ThemeToggle } from "./theme-toggle";

const SECONDARY_LINKS = [
  { href: "/app/receipt", label: "Receipt", shortLabel: "Receipt", icon: ShieldCheck },
  { href: "/app/how", label: "How it works", shortLabel: "How", icon: Waypoints },
];

const THREADS = [
  {
    key: "group",
    href: "/app?thread=group",
    title: "Haven demo",
    meta: "3 members · Epoch 2",
    icon: Users,
  },
  {
    key: "direct",
    href: "/app?thread=direct",
    title: "Invoice INV-0007",
    meta: "Direct · Swap refused",
    icon: MessageSquare,
  },
  {
    key: "memo",
    href: "/app?thread=memo",
    title: "MemoPay · 10k fUSD",
    meta: "Encrypted invoice",
    icon: ReceiptText,
  },
] as const;

function isRouteActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function SidebarThreads({ recorded }: { recorded: boolean }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const activeThread = pathname === "/app" ? (params.get("thread") ?? "group") : null;

  return (
    <div className="flex flex-col gap-1 px-3 pt-4 pb-2">
      <div className="flex items-center justify-between px-2 pb-1">
        <p className="text-[11px] font-medium tracking-[0.08em] text-muted uppercase">Conversations</p>
        <span className="font-mono text-[10px] text-muted">{recorded ? "3 runs" : "0"}</span>
      </div>
      {THREADS.map((item) => {
        const on = activeThread === item.key;
        const Icon = item.icon;
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={on ? "page" : undefined}
            className={`flex min-h-12 items-center gap-2.5 rounded-xl border px-3 py-2 transition-colors ${
              on
                ? "border-brand/40 bg-surface-elevated text-ink"
                : "border-transparent text-muted hover:bg-surface hover:text-ink"
            }`}
          >
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${
                on ? "border-brand/40 bg-brand-soft text-brand" : "border-line bg-canvas text-muted"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-medium text-ink">{item.title}</span>
              <span className="block truncate text-[11.5px] text-muted">
                {recorded ? item.meta : "Not on disk"}
              </span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}

export function AppShell({
  children,
  recorded,
  when,
}: {
  children: React.ReactNode;
  recorded: boolean;
  when: string | null;
}) {
  const pathname = usePathname();
  const date = when ? when.slice(0, 10) : null;

  return (
    <div className="flex h-dvh flex-col bg-canvas">
      <a
        href="#app-main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to the recorded run
      </a>
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line bg-canvas/90 px-3 backdrop-blur sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <Link href="/" className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.02em]">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-line-strong bg-surface">
              <CourierMark size={18} />
            </span>
            <span>Courier</span>
          </Link>
          <span className="hidden text-line-strong sm:inline">/</span>
          <span
            className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px] sm:inline-flex ${
              recorded
                ? "border-paid/30 bg-paid-soft text-paid"
                : "border-refused/30 bg-refused-soft text-refused"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${recorded ? "bg-paid" : "bg-refused"}`} />
            {recorded ? `qorechain-diana · ${date}` : "No recorded run"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="inline-flex min-h-10 items-center rounded-full border border-line bg-surface px-3 text-[13px] font-medium text-muted hover:border-line-strong hover:text-ink"
          >
            Overview
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav aria-label="App" className="hidden w-64 shrink-0 flex-col justify-between border-r border-line bg-canvas/60 md:flex">
          <div>
            <Suspense fallback={<div className="p-4 text-[12px] text-muted">Loading threads…</div>}>
              <SidebarThreads recorded={recorded} />
            </Suspense>
            <div className="mt-3 flex flex-col gap-1 border-t border-line/70 px-3 pt-4">
              <p className="px-2 pb-1 text-[11px] font-medium tracking-[0.08em] text-muted uppercase">Verify</p>
              {SECONDARY_LINKS.map((item) => {
                const on = isRouteActive(pathname, item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={on ? "page" : undefined}
                    className={`inline-flex min-h-10 items-center gap-2.5 rounded-xl px-3 text-[13.5px] font-medium transition-colors ${
                      on ? "bg-surface-elevated text-ink" : "text-muted hover:bg-surface hover:text-ink"
                    }`}
                  >
                    <Icon className={`h-4 w-4 ${on ? "text-brand" : ""}`} />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
          <div className="border-t border-line/70 p-3 text-[11.5px] leading-relaxed text-muted">
            <p className="font-medium text-ink">Read-only testnet replay</p>
            <p className="mt-0.5">All hashes are loaded from local deployment records on qorechain-diana.</p>
          </div>
        </nav>

        <div id="app-main" className="min-h-0 min-w-0 flex-1 overflow-y-auto pb-20 md:pb-0">
          {children}
        </div>
      </div>

      <nav aria-label="Mobile navigation" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-canvas/95 backdrop-blur md:hidden">
        <div className="grid grid-cols-3">
          <Link
            href="/app"
            aria-current={pathname === "/app" ? "page" : undefined}
            className={`inline-flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
              pathname === "/app" ? "text-brand" : "text-muted"
            }`}
          >
            <MessageSquare className="h-4 w-4" />
            Inbox
          </Link>
          {SECONDARY_LINKS.map((item) => {
            const on = isRouteActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={on ? "page" : undefined}
                className={`inline-flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
                  on ? "text-brand" : "text-muted"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.shortLabel}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
