import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { FailureScene } from "@/components/failure-scene";
import { Faq } from "@/components/faq";
import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
import { HomeHero } from "@/components/home-hero";
import { HoverGrid } from "@/components/hover-grid";
import { Thread } from "@/components/thread";
import { loadFacts } from "@/lib/load-group";
import { rows, short } from "@/lib/record";

const STEPS = [
  [
    "Bind keys on chain",
    "Every account registers its ML-KEM-1024 identity key and publishes an ML-DSA-87-signed bundle hash to PrekeyDirectory.",
  ],
  [
    "Seal to one-time keys",
    "Handshakes combine X25519 with ML-KEM-1024 to a one-time prekey, then erase that secret the moment it opens.",
  ],
  [
    "Ratchet every message",
    "Each direction runs its own symmetric chain plus periodic ML-KEM steps, so a device copy heals after one round trip.",
  ],
  [
    "Refuse every lie",
    "The relay holds only ciphertext. A swapped bundle, removed member, or forged receipt is caught and rejected before decrypting.",
  ],
] as const;

const RUN_ROWS = [
  ["Spike", "Admin · E1–E2", "Opened", "Created group, recorded DeliveryReceipt #1, removed Carol."],
  ["Vendor", "Member · E1–E2", "Opened", "Signed Receipt #1, received milestone-1.json and milestone-2.json."],
  ["Carol", "Removed · E2", "Refused", "Keeps milestone-1.json; locked out of Epoch 2 and later posts refused."],
  ["Relay", "Untrusted", "Ciphertext", "Held every envelope and blob. Saw zero plaintext or file keys."],
] as const;

function StepCell({ n }: { n: number }) {
  return (
    <span className="relative inline-flex size-11 items-center justify-center rounded-xl bg-brand font-mono text-sm font-semibold text-on-brand">
      {n}
    </span>
  );
}

