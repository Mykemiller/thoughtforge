import type { MetadataRoute } from "next";

const BASE = "https://faraday-thoughtforge.com";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${BASE}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/panel`, changeFrequency: "monthly", priority: 0.8 },
  ];
}
