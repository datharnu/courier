import type { Metadata } from "next";
import { Faq } from "@/components/faq";

export const metadata: Metadata = { title: "Courier · Questions" };

export default function QuestionsPage() {
  return (
    <div className="mx-auto max-w-[1040px] px-5 pb-24">
      <Faq />
    </div>
  );
}
