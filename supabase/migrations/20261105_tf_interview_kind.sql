-- TH-49: 1:1 interview sessions (TF-DEC-84, TF-DEC-87). Project of record: ycadmmngkdhvpcsrcuaq.
-- Additive only. Existing rows keep kind = 'panel'; an interview row carries the panelist slug
-- and the full transcript. tf_artifacts is unchanged: an interview is saved with source = 'panel'
-- and tags ['interview', 'panelist:<slug>', 'session:<id>'] so retrieval and the UI need no new case.

alter table public.tf_sessions
  add column if not exists kind text not null default 'panel',
  add column if not exists panelist text,
  add column if not exists transcript jsonb,
  add column if not exists updated_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tf_sessions_kind_check') then
    alter table public.tf_sessions add constraint tf_sessions_kind_check check (kind in ('panel', 'interview'));
  end if;
end $$;

create index if not exists tf_sessions_kind_panelist on public.tf_sessions (kind, panelist);
-- Interview artifacts are found by their session tag when a later turn updates them.
create index if not exists tf_artifacts_tags_gin on public.tf_artifacts using gin (tags);
