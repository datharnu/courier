"use client";

import { useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion } from "framer-motion";
import { ExternalLink } from "lucide-react";
import styles from "./research-band.module.css";

const DOCS = [
  {
    id: "fips-204",
    host: "csrc.nist.gov/pubs/fips/204/final",
    product: "the bundle and the receipt",
    finding: "The owner’s ML-DSA-87 key is what makes a bundle, a card, and a receipt believable.",
    who: "NIST",
    venue: "FIPS 204 · ML-DSA, Aug 2024",
    href: "https://csrc.nist.gov/pubs/fips/204/final",
    pubLabel: "Federal Information Processing Standard · FIPS 204",
    docTitle: "Module-Lattice-Based Digital Signature Standard",
    docAbstract:
      "Courier checks ML-DSA-87 through the chain’s pqcVerify. A bundle signature, a recipient card, a first message, and a delivery receipt all fail closed when that check fails.",
    tags: ["ML-DSA-87", "pqcVerify", "Receipts"],
  },
  {
    id: "fips-203",
    host: "csrc.nist.gov/pubs/fips/203/final",
    product: "the handshake",
    finding: "ML-KEM-1024 is the encapsulation. The identity key is published, and then left out of it.",
    who: "NIST",
    venue: "FIPS 203 · ML-KEM, Aug 2024",
    href: "https://csrc.nist.gov/pubs/fips/203/final",
    pubLabel: "Federal Information Processing Standard · FIPS 203",
    docTitle: "Module-Lattice-Based Key-Encapsulation Mechanism",
    docAbstract:
      "The first message encapsulates to a one-time ML-KEM-1024 key, or to the last-resort prekey. The identity key binds the bundle to the registry. Sealing to it would let a later theft open the past.",
    tags: ["ML-KEM-1024", "One-time keys", "Not the identity key"],
  },
  {
    id: "pqxdh",
    host: "signal.org/docs/specifications/pqxdh",
    product: "the safety number",
    finding: "The shape is familiar. The bytes are not Signal’s, and a Signal client will not match them.",
    who: "Signal",
    venue: "PQXDH specification",
    href: "https://signal.org/docs/specifications/pqxdh/",
    pubLabel: "Modelled on · not compatible",
    docTitle: "The post-quantum extended handshake, and a different fingerprint",
    docAbstract:
      "Courier’s first message follows the same four X25519 terms plus one ML-KEM encapsulation. Safety numbers are 12 groups of 5 digits from SHA-256. Signal’s numeric fingerprints use SHA-512.",
    tags: ["SHA-256", "12 × 5 digits", "Not Signal"],
  },
];

export function ResearchBand() {
  const reduce = useReducedMotion() ?? false;
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { amount: 0.3 });
  const [active, setActive] = useState(0);
  const [hold, setHold] = useState(false);
  const [moved, setMoved] = useState(false);

  useEffect(() => {
    if (active !== 0) setMoved(true);
  }, [active]);

  useEffect(() => {
    if (reduce || !inView || hold) return;
    const t = window.setTimeout(() => setActive((a) => (a + 1) % DOCS.length), 4600);
    return () => window.clearTimeout(t);
  }, [active, reduce, inView, hold]);

  return (
    <section ref={ref} id="research" className="scroll-mt-20 py-16 md:py-20" aria-labelledby="research-heading">
      <div className="max-w-[660px]">
        <div className="inline-flex items-center gap-2 text-[13px] font-medium text-brand">
          <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden="true" />
          <span>Standards</span>
        </div>
        <h2 id="research-heading" className="mt-2 text-[30px] leading-[1.12] font-medium tracking-[-0.03em] sm:text-[38px]">
          The standards behind the seal.
        </h2>
      </div>
      <div className={`${styles.layout} mt-9`}>
        <ul className={styles.list} onMouseLeave={() => setHold(false)}>
          {DOCS.map((doc, i) => (
            <li
              key={doc.id}
              className={`${styles.item} ${i === active ? styles.itemOn : ""}`}
              onMouseEnter={() => {
                setActive(i);
                setHold(true);
              }}
              onClick={() => {
                setActive(i);
                setHold(true);
              }}
            >
              <span className={styles.num}>0{i + 1}</span>
              <div className={styles.itemBody}>
                <span className={styles.informs}>Informs {doc.product}</span>
                <p className={styles.finding}>{doc.finding}</p>
                <p className={styles.who}>
                  {doc.who} · {doc.venue} ·{" "}
                  <a className={styles.sourceLink} href={doc.href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                    Source
                  </a>
                </p>
              </div>
            </li>
          ))}
        </ul>
        <div className={styles.deck} aria-label="Standards informing Courier">
          {DOCS.map((doc, i) => {
            const k = (i - active + DOCS.length) % DOCS.length;
            return (
              <a
                key={`${doc.id}-${k === DOCS.length - 1 ? active : "s"}`}
                href={doc.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${doc.who}, ${doc.venue}`}
                tabIndex={k === 0 ? 0 : -1}
                className={`${styles.paper} ${styles["k" + k]} ${k === DOCS.length - 1 && moved ? styles.out : ""}`}
              >
                <span className={styles.chrome}>
                  <span className={styles.dots}>
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className={styles.url}>{doc.host}</span>
                </span>
                <span className={styles.docBody}>
                  <span className={styles.docPub}>{doc.pubLabel}</span>
                  <span className={styles.docTitle}>{doc.docTitle}</span>
                  <span className={styles.docAbstract}>{doc.docAbstract}</span>
                  <span className={styles.docMeta}>
                    {doc.tags.map((tag) => (
                      <span key={tag} className={styles.docTag}>
                        {tag}
                      </span>
                    ))}
                  </span>
                </span>
                <span className={styles.chip}>
                  <span>Informs {doc.product}</span>
                  <ExternalLink className="h-3 w-3 opacity-80" />
                </span>
              </a>
            );
          })}
        </div>
      </div>
    </section>
  );
}
