import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";
import { Monogram } from "@/src/components/Monogram";
import { LockedRoom } from "@/src/components/interview/LockedRoom";
import { PANEL_SORTED, panelAlt } from "@/src/data/panel";

export const metadata: Metadata = {
  title: "1:1 Interviews",
  description: "Sit down with one ThoughtForge panelist at a time.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function InterviewIndex({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const locked = (await headers()).get("x-tf-locked") === "1";
  const denied = locked && (await searchParams).denied === "1";

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-16">
      <header className="flex items-start gap-4">
        <Monogram size={48} />
        <div>
          <p className="font-mono text-xs tracking-[0.08em] text-ink-muted">THOUGHTFORGE</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">1:1 Interviews</h1>
          <p className="mt-2 max-w-2xl text-ink-muted">One panelist, one interviewer, no ruling and no grading. Pick who you want to sit down with.</p>
        </div>
      </header>

      <div className="mt-10">
        {locked ? (
          <LockedRoom action="/interview" denied={denied} />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="list" aria-label="Panelists">
            {PANEL_SORTED.map((m) => (
              <li key={m.slug}>
                <Link href={`/interview/${m.slug}`} className="group flex items-center gap-4 rounded-card border border-line bg-surface p-4 hover:border-accent">
                  <Image src={m.thumb} alt={panelAlt(m)} width={56} height={56} className="h-14 w-14 rounded-full object-cover ring-2 ring-line" />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-ink group-hover:text-primary">{m.name}</span>
                    <span className="block truncate font-mono text-[11px] uppercase tracking-[0.08em] text-accent">{m.role}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
