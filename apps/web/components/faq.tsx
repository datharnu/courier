"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Plus } from "lucide-react";

const ITEMS = [
  {
    q: "What if one message is dropped?",
    a: "Counters have to match exactly, and Courier keeps no skipped-message keys. That direction stalls. The conversation has to be started again. This is a chosen limit, and the recorded group had no drops.",
  },
  {
    q: "What if someone steals the long-term keys later?",
    a: "Messages already sent stay closed. The one-time secrets were erased when the handshake opened, and the identity ML-KEM key was never the encapsulation target. A copy of the current ratchet is a different theft: it can read what that device can still read, until the other side completes an ML-KEM step.",
  },
  {
    q: "What does a removed member still have?",
    a: "Every message and file they had already opened. They get no later file key. In the recorded run Carol still has milestone-1.json, and she never received milestone-2.json or the line “Carol has left.”",
  },
  {
    q: "What does the relay learn?",
    a: "Who messages whom, when, and the sizes. It holds ciphertext, public bundles, and signed cards. A restart forgets the inbox. This build keeps that state in memory. It is not the stateless relay the design describes.",
  },
  {
    q: "Are the safety numbers Signal’s?",
    a: "No. They are 12 groups of 5 digits from SHA-256 over the two on-chain ML-DSA-87 keys. Signal’s numeric fingerprints use SHA-512. The number on this page was read for spike and the vendor on 20 Nov 2026. A new key changes it.",
  },
  {
    q: "Does a forwarded invoice change who gets paid?",
    a: "No. The vendor’s signature does not name who carried the message, so a forward still verifies. The money stays locked to the signed payee. The label “forwarded by” belongs to the web app that is still to come, not to this protocol.",
  },
  {
    q: "Why do the bundles expire?",
    a: "PrekeyDirectory refuses an expiry more than seven days ahead, and refuses a bundle once that time has passed. The vendor bundle from this deploy expires on 26 Nov 2026. The recorded hashes stay valid. A new conversation needs a new publish.",
  },
  {
    q: "Can this app send a message?",
    a: "No. Open App reads the recorded run from deployments/live-group.json. There is no wallet, no relay connection, and no button that seals anything.",
  },
];

export function Faq() {
  const reduce = useReducedMotion() ?? false;
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="questions" className="scroll-mt-20 py-16 md:py-20" aria-labelledby="faq-heading">
      <div className="grid gap-10 lg:grid-cols-[0.82fr_1.18fr] lg:gap-14">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <div className="inline-flex items-center gap-2 text-[13px] font-medium text-brand">
            <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden="true" />
            <span>Questions</span>
          </div>
          <h2 id="faq-heading" className="mt-2 text-[30px] leading-[1.12] font-medium tracking-[-0.03em] sm:text-[38px]">
            Common questions.
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-muted">
            The limits are part of the design. A dropped message, a restarted relay, and a removed member do not behave like a chat app that papers over them.
          </p>
        </div>
        <dl className="divide-y divide-line border-y border-line">
          {ITEMS.map((item, idx) => {
            const isOpen = open === idx;
            return (
              <div key={item.q} className="py-1">
                <dt>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : idx)}
                    className="flex w-full items-center justify-between gap-4 py-4 text-left text-[16px] font-medium tracking-[-0.01em] hover:text-brand"
                  >
                    <span>{item.q}</span>
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${isOpen ? "rotate-45 border-brand/50 bg-brand-soft text-brand" : "border-line bg-surface text-muted"}`}>
                      <Plus className="h-4 w-4" />
                    </span>
                  </button>
                </dt>
                <AnimatePresence initial={false}>
                  {isOpen ? (
                    <motion.dd
                      initial={reduce ? false : { height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={reduce ? undefined : { height: 0, opacity: 0 }}
                      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                      className="overflow-hidden"
                    >
                      <p className="pb-5 pr-8 text-[14.5px] leading-[1.65] text-muted">{item.a}</p>
                    </motion.dd>
                  ) : null}
                </AnimatePresence>
              </div>
            );
          })}
        </dl>
      </div>
    </section>
  );
}
