// Front-matter parser for artifact Markdown files (TH-32 §5). Pure; no I/O.
import { parse } from "yaml";

export const ARTIFACT_SOURCES = ["primary", "secondary", "panel"] as const;
export type ArtifactSource = (typeof ARTIFACT_SOURCES)[number];

export interface ArtifactDoc {
  title: string;
  publisher: string | null;
  url: string | null;
  published_at: string | null; // YYYY-MM-DD
  source: ArtifactSource;
  idf_domains: string[];
  tags: string[];
  body: string;
}

const strList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" && v.trim() ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);

/** Split `---\n<yaml>\n---\n<body>` and validate the fields the ingest needs. */
export function parseArtifactMarkdown(raw: string): ArtifactDoc {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error("no YAML front matter (expected a leading --- block)");
  const fm = (parse(m[1]) ?? {}) as Record<string, unknown>;
  const body = m[2].trim();
  const title = typeof fm.title === "string" ? fm.title.trim() : "";
  if (!title) throw new Error("front matter needs a title");
  if (!body) throw new Error("the artifact body is empty");
  const source = String(fm.source ?? "secondary").toLowerCase();
  if (!(ARTIFACT_SOURCES as readonly string[]).includes(source)) throw new Error(`source must be one of ${ARTIFACT_SOURCES.join(", ")} (got ${source})`);
  let published_at: string | null = null;
  if (fm.published_at !== undefined && fm.published_at !== null && fm.published_at !== "") {
    const d = fm.published_at instanceof Date ? fm.published_at.toISOString().slice(0, 10) : String(fm.published_at).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`published_at must be YYYY-MM-DD (got ${String(fm.published_at)})`);
    published_at = d;
  }
  const url = typeof fm.url === "string" && fm.url.trim() ? fm.url.trim() : null;
  if (url && !/^https?:\/\//.test(url)) throw new Error(`url must start with http(s):// (got ${url})`);
  return {
    title,
    publisher: typeof fm.publisher === "string" && fm.publisher.trim() ? fm.publisher.trim() : null,
    url,
    published_at,
    source: source as ArtifactSource,
    idf_domains: strList(fm.idf_domains),
    tags: strList(fm.tags),
    body,
  };
}
