// Pure core for `npm run interview:notes` (Linear TH-52). No file, git or network I/O here.
//
// Input: one saved interview session (tf_sessions, kind = 'interview'), the panelist's cast text
// and the fixed arc (docs/interviews/guide.md). Output: the interview-notes.md text, the proposed
// persona.json and dossier.md deltas, and the Q6 midterm artifact. Everything is deterministic:
// the same session and cast files always give byte-identical output, so a rerun is a no-op.
//
// The delta proposer is conservative (TH-52 D2): it only proposes additions, each one a verbatim
// quote from the transcript tagged with its turn and its line in interview-notes.md. It never
// rewrites an existing field. Nothing here merges anything (TF-DEC-40, TF-DEC-50).

import { transcriptMarkdown } from "../../src/interview/transcript.ts";
import { properNouns } from "./audit-core.ts";

export interface Turn {
  role: "user" | "assistant";
  content: string;
}

/** The tf_sessions columns the CLI reads. */
export interface SessionRow {
  id: string;
  kind: string | null;
  panelist: string | null;
  asked_at: string | null;
  transcript: Turn[] | null;
}

export interface Panelist {
  slug: string;
  displayName: string;
  role: string;
}

// ---------- decoy guard (TH-32 §0, TH-52) ----------

export const PROJECT_REF = "ycadmmngkdhvpcsrcuaq";
export const DECOY_PROJECT_REF = "xgbpmlkanxewtfizloay";
export const MIN_DC_FACILITIES = 18000;
export const MIN_ARTIFACTS = 100000;

/** Throws unless the URL names the project of record and not the decoy. */
export function assertProjectUrl(url: string | undefined): string {
  if (!url) throw new Error("guard: NEXT_PUBLIC_SUPABASE_URL is not set");
  if (url.includes(DECOY_PROJECT_REF)) throw new Error(`guard: refusing the decoy Supabase project ${DECOY_PROJECT_REF}`);
  if (!url.includes(PROJECT_REF)) throw new Error(`guard: NEXT_PUBLIC_SUPABASE_URL does not name the project of record ${PROJECT_REF}`);
  return url;
}

/** Throws unless the library counts say this is the real project (the decoy returns zero rows silently). */
export function assertGuardCounts(c: { dcFacilities: number | null; artifacts: number | null }): void {
  const dc = c.dcFacilities ?? 0;
  const art = c.artifacts ?? 0;
  if (dc < MIN_DC_FACILITIES) throw new Error(`guard: dc_facilities has ${dc} rows, expected at least ${MIN_DC_FACILITIES}; stopping`);
  if (art < MIN_ARTIFACTS) throw new Error(`guard: artifacts has ${art} rows, expected at least ${MIN_ARTIFACTS}; stopping`);
}

/** Throws unless the row is an interview with this panelist and a non-empty transcript. */
export function assertSession(row: SessionRow | null | undefined, sessionId: string, slug: string): asserts row is SessionRow & { transcript: Turn[]; asked_at: string } {
  if (!row) throw new Error(`session ${sessionId} does not resolve in tf_sessions; stopping`);
  if (row.kind !== "interview") throw new Error(`session ${sessionId} is kind '${row.kind}', not 'interview'; stopping`);
  if (row.panelist !== slug) throw new Error(`session ${sessionId} belongs to panelist '${row.panelist}', not '${slug}'; stopping`);
  if (!Array.isArray(row.transcript) || row.transcript.length === 0) throw new Error(`session ${sessionId} has no transcript; stopping`);
  if (!row.asked_at) throw new Error(`session ${sessionId} has no asked_at; stopping`);
}

// ---------- transcript and line references ----------

