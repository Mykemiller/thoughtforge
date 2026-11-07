-- TH-66: the panel day. Project of record: ycadmmngkdhvpcsrcuaq.
-- Never apply to xgbpmlkanxewtfizloay (decoy; returns zero rows silently).
-- Not applied by the PR: Myke applies it through the connector after the decoy guard.
-- Apply BEFORE merging: the new cron path reads tf_email_day_plans and writes tf_email_messages.slot.

-- 1. One row per panel day. plan is the PanelDay JSON (slots, panelists, times, Message-IDs, statuses).
--    status: planning (being composed or sent), scheduled (every slot is with Resend; a re-run does nothing),
--    partial (some slot failed; the next run resumes it).
create table if not exists public.tf_email_day_plans (
  id uuid primary key default gen_random_uuid(),
  send_date date unique not null,
  plan jsonb not null,
  status text not null check (status in ('planning', 'scheduled', 'partial')),
  created_at timestamptz default now()
);
-- Service role only: RLS on, no policies (same as tf_email_messages).
alter table public.tf_email_day_plans enable row level security;

-- 2. tf_email_messages: the day's slot, and the new kinds.
alter table public.tf_email_messages add column if not exists slot text;

alter table public.tf_email_messages drop constraint if exists tf_email_messages_kind_check;
alter table public.tf_email_messages
  add constraint tf_email_messages_kind_check
  check (kind in ('briefing', 'cold-open', 'signal-takeaway', 'roundtable-opener', 'reply',
                  'thread-reply', 'aside', 'news-take', 'weekend-note'));

alter table public.tf_email_messages drop constraint if exists tf_email_messages_slot_check;
alter table public.tf_email_messages
  add constraint tf_email_messages_slot_check
  check (slot is null or slot in ('morning-note', 'cold-open', 'thread-reply', 'aside', 'signal-or-news', 'weekend-note'));

-- 3. The unique key becomes (kind, send_date, panelist_slug, slot). Replies stay outside it (TF-DEC-101:
--    replies are idempotent on the inbound email). coalesce keeps rows with no slot (Signal takeaways,
--    pre-TH-66 briefings) unique on the old three columns, since NULLs are otherwise distinct.
drop index if exists public.tf_email_messages_once_per_day;
create unique index if not exists tf_email_messages_once_per_slot
  on public.tf_email_messages (kind, send_date, panelist_slug, coalesce(slot, ''))
  where kind <> 'reply';
