import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { PANEL } from "@/src/data/panel";
import { getMember } from "@/src/cast/load";
import { loadGuide } from "@/src/interview/guide";
import { INTERVIEW_LIMITS } from "@/src/interview/run";
import { InterviewRoom } from "@/src/components/interview/InterviewRoom";
import { LockedRoom } from "@/src/components/interview/LockedRoom";
import { faceClipsFor } from "@/src/interview/face";

type Params = { slug: string };

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const manifest = PANEL.find((m) => m.slug === slug);
  if (!manifest) return {};
  return { title: `1:1 with ${manifest.name}`, robots: { index: false, follow: false } };
}

export default async function InterviewPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<{ denied?: string }> }) {
  const { slug } = await params;
  const manifest = PANEL.find((m) => m.slug === slug);
  const member = getMember(slug);
  if (!manifest || !member) notFound();

  const locked = (await headers()).get("x-tf-locked") === "1";
  const denied = locked && (await searchParams).denied === "1";
  const guide = locked ? null : loadGuide();

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-16">
      {locked ? (
        <LockedRoom action={`/interview/${slug}`} denied={denied} />
      ) : (
        <InterviewRoom
          member={manifest}
          voiceBrief={member.persona.voice_brief}
          arc={guide!.arc}
          maxChars={INTERVIEW_LIMITS.messageMaxChars}
          mock={process.env.TF_MOCK === "1"}
          faceClips={faceClipsFor(slug)}
        />
      )}
    </main>
  );
}