/** Session start as the transcript header shows it: ISO, UTC, no milliseconds. */
export function startedAtIso(askedAt: string): string {
  const d = new Date(askedAt);
  return Number.isNaN(d.getTime()) ? askedAt : d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** The transcript exactly as the interview saver writes it (reuses src/interview/transcript.ts). */
export function renderTranscript(p: Panelist, row: { id: string; asked_at: string; transcript: Turn[] }): string {
  return transcriptMarkdown({
    displayName: p.displayName,
    role: p.role,
    slug: p.slug,
    sessionId: row.id,
    startedAt: startedAtIso(row.asked_at),
    transcript: row.transcript,
  });
}

/**
 * 1-based line in the rendered transcript where each turn starts. transcriptMarkdown writes a
 * four-line head, then the turns joined by a blank line, so turn k starts after the lines of every
 * earlier turn plus one blank line each.
 */
export function turnLines(transcript: Turn[]): number[] {
  const out: number[] = [];
  let line = 5;
  for (const t of transcript) {
    out.push(line);
    line += t.content.trim().split("\n").length + 1;
  }
  return out;
}

// ---------- arc mapping ----------

const STOP = new Set(
  "what where when which while with from that this your you have does about would there their them they then than into what's how who why and the for are was were did out one own can".split(" "),
);
const words = (s: string) => (s.toLowerCase().match(/[a-z0-9']+/g) ?? []).filter((w) => w.length >= 4 && !STOP.has(w));

/** Map each arc question (index 0..n-1) to the interviewer turn that asks it, or -1. */
export function mapArc(transcript: Turn[], arc: string[]): number[] {
  const used = new Set<number>();
  return arc.map((q) => {
    const qw = new Set(words(q));
    let best = -1;
    let bestScore = 0;
    transcript.forEach((t, i) => {
      if (t.role !== "user" || used.has(i)) return;
      const tw = new Set(words(t.content));
      let hit = 0;
      for (const w of qw) if (tw.has(w)) hit++;
      const score = qw.size ? hit / qw.size : 0;
      if (score > bestScore) { bestScore = score; best = i; }
    });
    if (best >= 0 && bestScore >= 0.3) { used.add(best); return best; }
    return -1;
  });
}

/** The panelist turns that answer the interviewer turn at index i (until the next interviewer turn). */
export function answerTurns(transcript: Turn[], i: number): number[] {
  const out: number[] = [];
  for (let k = i + 1; k < transcript.length && transcript[k].role === "assistant"; k++) out.push(k);
  return out;
}

// ---------- held / drifted / new ----------

export interface CastText {
  /** dossier.md + linkedin.md + persona.json as text: what the panelist already is. */
  corpus: string;
  /** Distinctive anchors from persona.json (hometown, family, employers, schools, hobbies, venues). */
  anchors: string[];
  /** Names of real people in this panelist's network (TF-DEC-45). */
  network: string[];
  /** Every real person in the people spine snapshot. */
  spine: string[];
  /** Names that are always known: the other panelists, the interviewer, the arc's vocabulary. */
  known: string[];
}

export interface NoteLine {
  turn: number; // 1-based turn index in the transcript
  line: number; // 1-based line in interview-notes.md
  text: string;
}

export interface Addition {
  session_id: string;
  turn: number;
  line: number;
  phrase: string;
  quote: string;
  status: "proposed";
  source: "TH-52 interview:notes";
}

export interface Notes {
  held: NoteLine[];
  drifted: NoteLine[];
  added: NoteLine[];
  additions: Addition[];
  q6: { question: string; answer: string; turns: number[] } | null;
  arcGaps: number[]; // 1-based arc question numbers not found
}

export const MAX_LINES = 5;
const GRADE = /\b(?:VER|SRC|EST|INF|verified|sourced|estimated|inferred)\b/;

export function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z"“(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const norm = (s: string) => s.toLowerCase().replace(/^(?:dr|prof)\.\s+/, "").replace(/\s+/g, " ").trim();
const clip = (s: string, n = 220) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const quoteOf = (s: string) => clip(s.replace(/"/g, "'"));

/** Anchor terms from persona.json, deduped, longest first so "San Juan Islands" wins over "San Juan". */
export function personaAnchors(persona: Record<string, unknown>): string[] {
  const p = persona as {
    hometown?: string; family?: { name: string }[]; career?: { employer: string }[]; education?: { institution: string }[];
    organizations?: ({ name: string } | string)[]; moments?: { event: string; venue: string }[]; personal?: Record<string, string[]>;
    publications?: { title?: string }[];
  };
  const out = new Set<string>();
  if (p.hometown) out.add(p.hometown.split(",")[0].trim());
  for (const f of p.family ?? []) out.add(f.name.split(/\s+/)[0]);
  for (const c of p.career ?? []) out.add(c.employer.replace(/\s*\(.*\)$/, ""));
  for (const e of p.education ?? []) out.add(e.institution);
  for (const o of p.organizations ?? []) out.add((typeof o === "string" ? o : o.name).replace(/\s*\(.*\)$/, ""));
  for (const pub of p.publications ?? []) if (pub.title) out.add(String(pub.title).replace(/[?"“”]/g, ""));
  for (const v of Object.values(p.personal ?? {})) for (const line of v ?? []) for (const n of properNouns(line)) if (n.length > 3) out.add(n);
  for (const m of p.moments ?? []) for (const n of properNouns(`x ${m.venue}`)) out.add(n);
  return [...out].filter((a) => a.length > 2).sort((a, b) => b.length - a.length || a.localeCompare(b));
}

export function buildNotes(sessionId: string, transcript: Turn[], arc: string[], cast: CastText): Notes {
  const lines = turnLines(transcript);
  // Turn i, and the line in interview-notes.md where sentence s (if given) starts within that turn.
  const at = (i: number, s?: string) => {
    let offset = 0;
    if (s) {
      const head = s.slice(0, 40);
      const k = transcript[i].content.trim().split("\n").findIndex((l) => l.replace(/\s+/g, " ").includes(head));
      offset = Math.max(0, k);
    }
    return { turn: i + 1, line: lines[i] + offset };
  };
  const corpus = norm(cast.corpus);
  const networkSet = new Set(cast.network.map(norm));
  const spine = cast.spine.map((n) => ({ name: n, key: norm(n) }));
  const known = new Set(cast.known.flatMap((k) => [norm(k), ...k.split(/\s+/).map(norm)]));

  const held: NoteLine[] = [];
  const drifted: NoteLine[] = [];
  const added: NoteLine[] = [];
  const additions: Addition[] = [];
  const seenAnchor = new Set<string>();
  const seenPhrase = new Set<string>();

  const arcMap = mapArc(transcript, arc);
  const arcGaps = arcMap.map((v, i) => (v < 0 ? i + 1 : 0)).filter(Boolean);
  const q6Idx = arc.length >= 6 ? arcMap[5] : -1;
  const q6Turns = q6Idx >= 0 ? answerTurns(transcript, q6Idx) : [];

  transcript.forEach((t, i) => {
    if (t.role !== "assistant") return;
    const text = t.content;
    const lower = norm(text);
    // Held: the panelist used something the dossier already says.
    for (const a of cast.anchors) {
      const key = norm(a);
      if (seenAnchor.has(key) || !lower.includes(key)) continue;
      seenAnchor.add(key);
      const s = sentences(text).find((x) => norm(x).includes(key)) ?? text;
      held.push({ ...at(i, s), text: `${a}: "${quoteOf(s)}"` });
    }
    for (const s of sentences(text)) {
      const ns = norm(s);
      // Drifted: a real person outside this panelist's network (TF-DEC-45).
      for (const p of spine) {
        if (ns.includes(p.key) && !networkSet.has(p.key)) drifted.push({ ...at(i, s), text: `names ${p.name}, a real person outside this panelist's network (TF-DEC-45): "${quoteOf(s)}"` });
      }
      // Drifted: a number on Q6 with no evidence grade (guide: "a number with no grade is a note for TH-52").
      if (q6Turns.includes(i) && /\d/.test(s) && !GRADE.test(s)) drifted.push({ ...at(i, s), text: `Q6 number with no grade: "${quoteOf(s)}"` });
      // New: a proper noun the cast files do not contain and that is not a known name or a real person.
      // Sentence-initial single words are skipped by the extractor, which keeps this conservative.
      for (const ph of properNouns(s)) {
        const key = norm(ph);
        if (seenPhrase.has(key) || key.length < 3 || known.has(key) || corpus.includes(key)) continue;
        if (spine.some((p) => p.key === key || p.key.includes(key))) continue;
        seenPhrase.add(key);
        added.push({ ...at(i, s), text: `${ph}: "${quoteOf(s)}"` });
        additions.push({ session_id: sessionId, ...at(i, s), phrase: ph, quote: quoteOf(s), status: "proposed", source: "TH-52 interview:notes" });
      }
    }
  });

  const q6 =
    q6Idx >= 0
      ? { question: transcript[q6Idx].content.trim(), answer: q6Turns.map((k) => transcript[k].content.trim()).join("\n\n"), turns: q6Turns.map((k) => k + 1) }
      : null;
  return {
    held: held.slice(0, MAX_LINES),
    drifted: drifted.slice(0, MAX_LINES),
    added: added.slice(0, MAX_LINES),
    additions: additions.slice(0, MAX_LINES),
    q6,
    arcGaps,
  };
}

// ---------- interview-notes.md ----------

export function midtermTitle(displayName: string): string {
  return `[Temper Mark] ${displayName} on the 2026 midterms`;
}

const ref = (n: NoteLine) => `T${n.turn}, L${n.line}`;
const bullets = (xs: NoteLine[], none: string) => (xs.length ? xs.map((n) => `- ${n.text} (${ref(n)})`) : [`- ${none}`]);

/** The whole file: the transcript, then what held, what drifted and what was new. */
export function notesMarkdown(p: Panelist, row: { id: string; asked_at: string; transcript: Turn[] }, notes: Notes, arcLength: number): string {
  const transcript = renderTranscript(p, row);
  const gaps = notes.arcGaps.length ? `Arc questions not found in the transcript: ${notes.arcGaps.map((n) => `Q${n}`).join(", ")}.` : `All ${arcLength} arc questions found in the transcript.`;
  const q6 = notes.q6
    ? `Q6 answer: turns ${notes.q6.turns.map((t) => `T${t}`).join(", ") || "none"}. Saved on its own as "${midtermTitle(p.displayName)}" by \`--save-midterm\` once Myke confirms.`
    : `Q6 answer: not found, so no midterm artifact is proposed.`;
  const tail = [
    `## What held, what drifted, what was new`,
    ``,
    `Generated by \`npm run interview:notes\` (TH-52) from tf_sessions ${row.id}. Internal. Deterministic: a rerun on the same session rewrites this file byte for byte. Tn is the n-th turn above; Ln is its line in this file. Proposals only: nothing here changes the dossier until Myke merges a delta PR (TF-DEC-40, TF-DEC-50).`,
    ``,
    `### What held`,
    ``,
    ...bullets(notes.held, "Nothing matched the dossier's anchors."),
    ``,
    `### What drifted`,
    ``,
    ...bullets(notes.drifted, "No drift detected (real names outside the network, ungraded Q6 numbers)."),
    ``,
    `### What was new`,
    ``,
    ...bullets(notes.added, "No new names or places."),
    ``,
    `### Coverage`,
    ``,
    `- ${gaps}`,
    `- ${q6}`,
    ``,
  ];
  return `${transcript}\n${tail.join("\n")}`;
}

// ---------- deltas (proposed, never applied to main) ----------

export const DOSSIER_HEADING = "## Interview additions (proposed, TH-52)";

/** persona.json with this session's additions merged into `interview_additions`. Rerun-safe. */
export function applyPersonaDelta(personaJson: string, sessionId: string, additions: Addition[]): string {
  const p = JSON.parse(personaJson) as Record<string, unknown>;
  const prior = (Array.isArray(p.interview_additions) ? (p.interview_additions as Addition[]) : []).filter((a) => a.session_id !== sessionId);
  const merged = [...prior, ...additions].sort((a, b) => a.session_id.localeCompare(b.session_id) || a.turn - b.turn || a.phrase.localeCompare(b.phrase));
  if (merged.length) p.interview_additions = merged;
  else delete p.interview_additions;
  return `${JSON.stringify(p, null, 2)}\n`;
}

/** persona.json text with every proposed addition removed: what the panelist already is. */
export function withoutAdditions(personaJson: string): string {
  const p = JSON.parse(personaJson) as Record<string, unknown>;
  delete p.interview_additions;
  return `${JSON.stringify(p, null, 2)}\n`;
}

/** dossier.md with the proposed-additions section regenerated from the persona's additions. Rerun-safe. */
export function applyDossierDelta(dossier: string, all: Addition[]): string {
  const start = dossier.indexOf(`\n${DOSSIER_HEADING}\n`);
  let base = dossier;
  if (start >= 0) {
    const after = dossier.indexOf("\n## ", start + DOSSIER_HEADING.length + 1);
    base = dossier.slice(0, start + 1) + (after >= 0 ? dossier.slice(after + 1) : "");
  }
  base = base.replace(/\n+$/, "\n");
  if (!all.length) return base;
  const bySession = new Map<string, Addition[]>();
  for (const a of all) bySession.set(a.session_id, [...(bySession.get(a.session_id) ?? []), a]);
  const body = [
    ``,
    DOSSIER_HEADING,
    ``,
    `Quoted from interview transcripts, one line each with its turn. Proposed by \`npm run interview:notes\`; Myke decides what is kept, rewritten into the sections above, or dropped (TF-DEC-40).`,
    ``,
    ...[...bySession.keys()].sort().flatMap((sid) => [
      `- Session ${sid} (see interview-notes.md in this folder):`,
      ...bySession.get(sid)!.map((a) => `  - ${a.phrase} (T${a.turn}): "${a.quote}"`),
    ]),
    ``,
  ];
  return `${base}${body.join("\n")}`;
}

export interface DeltaSummary {
  slug: string;
  branch: string;
  personaAdditions: number;
  dossierLines: number;
}

export function deltaBranch(slug: string): string {
  return `th-52-notes-${slug}`;
}

// ---------- the midterm artifact (tf_artifacts) ----------

export const MIDTERM_TAG = "midterms-2026";

/**
 * Tags for the Q6 artifact. Deliberately no `session:<id>` tag: src/interview/save.ts finds the
 * transcript artifact by that tag, and sharing it would make the saver overwrite this row.
 * The upsert key is MIDTERM_TAG + `panelist:<slug>`: one row per panelist.
 */
export function midtermTags(slug: string, sessionId: string): string[] {
  return ["interview", "temper-mark", MIDTERM_TAG, `panelist:${slug}`, `from-session:${sessionId}`];
}

export function midtermArtifact(p: Panelist, sessionId: string, askedAt: string, q6: NonNullable<Notes["q6"]>, idfDomains: string[]) {
  const body = [
    `# ${midtermTitle(p.displayName)}`,
    ``,
    `${p.displayName}, ${p.role}, answering arc Q6 in the 1:1 interview, session ${sessionId} (${startedAtIso(askedAt)}). Verbatim from the transcript; comparable across the ten panelists (TH-48, TH-52).`,
    ``,
    `**Myke:** ${q6.question}`,
    ``,
    `**${p.displayName}:** ${q6.answer}`,
    ``,
  ].join("\n");
  return {
    title: midtermTitle(p.displayName),
    publisher: "ThoughtForge",
    url: null,
    published_at: startedAtIso(askedAt).slice(0, 10),
    body,
    source: "panel" as const,
    idf_domains: idfDomains,
    tags: midtermTags(p.slug, sessionId),
    created_by: "thoughtforge",
  };
}
