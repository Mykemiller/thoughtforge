import { listPublishedEpisodes } from "@/src/lib/podcast/queries";
import { buildFeed } from "@/src/podcast/feed";

export const revalidate = 300; // cache 5 minutes

export async function GET() {
  const { items } = await listPublishedEpisodes(100);
  return new Response(buildFeed(items), {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=60",
    },
  });
}
