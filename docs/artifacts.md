# ThoughtForge artifacts

Two ways in, one table. Everything the panel can cite lives in, or is read through, the Supabase project of record `ycadmmngkdhvpcsrcuaq`. The decoy project `xgbpmlkanxewtfizloay` returns zero rows silently, so every code path that touches Supabase calls `assertProjectOfRecord()` (`src/lib/supabase.ts` for the app, `scripts/lib/supabase-guard.ts` for the CLIs) before building a client.

## The table: `tf_artifacts`

Created by `supabase/migrations/20261101_tf_artifacts.sql` (applied to the project of record on 2026-11-01). Columns: `id`, `title`, `publisher`, `url`, `published_at`, `body`, `excerpt` (generated: first 600 characters of the body), `source` (`primary` | `secondary` | `panel`), `idf_domains[]`, `tags[]`, `created_at`, `created_by`, and `search_vector` (generated tsvector over title and body, GIN-indexed). Row level security is on: `anon` may select, nobody but the service role may write. A partial unique index on `url` makes re-ingesting the same URL an update.

`source` decides what a panelist may write about the artifact:

| source | who | what the panel may tag it |
| --- | --- | --- |
| `primary` | a government, regulator, utility, ISO/RTO or standards body | `[VRF]` or `[SRC: <title>]` |
| `secondary` | anyone else | `[SRC: <title>]` |
| `panel` | ThoughtForge's own rulings | `[SRC: <title>]`, never `[VRF]` |

## Way in 1: add an artifact by file

Write a Markdown file with YAML front matter (`title`, optional `publisher`, `url`, `published_at` as YYYY-MM-DD, `source`, `idf_domains`, `tags`) and the artifact text as the body. The format and a fictional example live in `artifacts/inbox/README.md` and `artifacts/inbox/_example.md`; everything else in that folder is git-ignored.

```bash
npm run ingest:artifact -- artifacts/inbox/my-note.md     # one file
npm run ingest:artifact -- artifacts/inbox                # every .md in the folder
```

The CLI (`scripts/ingest-artifact.ts`) reads `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `.env.local` or the environment, runs the decoy guard, upserts on `url` when one is present and inserts otherwise, and prints one id per file. It never prints a key.

## Way in 2: every panel session becomes an artifact

When `/api/ask` finishes a session it writes two rows (`src/ask/save.ts`):

- `tf_sessions`: the full record (`id`, `asked_at`, `question`, `retrieved_artifact_ids`, `replies`, `factcheck`, `ruling`, `model_versions`). RLS on, no anon policy.
- `tf_artifacts`: one row with `source = 'panel'`, title `Panel ruling: <first 80 characters of the question>`, body = the ruling followed by the eight replies, `created_by = 'thoughtforge'`, tags `panel-ruling` and `session:<id>`.

Because panel rows are in `tf_artifacts`, retrieval Source A finds them, and a later panel can cite an earlier ruling as `[SRC: Panel ruling: …]`. The prompt's evidence-ladder contract keeps that at `[SRC]`; a ruling is never primary evidence. Saving is best-effort: if the Supabase env is missing or the insert fails, the session still streams to the user and the failure is logged server-side.

## Retrieval: what the panel sees

`retrieve(question)` in `src/retrieval/index.ts` returns up to eight artifacts as `{id, title, publisher, url, published_at, excerpt, source}`, interleaving two sources and de-duplicating on URL:

- **Source A, `tf_artifacts`.** Postgres full-text search: `search_vector @@ websearch_to_tsquery('english', question)`, limit 8, through the service-role client.
- **Source B, the Faraday library.** `public.artifacts` in the same project (667,561 rows on 2026-11-01, of which 176,099 carry a real URL). The table has no title or publisher column; both live in the `signal_envelope` jsonb (`title`, and `publisher` falling back to `source_name` then `source`), the URL is `source_url`, the date is `published_at`, the excerpt is the first 600 characters of `body_text`, then `raw_content`, then `signal_envelope->>'summary'`, and ranking uses the existing GIN-indexed `fts` tsvector with `ts_rank_cd`. Google News redirect rows and rows without a title are excluded. That query is wrapped in the SQL function `tf_search_faraday_artifacts(q, n)` so the app makes one RPC; the function is `security invoker` and executable by the service role only. Each Source B row is tiered by its URL's domain (`src/retrieval/primary.ts`): `.gov`, `.mil`, ISO/RTO, utility and standards-body hosts are `primary`, everything else `secondary`.

Retrieved artifacts go into every panelist prompt as a numbered "Retrieved artifacts" block (title, publisher, date, tier, 300-character excerpt). A panelist may only write `[SRC: <title>]` for a title in that block, and `[VRF]` only for a `primary` one. When nothing is retrieved the block says so and the panel tags accordingly.

Schema discovery for Source B is repeatable with `npm run inspect:artifacts` (`scripts/inspect-artifacts.ts`), which lists the columns of every `artifact*` table through `tf_inspect_artifact_columns()`.

## What a vector-search upgrade would change

The library already has `artifact_chunks` with an `embedding` column, so the upgrade is mostly on the ThoughtForge side: add an `embedding vector` column to `tf_artifacts` (filled at ingest and at session save by an embeddings call), add an embeddings call on the question at retrieval time, and replace the two full-text queries with a hybrid rank (cosine similarity on chunks or rows, fused with `ts_rank_cd` so exact tariff numbers and docket ids still win). The prompt block, the `[SRC]`/`[VRF]` rules and the two tables would not change; only `retrieve()` and the ingest path would. Not built in v1.
