/**
 * Sentence buffering for per-sentence speech (TH-50). Pure, client-safe.
 *
 * Replies stream as word deltas; audio is requested one sentence at a time so
 * the first words are heard long before the reply finishes. Evidence tags and
 * markdown are stripped from what is spoken (they stay in the transcript).
 */

const TAG_RE = /\s*\[(?:VRF|SRC|EST|INF)(?::[^\]]*)?\]/g;

/** What the voice reads: no evidence tags, no markdown emphasis, collapsed whitespace. */
export function spokenText(text: string): string {
  return text
    .replace(TAG_RE, "")
    .replace(/[*_`#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split finished text into sentences on terminal punctuation followed by whitespace. */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  const re = /[^.!?]+(?:[.!?]+["')\]]*|$)/g;
  for (const m of text.matchAll(re)) {
    const s = m[0].trim();
    if (s) out.push(s);
  }
  return out;
}

export const MIN_SPOKEN_CHARS = 24;

/**
 * Accumulates deltas and emits complete sentences. Very short sentences are held
 * and joined with the next one so the TTS gets natural phrases, not fragments.
 */
export class SentenceBuffer {
  private buf = "";
  private held = "";

  /** Push a delta; returns zero or more sentences ready to speak. */
  push(delta: string): string[] {
    this.buf += delta;
    const out: string[] = [];
    for (;;) {
      const m = this.buf.match(/^([\s\S]*?[.!?]+["')\]]*)(\s+)([\s\S]*)$/);
      if (!m) break;
      const sentence = spokenText(m[1]);
      this.buf = m[3];
      const phrase = this.held ? `${this.held} ${sentence}` : sentence;
      if (phrase.length < MIN_SPOKEN_CHARS) {
        this.held = phrase;
        continue;
      }
      this.held = "";
      if (phrase) out.push(phrase);
    }
    return out;
  }

  /** Flush whatever remains (end of reply). */
  flush(): string[] {
    const rest = spokenText(this.buf);
    this.buf = "";
    const phrase = [this.held, rest].filter(Boolean).join(" ").trim();
    this.held = "";
    return phrase ? [phrase] : [];
  }

  reset(): void {
    this.buf = "";
    this.held = "";
  }
}
