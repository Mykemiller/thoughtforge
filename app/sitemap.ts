import type { MetadataRoute } from "next";
import { PANEL_SORTED } from "@/src/data/panel";
import { teamPhotos } from "@/src/data/team-photos";

const BASE = "https://faraday-thoughtforge.com";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${BASE}/`, changeFrequency: "weekly", priority: 1, images: teamPhotos.map((p) => `${BASE}${p.file}`) },
    { url: `${BASE}/panel`, changeFrequency: "monthly", priority: 0.8 },
    ...PANEL_SORTED.map((m) => ({ url: `${BASE}/panel/${m.slug}`, changeFrequency: "monthly" as const, priority: 0.6 })),
  ];
}
