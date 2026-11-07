/**
 * Faraday Daily Signal Digest parser (Linear TH-36, PP-02).
 *
 * Input: one digest as an exported .eml (RFC 822, MIME multipart, quoted-printable) or as the bare HTML body.
 * Output: one ParsedDigest with every signal block as a ParsedSignal, shaped for tf_signal_digests / tf_digest_signals.
 *
 * Structure of the digest, read from real editions (2026-09-28 and 2026-11-07, same template):
 *   header   <div ...>2026-11-06 08:00 → 2026-11-07 08:00 UTC · 40 signals[ · showing top 50 of 54]</div>
 *   section  <div style="font-size:15px;font-weight:700;...border-bottom:2px solid ...">IDF domain name</div>
 *   signal   <div style="padding:14px 0;border-top:1px solid ...">
 *              <div ...>summary</div>
 *              <div ...><a href="URL">Read the source — Publisher →</a></div>
 *            </div>
 *   appendix "Counties with Moratoriums" (items without sources); kept on the digest, not stored as signals.
 *   footer   "Domain names sourced from the IDF Domain Registry." -> section headings are IDF domain names.
 * The text/plain part carries the same content ("Section" / "  - summary" / "    Source (Publisher): URL") and is
 * the fallback when an HTML body is missing or yields nothing.
 *
 * The digest carries no per-signal title, published date, jurisdiction, confidence or entities. title is derived
 * from the summary's first sentence (raw.title_derived = true); confidence and an IDF code (e.g. D2.3) are taken
 * verbatim if a block ever carries them; everything unrecognised goes to raw.extra, never dropped.
 *
 * Dependency-free on purpose: imported by the Next app (bundler resolution) and by scripts/ (NodeNext).
 */

export interface ParsedSignal {
  position: number;
  title: string;
  summary: string | null;
  source_url: string | null;
  publisher: string | null;
  published_at: string | null;
  idf_domain: string | null;
  idf_subdomain: string | null;
  jurisdiction: string | null;
  confidence: string | null;
  signal_type: string | null;
  entities: unknown[];
  raw: Record<string, unknown>;
}

export interface ParsedDigest {
  digest_date: string;
  subject: string | null;
  /** The count the digest itself states (subject line, else the header line). The yield check compares against this. */
  signal_count: number | null;
  source_message_id: string | null;
  raw_html: string | null;
  raw_text: string | null;
  window: { start: string | null; end: string | null };
  /** "showing top 50 of 54": total signals before the digest's own cut, when stated. */
  total_before_cut: number | null;
  signals: ParsedSignal[];
  /** Appendix items (moratorium list), verbatim. */
  appendix: { section: string; items: string[]; note: string | null }[];
  parser: "html" | "text";
  warnings: string[];
}

export const APPENDIX_SECTIONS = [/^counties with moratori/i];
export const TITLE_MAX = 160;