export default function Home() {
  const facts = loadFacts();

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <HomeHero facts={facts} />

        {/* Live interactive product preview right in the middle, framed like Hive's console window */}
        <section id="preview" className="relative border-t border-line/70 py-20 md:py-24">
          <div className="mx-auto max-w-[1280px] px-6 md:px-10">
            <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="label-mono text-brand">Try switching viewpoints</p>
                <h2 className="mt-2 text-[clamp(1.6rem,3vw,2.35rem)] leading-tight font-semibold tracking-[-0.03em] text-ink">
                  Same recorded group. Four completely different views.
                </h2>
              </div>
              <Link
                href="/app"
                className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line-strong bg-surface px-4 text-[14px] font-medium text-ink hover:border-brand/50"
              >
                <span>Open full workspace (3 runs)</span>
                <ArrowRight className="h-4 w-4 text-brand" />
              </Link>
            </div>
            <div className="shadow-float overflow-hidden rounded-2xl border border-line bg-surface">
              <Thread rows={rows(facts)} pane threadKey="group" facts={facts} />
            </div>
          </div>
        </section>

        {/* Four big editorial steps, Hive style */}
        <section id="how" className="mx-auto max-w-[1280px] border-t border-line/70 px-6 py-24 md:px-10 md:py-28">
          <p className="label-mono mb-10 text-muted">How it works</p>
          <ol className="border-t border-line">
            {STEPS.map(([title, body], i) => (
              <li
                key={title}
                className="grid items-center gap-4 border-b border-line py-9 md:grid-cols-12 md:gap-10"
              >
                <span className="md:col-span-1">
                  <StepCell n={i + 1} />
                </span>
                <p className="text-[clamp(1.75rem,3.4vw,2.75rem)] leading-tight font-semibold tracking-[-0.03em] text-ink md:col-span-6">
                  {title}
                </p>
                <p className="max-w-[44ch] leading-relaxed text-muted md:col-span-5">{body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Where a lie stops — 4 concentric refusal rings */}
        <div className="mx-auto max-w-[1280px] border-t border-line/70 px-6 md:px-10">
          <FailureScene facts={facts} />
        </div>

        {/* Real testnet run table, Hive "A real job" layout */}
        <section className="mx-auto grid max-w-[1280px] gap-12 border-t border-line/70 px-6 py-24 md:grid-cols-12 md:px-10 md:py-28">
          <div className="md:col-span-4">
            <p className="label-mono mb-5 text-muted">A real testnet run</p>
            <p className="text-3xl leading-tight font-medium tracking-[-0.03em] text-ink">
              Three accounts, two epochs. One of them got locked out.
            </p>
            <p className="mt-5 leading-relaxed text-muted">
              Every message, file key, and invoice memo stayed encrypted end-to-end on <span className="text-ink">qorechain-diana</span>.
              Only the receipt commitment and the 10,000 fUSD MemoPay ciphertext hash touched the chain.
            </p>
          </div>
          <div className="md:col-span-7 md:col-start-6">
            <p className="mb-6 text-lg text-ink/90">
              &ldquo;Milestone 1 is ready for review. Remove Carol in Epoch 2, then send milestone-2.json.&rdquo;
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="label-mono text-muted">
                    {["Device", "Role", "State", "What happened"].map((h) => (
                      <th key={h} className="border-b border-line-strong py-2.5 pr-6 font-normal">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {RUN_ROWS.map(([device, role, state, detail]) => (
                    <tr key={device} className="border-b border-line align-top">
                      <td className="py-4 pr-6 font-medium text-ink">{device}</td>
                      <td className="py-4 pr-6 font-mono text-[12px] text-muted whitespace-nowrap">{role}</td>
                      <td className="py-4 pr-6 whitespace-nowrap">
                        <span
                          className={`rounded px-1.5 py-0.5 font-mono text-[11.5px] font-medium ${
                            state === "Opened"
                              ? "bg-brand text-on-brand"
                              : state === "Refused"
                                ? "bg-refused-soft text-refused"
                                : "bg-surface-elevated text-muted"
                          }`}
                        >
                          {state}
                        </span>
                      </td>
                      <td className="py-4 text-[14px] text-muted">{detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-[13px] text-muted">
              <span>
                DeliveryReceipt tx:{" "}
                <code className="font-mono text-ink">{facts ? short(facts.recordHash) : "not on disk"}</code>
                {facts?.memo ? (
                  <>
                    {" · "}MemoPay tx: <code className="font-mono text-ink">{short(facts.memo.payHash)}</code>
                  </>
                ) : null}
              </span>
              <Link href="/app/receipt" className="font-medium text-brand hover:underline">
                View all hashes →
              </Link>
            </div>
          </div>
        </section>

        {/* Common questions accordion */}
        <div className="mx-auto max-w-[1280px] border-t border-line/70 px-6 md:px-10">
          <Faq />
        </div>

        {/* Closing centered CTA with interactive hover hex grid, Hive style */}
        <section className="relative overflow-hidden border-t border-line/70">
          <HoverGrid cellSize={34} />
          <div className="pointer-events-none relative mx-auto max-w-5xl px-6 py-28 text-center md:py-36">
            <h2 className="mx-auto max-w-[24ch] text-[clamp(2rem,4.4vw,3.35rem)] leading-[1.06] font-semibold tracking-[-0.03em] text-ink">
              Only the current device.
              <span className="block font-normal text-muted">Everything else stays sealed.</span>
            </h2>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/app"
                className="pointer-events-auto inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand px-7 text-[15px] font-semibold text-on-brand transition-all hover:brightness-110 active:scale-[0.98]"
              >
                <span>Open App</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/app/receipt"
                className="pointer-events-auto inline-flex min-h-12 items-center rounded-xl border border-line-strong bg-surface/90 px-5 text-[15px] font-medium text-ink backdrop-blur-sm hover:border-brand/50"
              >
                Inspect on-chain ledger
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
