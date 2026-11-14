import type { Metadata } from "next";
import Link from "next/link";
import { EpisodeList } from "@/src/components/podcast/EpisodeList";
import { listPublishedEpisodes } from "@/src/lib/podcast/queries";
import { FALLBACK_SHOW, PAGE_SIZE } from "@/src/podcast/episodes";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Podcast Library",
  description: "The ThoughtForge Panel Podcast: three advisors argue the day's strongest datacenter signals and the Chief of Staff rules.",
  alternates: { canonical: "/podcast", types: { "application/rss+xml": "/podcast/feed.xml" } },
};

export default async function PodcastPage({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const { before } = await searchParams;
  const { items, nextCursor } = await listPublishedEpisodes(PAGE_SIZE, before ?? null);
  const show = items[0]?.show ?? FALLBACK_SHOW;
  return (
    <main className="mx-auto max-w-4xl px-4 py-14 sm:px-6 sm:py-20">
      <header className="max-w-3xl">
        <p className="font-mono text-xs tracking-[0.08em] text-ink-muted">PODCAST LIBRARY</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">{show}</h1>
        <p className="mt-4 text-lg leading-relaxed text-ink-muted">
          Three advisors take the day&apos;s strongest datacenter signals and argue them in the open. Every claim is
          graded; the Chief of Staff rules.
        </p>
        <p className="mt-4 text-sm">
          <Link href="/podcast/feed.xml" className="font-semibold text-primary underline-offset-4 hover:underline">RSS feed</Link>
          {before ? (
            <>
              {" · "}
              <Link href="/podcast" className="font-semibold text-primary underline-offset-4 hover:underline">Newest episodes</Link>
            </>
          ) : null}
        </p>
      </header>
      <div className="mt-10">
        <EpisodeList items={items} nextCursor={nextCursor} />
      </div>
    </main>
  );
}
