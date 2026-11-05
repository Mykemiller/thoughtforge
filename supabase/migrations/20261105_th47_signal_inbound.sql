-- TH-47: Daily Signal inbound feed, roundtable mode, reply loop. Project of record: ycadmmngkdhvpcsrcuaq.
-- Never apply to xgbpmlkanxewtfizloay (decoy; returns zero rows silently).
-- Not applied by the PR: Myke applies it after review (same as TH-31).

-- 1. Raw digests, the shape TH-36 specifies, so the podcast parser later adds tf_digest_signals without conflict.
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

-- 2. Every received email, one row, whatever happened to it. resend_email_id is the webhook idempotency key.
create table if not exists public.tf_email_inbound (
  id uuid primary key default gen_random_uuid(),
  resend_email_id text unique,
  from_address text,
  subject text,
  status text not null check (status in ('accepted', 'ignored', 'gmail-confirmation', 'error')),
  note text,
  message_id text,
  in_reply_to text,
  thread_key text,
  raw_text text,
  received_at timestamptz default now()
);
alter table public.tf_email_inbound enable row level security;
create index if not exists tf_email_inbound_thread on public.tf_email_inbound (thread_key, received_at);

-- 3. tf_email_messages: two new kinds, and the unique key no longer covers replies
--    (a panelist may answer several times a day; replies are idempotent on the inbound email instead).
alter table public.tf_email_messages drop constraint if exists tf_email_messages_kind_check;
alter table public.tf_email_messages
  add constraint tf_email_messages_kind_check
  check (kind in ('briefing', 'cold-open', 'signal-takeaway', 'roundtable-opener', 'reply'));

alter table public.tf_email_messages drop constraint if exists tf_email_messages_kind_send_date_panelist_slug_key;
create unique index if not exists tf_email_messages_once_per_day
  on public.tf_email_messages (kind, send_date, panelist_slug)
  where kind <> 'reply';
create index if not exists tf_email_messages_message_id on public.tf_email_messages (message_id);
create index if not exists tf_email_messages_thread on public.tf_email_messages (thread_key, created_at);
