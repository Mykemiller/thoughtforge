-- ThoughtForge panel email, Week 1 (TH-31). Project of record: ycadmmngkdhvpcsrcuaq.
-- Never apply to xgbpmlkanxewtfizloay (decoy; returns zero rows silently).
-- Not applied by the PR: Myke applies it after review.
--
-- tf_email_messages: one row per outbound panel email. The unique key is the
-- idempotency guard for the cron and the Signal endpoint. message_id,
-- in_reply_to and thread_key are Week 2 threading groundwork; nothing reads
-- them yet. resend_id = 'dry-run' marks rows written with DRY_RUN=1.

create table if not exists public.tf_email_messages (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('briefing', 'cold-open', 'signal-takeaway')),
  send_date date not null,
  panelist_slug text not null,
  subject text not null,
  resend_id text,
  message_id text,
  in_reply_to text,
  thread_key text,
  body text not null,
  created_at timestamptz default now(),
  unique (kind, send_date, panelist_slug)
);

-- Service role only: RLS on, no policies.
alter table public.tf_email_messages enable row level security;
