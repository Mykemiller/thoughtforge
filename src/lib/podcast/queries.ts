/**
 * Panel Podcast reads for the public pages (TH-39, PP-05).
 *
 * Production reads go through the anon key, so RLS (PP-03 policy tf_episodes_anon_read_published) limits them to
 * status = 'published'; the query also filters on it, belt and braces. TF_MOCK=1 reads fixtures/podcast/library.json
 * instead, so screenshots and tests need no database. Any read failure (missing env, table not yet migrated, network)
 * is logged and treated as "no episodes", so a public page never 500s because the podcast is not live yet.
 */
import "server-only";
import { cache } from "react";
import library from "../../../fixtures/podcast/library.json";
import { getAnonClient, hasAnonEnv } from "../supabase";
import { PAGE_SIZE, PUBLIC_COLUMNS, isCursor, pageOf, sortNewestFirst, toPublishedEpisode, type PublishedEpisode } from "../../podcast/episodes";

export type { PublishedEpisode };

const isMock = () => process.env.TF_MOCK === "1";

function mockEpisodes(): PublishedEpisode[] {
  return (library.episodes as Record<string, unknown>[]).map(toPublishedEpisode).filter((e): e is PublishedEpisode => e !== null);
}

export async function listPublishedEpisodes(limit = PAGE_SIZE, cursor?: string | null): Promise<{ items: PublishedEpisode[]; nextCursor: string | null }> {
  const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 100);
  const before = isCursor(cursor) ? cursor : null;
  if (isMock()) return pageOf(mockEpisodes(), safeLimit, before);
  if (!hasAnonEnv()) return { items: [], nextCursor: null };
  try {
    let q = getAnonClient()
      .from("tf_episodes")
      .select(PUBLIC_COLUMNS)
      .eq("status", "published")
      .not("published_at", "is", null)
      .order("published_at", { ascending: false })
      .order("episode_id", { ascending: false })
      .limit(safeLimit + 1);
    if (before) q = q.lt("published_at", before);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = (data ?? []).map((r) => toPublishedEpisode(r as Record<string, unknown>)).filter((e): e is PublishedEpisode => e !== null).sort(sortNewestFirst);
    const items = rows.slice(0, safeLimit);
    return { items, nextCursor: rows.length > safeLimit ? items[items.length - 1].published_at : null };
  } catch (e) {
    console.error(`[podcast] listPublishedEpisodes: ${(e as Error).message}`);
    return { items: [], nextCursor: null };
  }
}

/** Deduplicated per request with React cache(): generateMetadata and the page share one read. */
export const getEpisode = cache(async function getEpisode(episodeId: string): Promise<PublishedEpisode | null> {
  if (!/^PP-\d{8}-\d{2}$/.test(episodeId)) return null;
  if (isMock()) return mockEpisodes().find((e) => e.episode_id === episodeId) ?? null;
  if (!hasAnonEnv()) return null;
  try {
    const { data, error } = await getAnonClient().from("tf_episodes").select(PUBLIC_COLUMNS).eq("episode_id", episodeId).eq("status", "published").maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toPublishedEpisode(data as Record<string, unknown>) : null;
  } catch (e) {
    console.error(`[podcast] getEpisode ${episodeId}: ${(e as Error).message}`);
    return null;
  }
});

export async function latestEpisode(): Promise<PublishedEpisode | null> {
  return (await listPublishedEpisodes(1)).items[0] ?? null;
}
