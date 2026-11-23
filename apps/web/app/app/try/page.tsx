import type { Metadata } from "next";
import { TryDemo } from "@/components/try-demo";

export const metadata: Metadata = { title: "Courier · Catch a lying relay" };

export default function TryPage() {
  return (
    <div className="mx-auto max-w-[1180px] px-5 pb-24">
      <div className="pt-8">
        <p className="text-[13px] font-medium text-brand">Try it in this browser</p>
        <h1 className="mt-2 text-[30px] leading-[1.12] font-medium tracking-[-0.03em] sm:text-[38px]">Catch a lying relay.</h1>
        <p className="mt-3 max-w-[68ch] text-[15px] text-muted">
          A client sends a message and an invoice file to a vendor through a relay that runs in this page. The handshake, ratchet and file
          encryption are Courier&rsquo;s protocol code from <code className="font-mono text-[13px]">src/ts</code>, running here. The
          vendor&rsquo;s bundle hash and the client&rsquo;s ML-DSA-87 key are read from QoreChain testnet. Make the relay lie and watch the
          client refuse.
        </p>
      </div>
      <TryDemo />
    </div>
  );
}
