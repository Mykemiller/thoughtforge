/**
 * ElevenLabs text-to-speech for the 1:1 room (TH-50, TF-DEC-78).
 *
 * A panelist's voice is named in src/data/panel.ts by its exact ElevenLabs
 * voice name and resolved to an id here at run time with the environment key,
 * never from a hand-copied id. The key is read from process.env only and never
 * logged. No voice is ever cloned (TF-DEC-13, TF-DEC-16). Plain fetch; no SDK.
 */
import "server-only";
import { pickVoice, VoiceError, type VoiceEntry } from "./resolve";

export { pickVoice, VoiceError, type VoiceEntry };

export const ELEVENLABS_API = "https://api.elevenlabs.io";
export const TTS_MODEL = "eleven_turbo_v2_5"; // lowest latency for conversation; TH-38 uses multilingual_v2 for produced audio
export const TTS_OUTPUT_FORMAT = "mp3_44100_128";
export const TTS_VOICE_SETTINGS = { stability: 0.5, similarity_boost: 0.75, style: 0.2, use_speaker_boost: true } as const; // TH-38 values
export const VOICE_CACHE_MS = 10 * 60 * 1000;
export const TTS_MAX_CHARS = 1200;

export const hasVoiceEnv = () => Boolean(process.env.ELEVENLABS_API_KEY);

let cache: { at: number; voices: VoiceEntry[] } | null = null;

export async function listVoices(): Promise<VoiceEntry[]> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new VoiceError("ELEVENLABS_API_KEY is not set", "no_key");
  if (cache && Date.now() - cache.at < VOICE_CACHE_MS) return cache.voices;
  const res = await fetch(`${ELEVENLABS_API}/v1/voices`, { headers: { "xi-api-key": key }, cache: "no-store" });
  if (!res.ok) throw new VoiceError(`ElevenLabs voices list failed (${res.status})`, "upstream");
  const body = (await res.json()) as { voices?: { voice_id: string; name: string }[] };
  const voices = (body.voices ?? []).map((v) => ({ voice_id: v.voice_id, name: v.name }));
  cache = { at: Date.now(), voices };
  return voices;
}

export async function resolveVoiceId(name: string): Promise<string> {
  return pickVoice(await listVoices(), name).voice_id;
}

/** Streams MP3 bytes for one phrase. The caller pipes `body` to the browser. */
export async function synthesize(voiceId: string, text: string, signal?: AbortSignal): Promise<Response> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new VoiceError("ELEVENLABS_API_KEY is not set", "no_key");
  const res = await fetch(`${ELEVENLABS_API}/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=${TTS_OUTPUT_FORMAT}`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: TTS_MODEL, voice_settings: TTS_VOICE_SETTINGS }),
    signal,
    cache: "no-store",
  });
  if (!res.ok || !res.body) throw new VoiceError(`ElevenLabs synthesis failed (${res.status})`, "upstream");
  return res;
}

/** For tests only. */
export function _resetVoiceCache(): void {
  cache = null;
}
