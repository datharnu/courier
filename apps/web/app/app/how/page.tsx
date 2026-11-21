import type { Metadata } from "next";
import { HowCourier } from "@/components/how-courier";
import { ResearchBand } from "@/components/research-band";

export const metadata: Metadata = { title: "Courier · How it works" };

export default function HowPage() {
  return (
    <div className="mx-auto max-w-[1040px] px-5 pb-24">
      <HowCourier />
      <div className="border-t border-line/70">
        <ResearchBand />
      </div>
    </div>
  );
}
