import Image from "next/image";
import Link from "next/link";
import { dateCT, mmss, type PublishedEpisode } from "../../podcast/episodes";
import { Headshots } from "./Headshots";
import { PlayButton } from "./PlayButton";
import { trackOf } from "./EpisodeList";

/** Home-page card (TH-39). Renders nothing when there is no published episode. Fixed min-height, server-rendered: no layout shift. */
export function LatestEpisodeCard({ episode }: { episode: PublishedEpisode | null }) {
  if (!episode) return null;
  const dur = mmss(episode.duration_seconds);
  return (
    <section aria-labelledby="latest-episode-heading" className="mx-auto max-w-6xl px-4 pb-14 sm:px-6">
      <div className="flex min-h-[168px] flex-col gap-5 rounded-card border border-line bg-muted p-5 sm:flex-row sm:items-center sm:p-6">
        <Image src="/podcast/cover-600.png" alt="" width={144} height={144} sizes="(min-width: 640px) 144px, 96px" className="h-24 w-24 shrink-0 rounded-card sm:h-36 sm:w-36" />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-xs tracking-[0.08em] text-ink-muted">LATEST EPISODE · {episode.show.toUpperCase()}</p>
          <h2 id="latest-episode-heading" className="mt-2 text-xl font-bold leading-snug tracking-tight sm:text-2xl">
            <Link href={`/podcast/${episode.episode_id}`} className="hover:text-primary">{episode.title}</Link>
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            <time dateTime={episode.published_at}>{dateCT(episode.published_at)}</time>
            {dur ? <span> · {dur}</span> : null}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <Headshots cast={episode.cast} size={40} />
            <PlayButton track={trackOf(episode)} label="Play episode" />
            <Link href="/podcast" className="inline-flex min-h-11 items-center text-sm font-semibold text-primary underline-offset-4 hover:underline">
              Podcast Library →
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
