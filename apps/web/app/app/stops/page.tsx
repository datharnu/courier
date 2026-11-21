import type { Metadata } from "next";
import { FailureScene } from "@/components/failure-scene";
import { loadFacts } from "@/lib/load-group";

export const metadata: Metadata = { title: "Courier · Stops" };

export default function StopsPage() {
  return (
    <div className="mx-auto max-w-[1040px] px-5 pb-24">
      <FailureScene facts={loadFacts()} />
    </div>
  );
}
