import Image from "next/image";
import Link from "next/link";
import { dateCT, mmss, type PublishedEpisode } from "../../podcast/episodes";
import { Headshots } from "./Headshots";
import { PlayButton } from "./PlayButton";

export function trackOf(e: PublishedEpisode) {
  return e.audio_url ? { episodeId: e.episode_id, title: e.title, src: e.audio_url } : null;
}

export function EpisodeRow({ e }: { e: PublishedEpisode }) {
  const dur = mmss(e.duration_seconds);
  return (
    <li className="flex gap-4 rounded-card border border-line bg-surface p-4 sm:items-center sm:gap-5 sm:p-5">
      <Link href={`/podcast/${e.episode_id}`} className="shrink-0" aria-hidden="true" tabIndex={-1}>
        <Image src="/podcast/cover-600.png" alt="" width={96} height={96} sizes="(min-width: 640px) 96px, 72px" className="h-[72px] w-[72px] rounded-card sm:h-24 sm:w-24" />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-5">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-xs tracking-[0.08em] text-ink-muted">
            <time dateTime={e.published_at}>{dateCT(e.published_at)}</time>
            {dur ? <span> · {dur}</span> : null}
          </p>
          <h2 className="mt-1 text-lg font-bold leading-snug tracking-tight">
            <Link href={`/podcast/${e.episode_id}`} className="hover:text-primary">{e.title}</Link>
          </h2>
          <div className="mt-2"><Headshots cast={e.cast} size={32} /></div>
        </div>
        <PlayButton track={trackOf(e)} />
      </div>
    </li>
  );
}

export function EpisodeList({ items, nextCursor }: { items: PublishedEpisode[]; nextCursor: string | null }) {
  if (!items.length) {
    return (
      <div className="rounded-card border border-dashed border-line bg-muted p-8 text-center">
        <p className="font-semibold">The first episode is in production.</p>
        <p className="mt-1 text-sm text-ink-muted">Published episodes appear here, newest first. The RSS feed is already live.</p>
      </div>
    );
  }
  return (
    <>
      <ul className="flex flex-col gap-4" role="list">
        {items.map((e) => <EpisodeRow key={e.episode_id} e={e} />)}
      </ul>
      {nextCursor ? (
        <p className="mt-8">
          <Link href={`/podcast?before=${encodeURIComponent(nextCursor)}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-primary underline-offset-4 hover:underline">
            Older episodes →
          </Link>
        </p>
      ) : null}
    </>
  );
}
