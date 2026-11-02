/**
 * Retrieval over Faraday artifacts (TH-32 §4.2, TF-DEC-03).
 *
 * Source A: tf_artifacts (ThoughtForge's own table, includes prior panel rulings).
 * Source B: public.artifacts, the Faraday library in the same Supabase project,
 *           read through the tf_search_faraday_artifacts() function created by
 *           supabase/migrations/20261101_tf_artifacts.sql. The function filters
 *           to rows with a real URL and a title, ranks by ts_rank_cd over the
 *           existing `fts` tsvector, and reads title/publisher out of the
 *           signal_envelope jsonb (see docs/decisions-th32.md).
 *
 * Every failure degrades: a missing env, an unapplied migration or a schema
 * mismatch returns fewer (or zero) artifacts and never throws to the caller.
 */
import { getServiceClient, hasServiceEnv } from "../lib/supabase";
import { tierForUrl, type ArtifactSource } from "./primary";

export interface Artifact {
  id: string;
  title: string;
  publisher: string | null;
  url: string | null;
  published_at: string | null;
  excerpt: string;
  source: ArtifactSource;
  /** Where the row came from: ThoughtForge's own table or the Faraday library. */
  origin: "tf_artifacts" | "faraday";
}

export const RETRIEVAL_LIMIT = 8;

type TfRow = { id: string; title: string; publisher: string | null; url: string | null; published_at: string | null; excerpt: string | null; source: ArtifactSource };
type FaradayRow = { artifact_id: string; title: string; publisher: string | null; url: string; published_at: string | null; excerpt: string | null };

async function sourceA(question: string): Promise<Artifact[]> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("tf_artifacts")
    .select("id,title,publisher,url,published_at,excerpt,source")
    .textSearch("search_vector", question, { type: "websearch", config: "english" })
    .limit(RETRIEVAL_LIMIT);
  if (error) throw error;
  return ((data ?? []) as TfRow[]).map((r) => ({
    id: r.id,
    title: r.title,
    publisher: r.publisher,
    url: r.url,
    published_at: r.published_at,
    excerpt: r.excerpt ?? "",
    source: r.source,
    origin: "tf_artifacts",
  }));
}

async function sourceB(question: string): Promise<Artifact[]> {
  const sb = getServiceClient();
  const { data, error } = await sb.rpc("tf_search_faraday_artifacts", { q: question, n: RETRIEVAL_LIMIT });
  if (error) throw error;
  return ((data ?? []) as FaradayRow[]).map((r) => ({
    id: r.artifact_id,
    title: r.title,
    publisher: r.publisher,
    url: r.url,
    published_at: r.published_at,
    excerpt: r.excerpt ?? "",
    source: tierForUrl(r.url),
    origin: "faraday",
  }));
}

export interface RetrievalResult {
  artifacts: Artifact[];
  /** Human-readable notes on anything that degraded (shown nowhere by default; logged). */
  notes: string[];
}

/** Up to 8 artifacts: Source A first (ThoughtForge's own), then the Faraday library. */
export async function retrieve(question: string): Promise<RetrievalResult> {
  const notes: string[] = [];
  if (!hasServiceEnv()) return { artifacts: [], notes: ["retrieval skipped: Supabase env not set"] };
  const results = await Promise.allSettled([sourceA(question), sourceB(question)]);
  const [a, b] = results;
  const fromA = a.status === "fulfilled" ? a.value : (notes.push(`source A unavailable: ${String((a as PromiseRejectedResult).reason?.message ?? a.reason)}`), []);
  const fromB = b.status === "fulfilled" ? b.value : (notes.push(`source B unavailable: ${String((b as PromiseRejectedResult).reason?.message ?? b.reason)}`), []);
  // Interleave so a strong Faraday hit is not pushed out by eight weak local rows.
  const merged: Artifact[] = [];
  const seen = new Set<string>();
  for (let i = 0; merged.length < RETRIEVAL_LIMIT && (i < fromA.length || i < fromB.length); i++) {
    for (const x of [fromA[i], fromB[i]]) {
      if (!x || merged.length >= RETRIEVAL_LIMIT) continue;
      const key = (x.url ?? x.id).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(x);
    }
  }
  return { artifacts: merged, notes };
}
