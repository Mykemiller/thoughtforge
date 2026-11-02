-- ThoughtForge artifact path (TH-32 §5). Project of record: ycadmmngkdhvpcsrcuaq.
-- tf_artifacts: ThoughtForge's own artifacts (files ingested by hand plus every panel ruling).
-- tf_sessions:  the full record of every /ask session.
-- tf_search_faraday_artifacts(): retrieval Source B over the Faraday library (public.artifacts).

create table if not exists public.tf_artifacts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  publisher text,
  url text,
  published_at date,
  body text not null,
  excerpt text generated always as (left(body, 600)) stored,
  source text not null check (source in ('primary', 'secondary', 'panel')),
  idf_domains text[] default '{}',
  tags text[] default '{}',
  created_at timestamptz default now(),
  created_by text,
  search_vector tsvector generated always as (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, ''))) stored
);

create index if not exists tf_artifacts_search_vector_gin on public.tf_artifacts using gin (search_vector);
-- Upsert key for the ingest CLI: one row per URL when a URL is present.
create unique index if not exists tf_artifacts_url_key on public.tf_artifacts (url) where url is not null;

alter table public.tf_artifacts enable row level security;
drop policy if exists tf_artifacts_anon_select on public.tf_artifacts;
create policy tf_artifacts_anon_select on public.tf_artifacts for select to anon using (true);
-- No insert/update/delete policy: only the service role writes.

create table if not exists public.tf_sessions (
  id uuid primary key,
  asked_at timestamptz,
  question text,
  retrieved_artifact_ids uuid[],
  replies jsonb,
  factcheck jsonb,
  ruling text,
  model_versions jsonb
);

alter table public.tf_sessions enable row level security;
-- No anon policy at all: service role only.

-- Source B: the Faraday artifact library. Title and publisher live in signal_envelope (jsonb);
-- `fts` is the existing tsvector (GIN-indexed as artifacts_fts_gin). Only rows with a real URL
-- (not a Google News redirect) and a title are returned, ranked by ts_rank_cd.
create or replace function public.tf_search_faraday_artifacts(q text, n int default 8)
returns table (
  artifact_id uuid,
  title text,
  publisher text,
  url text,
  published_at date,
  excerpt text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    a.artifact_id,
    a.signal_envelope->>'title' as title,
    coalesce(a.signal_envelope->>'publisher', a.signal_envelope->>'source_name', a.signal_envelope->>'source') as publisher,
    a.source_url as url,
    a.published_at::date as published_at,
    left(coalesce(a.body_text, a.raw_content, a.signal_envelope->>'summary'), 600) as excerpt
  from public.artifacts a
  where a.fts @@ websearch_to_tsquery('english', q)
    and a.source_url like 'http%'
    and a.source_url not like '%news.google.com%'
    and a.signal_envelope->>'title' is not null
  order by ts_rank_cd(a.fts, websearch_to_tsquery('english', q)) desc, a.published_at desc nulls last
  limit greatest(1, least(n, 50));
$$;

revoke all on function public.tf_search_faraday_artifacts(text, int) from public, anon;
grant execute on function public.tf_search_faraday_artifacts(text, int) to service_role;
