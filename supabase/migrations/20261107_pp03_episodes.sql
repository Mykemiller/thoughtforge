-- UN-APPLIED — applied by Myke on merge
-- TH-37 / PP-03: tf_episodes, the single episode record for the Panel Podcast (script now; audio, video and publish later).
-- Project of record: ycadmmngkdhvpcsrcuaq. Never apply to xgbpmlkanxewtfizloay (decoy; returns zero rows silently).
-- Idempotent. Rollback: drop table if exists public.tf_episodes cascade; drop function if exists public.tf_episodes_touch();
--
-- Access: RLS on. Anonymous readers may SELECT only published episodes; every write (and every other read) is the
-- service role, which bypasses RLS. Writes are also revoked from anon and authenticated by name, so a future policy
-- mistake cannot open them.

create table if not exists public.tf_episodes (
  id uuid primary key default gen_random_uuid(),
  episode_id text unique not null,            -- PP-YYYYMMDD-NN
  show text,
  title text,
  digest_date date,
  status text not null default 'scripted'
    check (status in ('scripted', 'audio_ready', 'video_ready', 'approved', 'published', 'failed')),
  "cast" jsonb,                               -- [{slug, role: 'chair' | 'voice'}]
  signals jsonb,                              -- selected signals with ids, confidence, idf_domain, plus the ranking rationale
  script jsonb,                               -- {episode_id, show, title, segments[], pronunciation_terms[], word_count}
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

drop policy if exists tf_episodes_anon_read_published on public.tf_episodes;
create policy tf_episodes_anon_read_published on public.tf_episodes
  for select to anon
  using (status = 'published');

revoke insert, update, delete, truncate on public.tf_episodes from anon, authenticated;

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

drop trigger if exists tf_episodes_touch on public.tf_episodes;
create trigger tf_episodes_touch before update on public.tf_episodes
  for each row execute function public.tf_episodes_touch();
