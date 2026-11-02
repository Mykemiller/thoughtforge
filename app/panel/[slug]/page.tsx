import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PANEL, panelAlt } from "@/src/data/panel";
import { getMember } from "@/src/cast/load";
import { panelStaticParams } from "@/src/cast/params";
import { aboutFromLinkedin, education, experience, formatDegree, formatSpan, lifeOutsideWork, voices } from "@/src/cast/bio";

type Params = { slug: string };

export const dynamicParams = false;

export function generateStaticParams(): Params[] {
  return panelStaticParams();
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const manifest = PANEL.find((m) => m.slug === slug);
  if (!manifest) return {};
  return {
    title: manifest.name, // layout template renders "<Name> | ThoughtForge"
    description: `${manifest.name}, ${manifest.role} on the ThoughtForge panel: ${manifest.specialty}.`,
    alternates: { canonical: `/panel/${slug}` },
  };
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="anchor-target border-t border-line py-10">
      <h2 id={`${id}-heading`} className="font-mono text-xs tracking-[0.08em] text-ink-muted">
        {title.toUpperCase()}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default async function PanelistPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const manifest = PANEL.find((m) => m.slug === slug);
  const member = getMember(slug);
  if (!manifest || !member) notFound();

  const about = aboutFromLinkedin(member.linkedin);
  const jobs = experience(member);
  const schools = education(member);
  const life = lifeOutsideWork(member);
  const net = voices(member);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-16">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-muted">
        <Link href="/panel" className="underline-offset-4 hover:underline">
          Meet the Panel
        </Link>
        <span aria-hidden="true"> / </span>
        <span className="text-ink">{manifest.name}</span>
      </nav>

      {/* Header: headshot and role */}
      <header className="mt-6 grid gap-8 sm:grid-cols-[minmax(0,320px)_1fr] sm:items-end">
        <div className="relative aspect-square w-full max-w-[320px] overflow-hidden rounded-card border border-line bg-muted">
          <Image
            src={manifest.image}
            alt={panelAlt(manifest)}
            width={800}
            height={800}
            priority
            sizes="(min-width: 640px) 320px, 100vw"
            className="h-full w-full object-cover"
          />
        </div>
        <div>
          <p className="font-mono text-xs tracking-[0.08em] text-ink-muted">THOUGHTFORGE PANEL</p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">{manifest.name}</h1>
          <p className="mt-2 font-mono text-sm uppercase tracking-[0.08em] text-accent">{manifest.role}</p>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-ink-muted">{manifest.specialty}</p>
          <p className="mt-4 max-w-2xl rounded-card border border-line bg-muted p-4 text-sm leading-relaxed text-ink">
            {member.voiceBrief}
          </p>
        </div>
      </header>

      <div className="mt-12 max-w-3xl">
        <Section id="about" title="About">
          <p className="text-lg leading-relaxed text-ink">{about}</p>
        </Section>

        <Section id="experience" title="Experience">
          <ol className="flex flex-col gap-5" role="list">
            {jobs.map((j) => (
              <li key={`${j.employer}-${j.start}`} className="grid gap-1 sm:grid-cols-[8rem_1fr]">
                <span className="font-mono text-xs text-ink-muted sm:pt-1">{formatSpan(j)}</span>
                <div>
                  <p className="font-semibold text-ink">{j.title}</p>
                  <p className="text-ink-muted">
                    {j.employer}
                    {j.location ? ` · ${j.location}` : ""}
                  </p>
                  {j.summary ? <p className="mt-1 text-sm leading-relaxed text-ink-muted">{j.summary}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        </Section>

        <Section id="education" title="Education">
          <ul className="flex flex-col gap-3" role="list">
            {schools.map((e) => (
              <li key={`${e.institution}-${e.year}`} className="grid gap-1 sm:grid-cols-[8rem_1fr]">
                <span className="font-mono text-xs text-ink-muted sm:pt-1">{e.year}</span>
                <div>
                  <p className="font-semibold text-ink">{e.institution}</p>
                  <p className="text-ink-muted">{formatDegree(e)}</p>
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="life" title="Life outside work">
          <dl className="grid gap-4 sm:grid-cols-2">
            {life.map((r) => (
              <div key={r.label} className="rounded-card border border-line p-4">
                <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">{r.label}</dt>
                <dd className="mt-1 leading-relaxed text-ink">{r.value}</dd>
              </div>
            ))}
          </dl>
          {member.persona.family.length ? (
            <p className="mt-4 text-sm text-ink-muted">
              Family: {member.persona.family.map((f) => `${f.name} (${f.relation.toLowerCase()})`).join("; ")}. All fictional.
            </p>
          ) : null}
        </Section>

        <Section id="voices" title="Voices they follow">
          <p className="text-sm text-ink-muted">
            Public settings before 2025. The panelist&apos;s side of every connection is fictional.
          </p>
          <ul className="mt-4 divide-y divide-line rounded-card border border-line" role="list">
            {net.map((v) => (
              <li key={`${v.name}-${v.venue}`} className="grid gap-1 p-4 sm:grid-cols-[1fr_auto] sm:items-baseline">
                <div>
                  <p className="text-ink">
                    <span className="text-ink-muted">{v.kind}</span>{" "}
                    <span className="font-semibold">{v.name}</span>
                  </p>
                  <p className="text-sm text-ink-muted">{v.venue}</p>
                </div>
                <span className="font-mono text-xs text-ink-muted">since {v.since}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="skills" title="Working with the panel">
          <ul className="grid gap-4 sm:grid-cols-3" role="list">
            {member.skills.map((s) => (
              <li key={s.name} className="rounded-card border border-line p-4">
                <p className="font-mono text-sm font-medium text-primary">{s.name}</p>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">{s.description}</p>
              </li>
            ))}
          </ul>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/ask"
              className="inline-flex min-h-11 items-center rounded-card bg-primary px-5 text-sm font-semibold text-surface hover:bg-primary/90"
            >
              Ask the panel
            </Link>
            <Link
              href="/panel"
              className="inline-flex min-h-11 items-center rounded-card border border-line px-5 text-sm font-semibold text-primary hover:bg-muted"
            >
              Back to the panel
            </Link>
          </div>
        </Section>
      </div>
    </main>
  );
}
