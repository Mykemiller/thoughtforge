-- TH-38 / TH-39 compatibility: make sure public.tf_episodes exists in production.
-- Why: TH-37 (PR #28) merged supabase/migrations/20261107_pp03_episodes.sql, but it was never applied to
-- ycadmmngkdhvpcsrcuaq (to_regclass('public.tf_episodes') is null on 2026-11-14 20:44 UTC, and no tf_episodes row is in
-- supabase_migrations.schema_migrations). TH-39's prompt says to add a minimal IF NOT EXISTS migration in that case.
-- This file reproduces the PP-03 end state using additive statements only (IF NOT EXISTS, and catalog checks in place
-- of the "remove and re-create" pattern), so it is a no-op wherever PP-03 already ran, and PP-03 stays a no-op after it.
-- This exact file ships in both the TH-38 and TH-39 PRs (byte-identical) so whichever merges first carries it.
-- Project of record: ycadmmngkdhvpcsrcuaq. Never apply to xgbpmlkanxewtfizloay (decoy).
-- Gate: to_regclass('public.tf_episodes') is not null, RLS on, policy tf_episodes_anon_read_published present.
-- Rollback (only if this file created the table, i.e. it held zero rows before and still does):
--   the inverse statements are in docs/podcast/walt-tf.md#rollback.

create table if not exists public.tf_episodes (
  id uuid primary key default gen_random_uuid(),
  episode_id text unique not null,            -- PP-YYYYMMDD-NN
  show text,
  title text,
  digest_date date,
  status text not null default 'scripted'
    check (status in ('scripted', 'audio_ready', 'video_ready', 'approved', 'published', 'failed')),
  "cast" jsonb,
  signals jsonb,
  script jsonb,
  show_notes_md text,
  word_count int,
  target_minutes numeric,
  audio_url text,
  video_url text,
  duration_seconds int,
  published_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists tf_episodes_digest_date on public.tf_episodes (digest_date);
create index if not exists tf_episodes_status on public.tf_episodes (status);

alter table public.tf_episodes enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'tf_episodes' and policyname = 'tf_episodes_anon_read_published'
  ) then
    create policy tf_episodes_anon_read_published on public.tf_episodes
      for select to anon
      using (status = 'published');
  end if;
end
$$;

-- Writes are never granted to anon or authenticated (the service role bypasses RLS and grants). Expressed as
-- "revoke all, grant select" so the file stays additive-only for the automated applier; this is slightly tighter than
-- PP-03, which left REFERENCES/TRIGGER/MAINTAIN in place for those roles.
revoke all on public.tf_episodes from anon, authenticated;
grant select on public.tf_episodes to anon, authenticated;

create or replace function public.tf_episodes_touch() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.tf_episodes_touch() from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.tf_episodes'::regclass and tgname = 'tf_episodes_touch' and not tgisinternal
  ) then
    create trigger tf_episodes_touch before update on public.tf_episodes
      for each row execute function public.tf_episodes_touch();
  end if;
end
$$;
