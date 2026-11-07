-- TH-36 / PP-02: Faraday Daily Signal Digest ingest. Project of record: ycadmmngkdhvpcsrcuaq.
-- Never apply to xgbpmlkanxewtfizloay (decoy; returns zero rows silently).
-- Not applied by the PR: Myke applies it after review.
--
-- tf_signal_digests: one row per digest edition (digest_date is the edition date in the subject line).
--   TH-47 (20261105_th47_signal_inbound.sql) already creates it with this exact shape, so `if not exists` keeps
--   the two migrations order-independent.
-- tf_digest_signals: one row per signal block, replaced as a set whenever its digest is re-ingested.
-- Both tables: RLS on, no policies -> service role only.

create table if not exists public.tf_signal_digests (
  id uuid primary key default gen_random_uuid(),
  digest_date date unique not null,
  subject text,
  signal_count int,
  source_message_id text,
  raw_html text,
  raw_text text,
  ingested_at timestamptz default now()
);
alter table public.tf_signal_digests enable row level security;

create table if not exists public.tf_digest_signals (
  id uuid primary key default gen_random_uuid(),
  digest_id uuid not null references public.tf_signal_digests (id) on delete cascade,
  position int,
  title text not null,
  summary text,
  source_url text,
  publisher text,
  published_at timestamptz,
  idf_domain text,
  idf_subdomain text,
  jurisdiction text,
  confidence text,
  signal_type text,
  entities jsonb default '[]'::jsonb,
  raw jsonb,
  fts tsvector generated always as (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(summary, ''))) stored
);
alter table public.tf_digest_signals enable row level security;

-- digest_date already has the index behind its unique constraint; this one is explicit for the PP-03 range scans.
create index if not exists tf_signal_digests_digest_date on public.tf_signal_digests (digest_date);
create index if not exists tf_digest_signals_digest_position on public.tf_digest_signals (digest_id, position);
create index if not exists tf_digest_signals_fts_gin on public.tf_digest_signals using gin (fts);
create index if not exists tf_digest_signals_idf_domain on public.tf_digest_signals (idf_domain);
create index if not exists tf_digest_signals_confidence on public.tf_digest_signals (confidence);

-- No anon or authenticated policies on either table: only the service role (ingest CLI, server routes) reads or writes.
