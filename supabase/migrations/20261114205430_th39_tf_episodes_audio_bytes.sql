-- TH-39 / PP-05: tf_episodes.audio_bytes, the size of audio.mp3 in bytes, for the RSS <enclosure length="...">.
-- The feed falls back to length="0" while it is null. walt-tf (TH-38) can fill it after upload (follow-up).
-- Additive and idempotent. Depends on public.tf_episodes (20261107_pp03_episodes.sql or 20261114204547_tf_episodes_compat.sql);
-- it raises a clear error instead of half-applying if the table is missing.
-- Project of record: ycadmmngkdhvpcsrcuaq. Never apply to xgbpmlkanxewtfizloay (decoy).
-- Gate: information_schema.columns has public.tf_episodes.audio_bytes (bigint, nullable).
-- Rollback: alter table public.tf_episodes, remove column audio_bytes (statement in docs/podcast/library.md#rollback).

do $$
begin
  if to_regclass('public.tf_episodes') is null then
    raise exception 'public.tf_episodes is missing: apply 20261114204547_tf_episodes_compat.sql first';
  end if;
end
$$;

alter table public.tf_episodes add column if not exists audio_bytes bigint check (audio_bytes is null or audio_bytes >= 0);

comment on column public.tf_episodes.audio_bytes is
  'TH-39: byte size of the episode MP3 at audio_url, for the RSS enclosure length. Null = unknown (feed writes 0).';
