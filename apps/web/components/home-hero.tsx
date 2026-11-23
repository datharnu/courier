"use client";

import Link from "next/link";
import { useRef } from "react";
import { ArrowRight } from "lucide-react";
import { HeroLoop } from "./hero-loop";
import { PencilLine } from "./pencil-line";
import { short, type RecordFacts } from "@/lib/record";

export function HomeHero({ facts }: { facts: RecordFacts | null }) {
  const copyRef = useRef<HTMLDivElement>(null);

  return (
    <section className="relative flex min-h-[calc(100svh-4rem)] flex-col items-center overflow-hidden">
      <HeroLoop clearRef={copyRef} />

      <div className="relative mx-auto flex w-full max-w-[1280px] flex-1 flex-col items-center px-6 pt-16 pb-[clamp(16rem,29vw,25rem)] text-center md:px-10 md:pt-24">
        <div ref={copyRef} className="mx-auto flex w-full max-w-[680px] flex-col items-center text-center">
          <p className="settle label-mono mb-6 inline-flex items-center gap-2 rounded-full border border-line bg-surface/90 px-3.5 py-1.5 text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-brand" />
            <span>qorechain-diana · ML-KEM-1024 + ML-DSA-87</span>
          </p>

          <h1 className="settle mx-auto text-[clamp(2.25rem,5.4vw,4.35rem)] leading-[1.06] font-semibold tracking-[-0.035em] text-balance text-ink">
            <span className="block">Encrypted invoices</span>
            <span className="relative inline-block whitespace-nowrap">
              that get paid.
              <PencilLine />
            </span>
          </h1>

          <p
            className="settle mx-auto mt-8 max-w-[46ch] text-[16.5px] leading-relaxed text-muted sm:text-[17px]"
            style={{ animationDelay: "180ms" }}
          >
            Courier delivers encrypted invoices and documents between QoreChain addresses. The payment goes through
            MemoPay and the delivery receipt is recorded on chain; only ciphertext hashes touch the chain. Courier checks
            the recipient&rsquo;s key bundle on chain first, so a relay cannot swap in its own key.
          </p>

          <div
            className="settle mt-8 flex flex-wrap items-center justify-center gap-3"
            style={{ animationDelay: "320ms" }}
          >
            <Link
              href="/app/try"
              className="group inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand px-6 text-[15px] font-semibold text-on-brand transition-all hover:brightness-110 active:scale-[0.98]"
            >
              <span>Try it: catch a lying relay</span>
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="/app"
              className="inline-flex min-h-12 items-center rounded-xl border border-line-strong bg-surface/85 px-5 text-[15px] font-medium text-ink backdrop-blur-sm transition-colors hover:border-brand/50 hover:bg-surface-elevated"
            >
              Open App
            </Link>
            <Link
              href="/app/receipt"
              className="inline-flex min-h-12 items-center rounded-xl border border-line-strong bg-surface/85 px-5 text-[15px] font-medium text-ink backdrop-blur-sm transition-colors hover:border-brand/50 hover:bg-surface-elevated"
            >
              Inspect on-chain proof
            </Link>
          </div>

          {facts ? (
            <p className="settle mt-5 font-mono text-[12px] text-muted" style={{ animationDelay: "420ms" }}>
              Live testnet receipt <span className="text-ink">{short(facts.recordHash)}</span> · 0 bytes plaintext on chain
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
