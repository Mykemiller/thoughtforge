import type { MetadataRoute } from "next";
import { PANEL_SORTED } from "@/src/data/panel";
import { teamPhotos } from "@/src/data/team-photos";
import { listPublishedEpisodes } from "@/src/lib/podcast/queries";

export const revalidate = 3600;

const BASE = "https://faraday-thoughtforge.com";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { items: episodes } = await listPublishedEpisodes(100);
  return [
    { url: `${BASE}/`, changeFrequency: "weekly", priority: 1, images: teamPhotos.map((p) => `${BASE}${p.file}`) },
    { url: `${BASE}/panel`, changeFrequency: "monthly", priority: 0.8 },
    ...PANEL_SORTED.map((m) => ({ url: `${BASE}/panel/${m.slug}`, changeFrequency: "monthly" as const, priority: 0.6 })),
    { url: `${BASE}/podcast`, changeFrequency: "weekly", priority: 0.7 },
    ...episodes.map((e) => ({ url: `${BASE}/podcast/${e.episode_id}`, lastModified: e.published_at, changeFrequency: "monthly" as const, priority: 0.5 })),
  ];
}
