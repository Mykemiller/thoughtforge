import Link from "next/link";
import { PanelStrip } from "@/src/components/PanelStrip";
import { MeetTheTeam, type TeamBio } from "@/src/components/MeetTheTeam";
import { PANEL_SORTED, panelAlt } from "@/src/data/panel";
import { teamPhotos } from "@/src/data/team-photos";
import { aboutFromLinkedin } from "@/src/cast/bio";
import { loadCast } from "@/src/cast/load";

const TIERS = [
  { code: "VRF", label: "Verified against a retrieved primary source." },
  { code: "SRC", label: "Sourced to a named document or publication." },
  { code: "EST", label: "Estimate built from sourced inputs. Method stated." },
  { code: "INF", label: "Inference or judgment. No direct source." },
];

/** Ten bios in cast order: first paragraph of the in-app About (TF-DEC-43), via the cast loader. */
function loadBios(): TeamBio[] {
  const cast = loadCast();
  return PANEL_SORTED.map((m) => {
    const member = cast.find((c) => c.slug === m.slug);
    const about = member ? aboutFromLinkedin(member.linkedin) : "";
    return {
      slug: m.slug,
      name: m.name,
      role: m.role,
      thumb: m.thumb,
      alt: panelAlt(m),
      bio: about.split(/\n\s*\n/)[0]?.trim() || m.bio,
    };
  });
}

export default function HomePage() {
  const bios = loadBios();
  return (
    <main>
      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 pb-16 pt-16 sm:px-6 sm:pb-20 sm:pt-24">
        <p className="font-mono text-xs tracking-[0.08em] text-ink-muted">THOUGHTFORGE</p>
        <h1 className="mt-3 max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
          Ten advisors. One ruling. Every datacenter decision argued in the open.
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ink-muted">
          Ask the panel a datacenter question. Each advisor answers from their own domain, disagreement
          stays on the record, every claim carries a confidence label, and the Chief of Staff closes
          with a ruling and the evidence that would change it.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/panel"
            className="inline-flex min-h-11 items-center rounded-card bg-primary px-5 text-sm font-semibold text-surface hover:bg-primary/90"
          >
            Meet the Panel
          </Link>
          <Link
            href="/ask"
            className="inline-flex min-h-11 items-center rounded-card border border-primary px-5 text-sm font-semibold text-primary hover:bg-muted"
          >
            Ask the panel
          </Link>
        </div>
      </section>

      <MeetTheTeam photos={teamPhotos} bios={bios} />

      <PanelStrip />

      {/* Evidence ladder */}
      <section aria-labelledby="evidence-heading" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <p className="font-mono text-xs tracking-[0.08em] text-ink-muted">HOW A REPLY IS GRADED</p>
        <h2 id="evidence-heading" className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
          Every reply carries an evidence tier
        </h2>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2" role="list">
          {TIERS.map((t) => (
            <li key={t.code} className="flex gap-4 rounded-card border border-line p-5">
              <span className="inline-flex h-8 shrink-0 items-center rounded-sm bg-primary px-2 font-mono text-xs text-surface">
                {t.code}
              </span>
              <p className="text-ink-muted">{t.label}</p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
