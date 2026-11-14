-- TH-38 / PP-04: tf_episodes.failure_reason, the one-line reason walt-tf writes when it sets status 'failed'
-- (duration outside 9:00-15:30, a TTS failure after retries, an ffmpeg failure).
-- Additive and idempotent. Depends on public.tf_episodes (20261107_pp03_episodes.sql or 20261114204547_tf_episodes_compat.sql);
-- it raises a clear error instead of half-applying if the table is missing.
-- Project of record: ycadmmngkdhvpcsrcuaq. Never apply to xgbpmlkanxewtfizloay (decoy).
-- Gate: information_schema.columns has public.tf_episodes.failure_reason (text, nullable).
-- Rollback: alter table public.tf_episodes, remove column failure_reason (statement in docs/podcast/walt-tf.md#rollback).

do $$
begin
  if to_regclass('public.tf_episodes') is null then
    raise exception 'public.tf_episodes is missing: apply 20261114204547_tf_episodes_compat.sql first';
  end if;
end
$$;

alter table public.tf_episodes add column if not exists failure_reason text;

comment on column public.tf_episodes.failure_reason is
  'TH-38: one-line reason for status failed (walt-tf duration gate, TTS or mixdown failure). Cleared on success.';
