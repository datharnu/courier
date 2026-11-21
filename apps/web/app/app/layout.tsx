import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { loadFacts } from "@/lib/load-group";

export const metadata: Metadata = {
  title: "Courier · Recorded group",
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const facts = loadFacts();
  return (
    <AppShell recorded={Boolean(facts)} when={facts?.ranAt ?? null}>
      {children}
    </AppShell>
  );
}