// ---------- small helpers ----------

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", rarr: "→" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Tags out, entities decoded, whitespace collapsed. */
export function htmlText(s: string): string {
  return decodeEntities(s.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/** First sentence of the summary, capped at TITLE_MAX characters on a word boundary. */
export function deriveTitle(summary: string): string {
  const s = summary.trim();
  const m = s.match(/^[\s\S]*?[.!?](?=\s+[A-Z0-9"'“(]|\s*$)/);
  let t = (m ? m[0] : s).trim();
  if (t.length > TITLE_MAX) {
    const cut = t.slice(0, TITLE_MAX - 1);
    const sp = cut.lastIndexOf(" ");
    t = `${(sp > 60 ? cut.slice(0, sp) : cut).replace(/[\s,;:]+$/, "")}…`;
  }
  return t;
}

const DATE_RE = /(\d{4}-\d{2}-\d{2})/;

/** "Faraday Daily Signal Digest — 37 signals · 2026-11-01" */
export function subjectFacts(subject: string | null): { date: string | null; count: number | null } {
  if (!subject) return { date: null, count: null };
  const d = subject.match(/(\d{4}-\d{2}-\d{2})\s*$/);
  const c = subject.match(/(\d+)\s+signals?\b/i);
  return { date: d ? d[1] : null, count: c ? Number(c[1]) : null };
}

/** "2026-11-06 08:00 → 2026-11-07 08:00 UTC · 40 signals · showing top 50 of 54" (HTML) or "->" (text). */
export function headerFacts(text: string): { start: string | null; end: string | null; count: number | null; total: number | null } {
  const w = text.match(/(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2})\s*(?:→|->|&rarr;)\s*(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2})\s*UTC/);
  const c = text.match(/UTC\s*·\s*(\d+)\s+signals?/i);
  const t = text.match(/showing top\s+\d+\s+of\s+(\d+)/i);
  return {
    start: w ? `${w[1].replace(" ", "T")}:00Z` : null,
    end: w ? `${w[2].replace(" ", "T")}:00Z` : null,
    count: c ? Number(c[1]) : null,
    total: t ? Number(t[1]) : null,
  };
}

// ---------- MIME ----------

interface MimePart {
  headers: Record<string, string>;
  body: string;
}

function splitHeaders(raw: string): { headers: Record<string, string>; body: string } {
  const m = raw.match(/\r?\n\r?\n/);
  const idx = m && m.index !== undefined ? m.index : raw.length;
  const head = raw.slice(0, idx);
  const body = m && m.index !== undefined ? raw.slice(idx + m[0].length) : "";
  const headers: Record<string, string> = {};
  for (const line of head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const k = line.slice(0, i).trim().toLowerCase();
    if (!(k in headers)) headers[k] = line.slice(i + 1).trim();
  }
  return { headers, body };
}

function bytesToUtf8(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset || "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

export function decodeQuotedPrintable(s: string, charset = "utf-8"): string {
  const soft = s.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < soft.length; i++) {
    const ch = soft[i];
    if (ch === "=" && /^[0-9A-Fa-f]{2}$/.test(soft.slice(i + 1, i + 3))) {
      bytes.push(parseInt(soft.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      const code = ch.charCodeAt(0);
      if (code < 0x80) bytes.push(code);
      else for (const b of new TextEncoder().encode(ch)) bytes.push(b);
    }
  }
  return bytesToUtf8(Uint8Array.from(bytes), charset);
}

function decodeBase64(s: string, charset = "utf-8"): string {
  return bytesToUtf8(Uint8Array.from(Buffer.from(s.replace(/\s+/g, ""), "base64")), charset);
}

/** RFC 2047 encoded words (Q and B), adjacent words joined without the whitespace between them. */
export function decodeEncodedWords(s: string): string {
  return s
    .replace(/(=\?[^?]+\?[QqBb]\?[^?]*\?=)\s+(?==\?[^?]+\?[QqBb]\?[^?]*\?=)/g, "$1")
    .replace(/=\?([^?]+)\?([QqBb])\?([^?]*)\?=/g, (_m, cs: string, enc: string, text: string) =>
      enc.toUpperCase() === "B" ? decodeBase64(text, cs) : decodeQuotedPrintable(text.replace(/_/g, " "), cs),
    );
}

function param(header: string | undefined, name: string): string | null {
  if (!header) return null;
  const m = header.match(new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, "i"));
  return m ? (m[1] ?? m[2]) : null;
}

function decodeBody(part: MimePart): string {
  const cte = (part.headers["content-transfer-encoding"] || "").toLowerCase();
  const charset = param(part.headers["content-type"], "charset") || "utf-8";
  if (cte === "quoted-printable") return decodeQuotedPrintable(part.body, charset);
  if (cte === "base64") return decodeBase64(part.body, charset);
  return part.body;
}

function leafParts(raw: string): MimePart[] {
  const { headers, body } = splitHeaders(raw);
  const ct = headers["content-type"] || "text/plain";
  if (/^multipart\//i.test(ct)) {
    const boundary = param(ct, "boundary");
    if (!boundary) return [];
    const out: MimePart[] = [];
    const pieces = body.split(`--${boundary}`);
    for (const piece of pieces.slice(1)) {
      if (piece.startsWith("--")) break;
      out.push(...leafParts(piece.replace(/^\r?\n/, "")));
    }
    return out;
  }
  return [{ headers, body }];
}

export interface EmlContent {
  subject: string | null;
  messageId: string | null;
  html: string | null;
  text: string | null;
}

export function readEml(raw: string): EmlContent {
  const { headers } = splitHeaders(raw);
  let html: string | null = null;
  let text: string | null = null;
  for (const p of leafParts(raw)) {
    const ct = (p.headers["content-type"] || "text/plain").toLowerCase();
    if (ct.startsWith("text/html") && html === null) html = decodeBody(p);
    else if (ct.startsWith("text/plain") && text === null) text = decodeBody(p);
  }
  const mid = headers["message-id"] ? headers["message-id"].replace(/^<|>$/g, "").trim() : null;
  return { subject: headers.subject ? decodeEncodedWords(headers.subject).replace(/\s+/g, " ").trim() : null, messageId: mid, html, text };
}

/** An .eml starts with RFC 822 headers; an HTML export starts with markup. */
export function looksLikeEml(raw: string): boolean {
  const head = raw.slice(0, 4000).replace(/^﻿/, "");
  if (/^\s*</.test(head)) return false;
  return /^[A-Za-z][A-Za-z0-9-]*:\s/m.test(head) && /^(content-type|subject|from|mime-version):/im.test(head);
}

// ---------- signal extraction ----------

interface RawSection {
  name: string;
  items: { html?: string; text: string; url: string | null; anchor: string | null; extra: string[] }[];
  note: string | null;
}

const SECTION_HEAD = /<div[^>]*font-weight:\s*700[^>]*border-bottom[^>]*>([\s\S]*?)<\/div>/gi;
const ITEM_START = /<div[^>]*padding:\s*\d+px\s+0;\s*border-top[^>]*>/gi;
const SOURCE_ANCHOR = /<a\b[^>]*href\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/i;
const INNER_DIV = /<div\b[^>]*>([\s\S]*?)<\/div>/gi;

function htmlSections(html: string): RawSection[] {
  // Stop at the footer rule so the footer text never lands in the last section.
  const hr = html.search(/<hr\b/i);
  const body = hr >= 0 ? html.slice(0, hr) : html;
  const heads: { name: string; start: number; end: number }[] = [];
  for (const m of body.matchAll(SECTION_HEAD)) heads.push({ name: htmlText(m[1]), start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  const out: RawSection[] = [];
  heads.forEach((h, i) => {
    const chunk = body.slice(h.end, i + 1 < heads.length ? heads[i + 1].start : body.length);
    const starts = [...chunk.matchAll(ITEM_START)].map((m) => ({ at: m.index ?? 0, len: m[0].length }));
    const section: RawSection = { name: h.name, items: [], note: null };
    starts.forEach((s, j) => {
      const piece = chunk.slice(s.at + s.len, j + 1 < starts.length ? starts[j + 1].at : chunk.length);
      const a = piece.match(SOURCE_ANCHOR);
      const withoutAnchor = a ? piece.replace(a[0], "") : piece;
      const divs = [...withoutAnchor.matchAll(INNER_DIV)].map((d) => htmlText(d[1])).filter(Boolean);
      // A trailing small-print div after the last item (no border-top) is the section note, e.g. the moratorium source line.
      let note: string | null = null;
      if (j === starts.length - 1) {
        const tail = piece.match(/<\/div>\s*<\/div>\s*<div[^>]*margin-top:\s*10px[^>]*>([\s\S]*?)<\/div>/i);
        if (tail) {
          note = htmlText(tail[1]);
          const k = divs.lastIndexOf(note);
          if (k >= 0) divs.splice(k, 1);
        }
      }
      if (note) section.note = note;
      const [text = "", ...extra] = divs;
      section.items.push({ text, url: a ? decodeEntities(a[1]).trim() : null, anchor: a ? htmlText(a[2]) : null, extra });
    });
    out.push(section);
  });
  return out;
}

function textSections(text: string): RawSection[] {
  const out: RawSection[] = [];
  let cur: RawSection | null = null;
  let item: RawSection["items"][number] | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (/^FARADAY DAILY SIGNAL DIGEST/i.test(line) || /UTC\s*·/.test(line)) continue;
    const bullet = line.match(/^\s{1,4}-\s+(.*)$/);
    const source = line.match(/^\s{3,}Source\s*\((.*)\):\s*(\S+)\s*$/);
    const note = line.match(/^\s+\[(.*)\]\s*$/);
    if (!/^\s/.test(line)) {
      cur = { name: line.trim(), items: [], note: null };
      out.push(cur);
      item = null;
    } else if (cur && bullet) {
      item = { text: bullet[1].trim(), url: null, anchor: null, extra: [] };
      cur.items.push(item);
    } else if (cur && item && source) {
      item.url = source[2];
      item.anchor = `Source (${source[1]})`;
    } else if (cur && note) {
      cur.note = note[1].trim();
    } else if (item) {
      item.extra.push(line.trim());
    }
  }
  return out;
}

function publisherOf(anchor: string | null): string | null {
  if (!anchor) return null;
  const m = anchor.match(/^Read the source\s*[—–-]\s*(.*?)\s*(?:→|->)?\s*$/i) || anchor.match(/^Source\s*\((.*)\)$/i);
  const p = (m ? m[1] : anchor).trim();
  return p || null;
}

function toSignals(sections: RawSection[]): { signals: ParsedSignal[]; appendix: ParsedDigest["appendix"] } {
  const signals: ParsedSignal[] = [];
  const appendix: ParsedDigest["appendix"] = [];
  for (const s of sections) {
    if (APPENDIX_SECTIONS.some((re) => re.test(s.name))) {
      appendix.push({ section: s.name, items: s.items.map((i) => i.text).filter(Boolean), note: s.note });
      continue;
    }
    s.items.forEach((it, k) => {
      const summary = it.text || null;
      const extraJoined = it.extra.join(" · ");
      const confidence = extraJoined.match(/\bconfidence\s*:\s*([^·|]+?)\s*(?:·|\||$)/i);
      const code = extraJoined.match(/\bD\d+(?:\.\d+)+\b/);
      const raw: Record<string, unknown> = { section: s.name, position_in_section: k + 1, title_derived: true };
      if (it.anchor) raw.source_label = it.anchor;
      if (it.extra.length) raw.extra = it.extra;
      if (!it.url) raw.missing_source = true;
      signals.push({
        position: signals.length + 1,
        title: summary ? deriveTitle(summary) : `(untitled signal ${signals.length + 1})`,
        summary,
        source_url: it.url,
        publisher: publisherOf(it.anchor),
        published_at: null,
        idf_domain: s.name || null,
        idf_subdomain: code ? code[0] : null,
        jurisdiction: null,
        confidence: confidence ? confidence[1].trim() : null,
        signal_type: null,
        entities: [],
        raw,
      });
    });
  }
  return { signals, appendix };
}

// ---------- entry point ----------

export interface ParseOptions {
  /** File name, used for a YYYY-MM-DD fallback when neither subject nor header carries a date. */
  filename?: string;
}

export function parseDigest(input: string, opt: ParseOptions = {}): ParsedDigest {
  const raw = input.replace(/^﻿/, "");
  const warnings: string[] = [];
  let subject: string | null = null;
  let messageId: string | null = null;
  let html: string | null = null;
  let text: string | null = null;
  if (looksLikeEml(raw)) {
    const eml = readEml(raw);
    ({ subject, messageId, html, text } = eml);
    if (!html && !text) warnings.push("eml has neither a text/html nor a text/plain part");
  } else {
    html = raw;
  }

  let sections: RawSection[] = html ? htmlSections(html) : [];
  let parser: ParsedDigest["parser"] = "html";
  const htmlSignalCount = toSignals(sections).signals.length;
  if (htmlSignalCount === 0 && text) {
    const ts = textSections(text);
    if (toSignals(ts).signals.length > 0) {
      if (html) warnings.push("HTML body yielded no signals; fell back to the text/plain part");
      sections = ts;
      parser = "text";
    }
  }
  const { signals, appendix } = toSignals(sections);

  const headerSource = html ? htmlText(html.slice(0, 6000)) : text ? text.slice(0, 2000) : "";
  const hdr = headerFacts(headerSource);
  const subj = subjectFacts(subject);
  const fileDate = opt.filename?.match(DATE_RE)?.[1] ?? null;
  const digest_date = subj.date ?? (hdr.end ? hdr.end.slice(0, 10) : null) ?? fileDate;
  if (!digest_date) throw new Error("cannot determine digest_date: no date in the subject, the header line or the file name");
  if (subj.date && hdr.end && subj.date !== hdr.end.slice(0, 10)) warnings.push(`subject date ${subj.date} differs from header window end ${hdr.end.slice(0, 10)}`);
  const signal_count = subj.count ?? hdr.count;
  if (subj.count !== null && hdr.count !== null && subj.count !== hdr.count) warnings.push(`subject says ${subj.count} signals, header says ${hdr.count}`);

  return {
    digest_date,
    subject,
    signal_count,
    source_message_id: messageId,
    raw_html: html,
    raw_text: text ?? (html ? htmlText(html) : null),
    window: { start: hdr.start, end: hdr.end },
    total_before_cut: hdr.total,
    signals,
    appendix,
    parser,
    warnings,
  };
}

/** Parsed signals over the count the digest states; 1 when the digest states no count but signals were found. */
export function parseYield(d: Pick<ParsedDigest, "signals" | "signal_count">): number {
  if (!d.signal_count) return d.signals.length > 0 ? 1 : 0;
  return d.signals.length / d.signal_count;
}

export const MIN_YIELD = 0.8;

/** Row for tf_signal_digests. */
export function digestRow(d: ParsedDigest) {
  return {
    digest_date: d.digest_date,
    subject: d.subject,
    signal_count: d.signal_count,
    source_message_id: d.source_message_id,
    raw_html: d.raw_html,
    raw_text: d.raw_text,
  };
}

/** Rows for tf_digest_signals (digest_id filled by the caller). */
export function signalRows(d: ParsedDigest, digestId: string) {
  return d.signals.map((s) => ({ digest_id: digestId, ...s }));
}
