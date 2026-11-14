import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EpisodeView } from "@/src/components/podcast/EpisodeView";
import { getEpisode } from "@/src/lib/podcast/queries";

export const revalidate = 300;

type Props = { params: Promise<{ episode_id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { episode_id } = await params;
  const e = await getEpisode(episode_id);
  if (!e) return { title: "Episode not found" };
  return {
    title: e.title,
    description: `${e.show}: ${e.signals.map((s) => s.title).slice(0, 3).join(" · ")}`.slice(0, 300),
    alternates: { canonical: `/podcast/${e.episode_id}` },
    openGraph: { type: "music.song", images: ["/podcast/cover-600.png"], audio: e.audio_url ?? undefined },
  };
}

export default async function EpisodePage({ params }: Props) {
  const { episode_id } = await params;
  const e = await getEpisode(episode_id);
  if (!e) notFound();
  return <EpisodeView e={e} />;
}
