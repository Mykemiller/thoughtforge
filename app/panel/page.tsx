import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { PANEL_SORTED, panelAlt, type PanelMember } from "@/src/data/panel";
import { loadCast, type CastMember } from "@/src/cast/load";

export const metadata: Metadata = {
  title: "Meet the Panel",
  description:
    "The ten ThoughtForge advisors: who they are, what they cover, and how they argue a datacenter decision.",
  alternates: { canonical: "/panel" },
};

function MemberCard({ member, cast, priority }: { member: PanelMember; cast: CastMember; priority: boolean }) {
  const href = `/panel/${member.slug}`;
  return (
    <li
      id={member.slug}
      className="anchor-target flex flex-col overflow-hidden rounded-card border border-line bg-surface"
    >
      <Link href={href} className="block" aria-label={`${member.name}: full profile`}>
        <Image
          src={member.image}
          alt={panelAlt(member)}
          width={800}
          height={800}
          priority={priority}
          sizes="(min-width: 1024px) 560px, (min-width: 640px) 50vw, 100vw"
          className="aspect-square w-full object-cover"
        />
      </Link>
      <div className="flex flex-col gap-3 p-6">
        <div>
          <h2 className="text-xl font-bold tracking-tight">
            <Link href={href} className="hover:text-primary">
              {member.name}
            </Link>
          </h2>
          <p className="mt-1 font-mono text-xs uppercase tracking-[0.08em] text-accent">{member.role}</p>
        </div>
        <p className="text-sm font-medium text-ink">{member.specialty}</p>
        <p className="leading-relaxed text-ink-muted">{cast.voiceBrief}</p>
        <Link
          href={href}
          className="mt-1 inline-flex min-h-11 items-center self-start text-sm font-semibold text-primary underline-offset-4 hover:underline"
        >
          Full profile →
        </Link>
      </div>
    </li>
  );
}

export default function PanelPage() {
  const cast = new Map(loadCast().map((m) => [m.slug, m]));
  return (
    <main className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
      <header className="max-w-3xl">
        <p className="font-mono text-xs tracking-[0.08em] text-ink-muted">THOUGHTFORGE</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">Meet the Panel</h1>
        <p className="mt-4 text-lg text-ink-muted">Ten advisors. One ruling. Every decision argued in the open.</p>
      </header>

      <ul className="mt-12 grid gap-8 md:grid-cols-2" role="list">
        {PANEL_SORTED.map((m, i) => (
          <MemberCard key={m.slug} member={m} cast={cast.get(m.slug)!} priority={i < 2} />
        ))}
      </ul>
    </main>
  );
}
