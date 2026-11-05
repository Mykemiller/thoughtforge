/**
 * Voice for the 1:1 room (TH-50). Gated with the rest of /api/interview.
 *
 * GET  /api/interview/voice?slug=<slug>
 *      -> { available, voice_name, reason } : whether this panelist can speak on this deployment.
 * POST /api/interview/voice  { slug, text }
 *      -> audio/mpeg stream for one phrase (text under TTS_MAX_CHARS), spoken in the
 *         panelist's ElevenLabs voice, resolved by exact name at run time (TF-DEC-78).
 * TF_MOCK=1 reports voice unavailable so demos stay silent and free.
 */
import { NextResponse, type NextRequest } from "next/server";
import { PANEL } from "@/src/data/panel";
import { isMock } from "@/src/ask/mock";
import { hasVoiceEnv, resolveVoiceId, synthesize, TTS_MAX_CHARS, VoiceError } from "@/src/voice/elevenlabs";
import { spokenText } from "@/src/voice/sentences";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function reasonFor(err: unknown): string {
  if (err instanceof VoiceError) {
    if (err.code === "no_key") return "ELEVENLABS_API_KEY is not set on this deployment.";
    if (err.code === "missing") return `${err.message}. Add it in ElevenLabs or change the name in src/data/panel.ts.`;
    if (err.code === "ambiguous") return err.message;
  }
  return err instanceof Error ? err.message : "Voice is unavailable.";
}

export async function GET(req: NextRequest): Promise<Response> {
  const slug = req.nextUrl.searchParams.get("slug") ?? "";
  const member = PANEL.find((m) => m.slug === slug);
  if (!member) return NextResponse.json({ error: "slug must name a panelist" }, { status: 400 });
  if (isMock()) return NextResponse.json({ available: false, voice_name: member.elevenLabsVoiceName ?? null, reason: "Demo mode: no voice." });
  if (!member.elevenLabsVoiceName) return NextResponse.json({ available: false, voice_name: null, reason: "No ElevenLabs voice is named for this panelist yet; text only." });
  if (!hasVoiceEnv()) return NextResponse.json({ available: false, voice_name: member.elevenLabsVoiceName, reason: "ELEVENLABS_API_KEY is not set on this deployment." });
  try {
    await resolveVoiceId(member.elevenLabsVoiceName);
    return NextResponse.json({ available: true, voice_name: member.elevenLabsVoiceName, reason: null });
  } catch (err) {
    console.warn(`[voice] ${slug}: ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ available: false, voice_name: member.elevenLabsVoiceName, reason: reasonFor(err) });
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  let body: { slug?: unknown; text?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON: { slug, text }" }, { status: 400 });
  }
  const slug = typeof body.slug === "string" ? body.slug : "";
  const member = PANEL.find((m) => m.slug === slug);
  if (!member) return NextResponse.json({ error: "slug must name a panelist" }, { status: 400 });
  const text = spokenText(typeof body.text === "string" ? body.text : "");
  if (!text) return NextResponse.json({ error: "text is required" }, { status: 400 });
  if (text.length > TTS_MAX_CHARS) return NextResponse.json({ error: `text is over ${TTS_MAX_CHARS} characters` }, { status: 400 });
  if (isMock()) return NextResponse.json({ error: "Demo mode: no voice." }, { status: 503 });
  if (!member.elevenLabsVoiceName) return NextResponse.json({ error: "No ElevenLabs voice is named for this panelist." }, { status: 503 });
  try {
    const voiceId = await resolveVoiceId(member.elevenLabsVoiceName);
    const upstream = await synthesize(voiceId, text, req.signal);
    return new Response(upstream.body, {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
    });
  } catch (err) {
    console.warn(`[voice] ${slug}: ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ error: reasonFor(err) }, { status: 503 });
  }
}
