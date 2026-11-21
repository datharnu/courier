"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CourierMark } from "./brand-mark";
import { ThemeToggle } from "./theme-toggle";

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-canvas/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between gap-3 px-6 md:px-10">
        <Link href="/" className="group flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-line-strong bg-surface text-ink transition-colors group-hover:border-brand/50">
            <CourierMark size={19} />
          </span>
          <span className="text-[17px] font-semibold tracking-[-0.025em]">Courier</span>
          <span className="hidden rounded-full border border-line bg-surface px-2 py-0.5 font-mono text-[11px] text-muted sm:inline-flex">
            Haven
          </span>
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href="/app"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-brand px-4 text-[14px] font-medium text-on-brand hover:brightness-110"
          >
            Open App
            <ArrowRight className="h-4 w-4" />
          </Link>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
