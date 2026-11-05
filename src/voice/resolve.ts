/**
 * Pure voice-name resolution (TH-50, TF-DEC-78). No I/O, importable by tests.
 */
export interface VoiceEntry {
  voice_id: string;
  name: string;
}

export class VoiceError extends Error {
  constructor(message: string, public readonly code: "no_key" | "missing" | "ambiguous" | "upstream") {
    super(message);
  }
}

/** Exact-name match against the account's voices; zero or several matches are errors (TH-38 rule). */
export function pickVoice(voices: VoiceEntry[], name: string): VoiceEntry {
  const hits = voices.filter((v) => v.name.trim() === name.trim());
  if (hits.length === 1) return hits[0];
  if (hits.length === 0) throw new VoiceError(`no voice named "${name}" in My Voices`, "missing");
  throw new VoiceError(`${hits.length} voices named "${name}"; rename one in ElevenLabs`, "ambiguous");
}
