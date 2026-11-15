import Image from "next/image";
import Link from "next/link";
import Markdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import { PANEL, panelAlt } from "../../data/panel";
import { dateCT, mmss, transcript, type PublishedEpisode } from "../../podcast/episodes";
import { castNames } from "./Headshots";
import { PlayButton } from "./PlayButton";
import { trackOf } from "./EpisodeList";

export function EpisodeView({ e }: { e: PublishedEpisode }) {
  const dur = mmss(e.duration_seconds);
  const names = castNames();
  const lines = e.script ? transcript(e.script, names) : [];
  const cast = e.cast.map((c) => ({ c, m: PANEL.find((p) => p.slug === c.slug) })).filter((x) => x.m);
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <p className="font-mono text-xs tracking-[0.08em] text-ink-muted">
        <Link href="/podcast" className="hover:text-primary">PODCAST LIBRARY</Link> · {e.show.toUpperCase()}
      </p>
      <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-start">
        <Image src="/podcast/cover-600.png" alt="" width={144} height={144} sizes="144px" priority className="h-28 w-28 shrink-0 rounded-card sm:h-36 sm:w-36" />
        <div className="min-w-0">
          <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl">{e.title}</h1>
          <p className="mt-2 text-ink-muted">
            <time dateTime={e.published_at}>{dateCT(e.published_at)}</time>
            {dur ? <span> · {dur}</span> : null} · <span className="font-mono text-xs">{e.episode_id}</span>
          </p>
          <div className="mt-4"><PlayButton track={trackOf(e)} label="Play episode" size="lg" /></div>
        </div>
      </div>

      {cast.length ? (
        <section aria-labelledby="cast-heading" className="mt-10">
          <h2 id="cast-heading" className="font-mono text-xs tracking-[0.08em] text-ink-muted">ON MIC</h2>
          <ul className="mt-3 flex flex-wrap gap-4" role="list">
            {cast.map(({ c, m }) => (
              <li key={c.slug}>
                <Link href={`/panel/${c.slug}`} className="group flex items-center gap-3 rounded-card border border-line p-2 pr-4 hover:border-accent">
                  <span className="block h-12 w-12 overflow-hidden rounded-full">
                    <Image src={m!.thumb} alt={panelAlt(m!)} width={48} height={48} sizes="48px" className="h-full w-full object-cover" />
                  </span>
                  <span className="flex flex-col leading-tight">
                    <span className="text-sm font-semibold group-hover:text-primary">{m!.name}</span>
                    <span className="text-xs text-ink-muted">{c.role === "chair" ? "Chair" : m!.role}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {e.signals.length ? (
        <section aria-labelledby="signals-heading" className="mt-10">
          <h2 id="signals-heading" className="text-xl font-bold tracking-tight">The signals</h2>
          <ol className="mt-4 flex flex-col gap-3" role="list">
            {e.signals.map((s, i) => (
              <li key={s.signal_id || i} className="flex gap-3 rounded-card border border-line p-4">
                <span className="font-mono text-sm text-accent">{i + 1}</span>
                <div className="min-w-0">
                  {s.source_url ? (
                    <a href={s.source_url} target="_blank" rel="noopener noreferrer" className="font-semibold hover:text-primary hover:underline">
                      {s.title}<span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  ) : (
                    <span className="font-semibold">{s.title}</span>
                  )}
                  <p className="mt-1 text-sm text-ink-muted">{[s.publisher, s.domain].filter(Boolean).join(" · ")}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {e.show_notes_md ? (
        <section aria-labelledby="notes-heading" className="mt-10">
          <h2 id="notes-heading" className="text-xl font-bold tracking-tight">Show notes</h2>
          <div className="podcast-notes mt-4 break-words leading-relaxed text-ink">
            <Markdown rehypePlugins={[rehypeSanitize]}>{e.show_notes_md.replace(/^#\s.*\n+/, "")}</Markdown>
          </div>
        </section>
      ) : null}

      {lines.length ? (
        <details className="mt-10 rounded-card border border-line p-4 [&_summary]:cursor-pointer">
          <summary className="font-semibold">Transcript</summary>
          <div className="mt-4 flex flex-col gap-4">
            {lines.map((l, i) => (
              <p key={i} className="leading-relaxed">
                <span className="font-semibold text-primary">{`${l.name}:`}</span>{` ${l.text}`}
              </p>
            ))}
          </div>
        </details>
      ) : null}
    </article>
  );
}
