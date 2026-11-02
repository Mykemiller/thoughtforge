import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Monogram } from "@/src/components/Monogram";
import { AskPanel } from "@/src/components/ask/AskPanel";
import { PANEL_SORTED } from "@/src/data/panel";
import { CHIEF_OF_STAFF, FACT_CHECKER, LIMITS, PANEL_ORDER } from "@/src/ask/roster";

export const metadata: Metadata = {
  title: "Ask the Panel",
  description: "Put a datacenter question to the ten ThoughtForge advisors and get one ruling.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AskPage() {
  const locked = (await headers()).get("x-tf-locked") === "1";
  const bySlug = new Map(PANEL_SORTED.map((m) => [m.slug, m]));
  const panelists = PANEL_ORDER.map((s) => bySlug.get(s)!);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-16">
      <header className="flex items-start gap-4">
        <Monogram size={48} />
        <div>
          <p className="font-mono text-xs tracking-[0.08em] text-ink-muted">THOUGHTFORGE</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Ask the Panel</h1>
          <p className="mt-2 max-w-2xl text-ink-muted">
            Eight advisors answer from their own domain, the Fact-Checker grades every claim, and the Chief of Staff rules last.
          </p>
        </div>
      </header>

      <div className="mt-10">
        {locked ? (
          <section className="max-w-xl rounded-card border border-line bg-muted p-6">
            <p className="font-mono text-xs tracking-[0.08em] text-ink-muted">PRIVATE</p>
            <h2 className="mt-2 text-xl font-bold tracking-tight">The panel room is private for now.</h2>
            <p className="mt-3 leading-relaxed text-ink-muted">
              Ask the Panel is open to its owner only while the panel is in its first season. The panelists themselves are public:
              you can read who they are and how they argue.
            </p>
            <Link
              href="/panel"
              className="mt-5 inline-flex min-h-11 items-center rounded-card bg-primary px-5 text-sm font-semibold text-surface hover:bg-primary/90"
            >
              Meet the Panel
            </Link>
          </section>
        ) : (
          <AskPanel
            panelists={panelists}
            factChecker={bySlug.get(FACT_CHECKER)!}
            chiefOfStaff={bySlug.get(CHIEF_OF_STAFF)!}
            roster={PANEL_SORTED}
            maxChars={LIMITS.questionMaxChars}
            mock={process.env.TF_MOCK === "1"}
          />
        )}
      </div>
    </main>
  );
}
