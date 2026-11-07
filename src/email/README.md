# Panel email (TH-31 Week 1, TH-47 inbound and dialogue)

The ten panelists send plain-text email to Myke from their own addresses, and answer when he writes back. TH-31 built the outbound half (briefing, cold open, Signal takeaways). TH-47 added the inbound half: the Daily Signal Digest arrives by itself, the takeaways can go out as one roundtable email, every persona email replies to that panelist's own inbox, every email opens by saying what triggered it, and a reply from Myke gets an answer from the same panelist in the same thread. Decisions: TF-DEC-47 to TF-DEC-49, TF-DEC-80 to TF-DEC-83.

## The loop in one picture

```
Gmail (Myke)                 Resend inbound                    Vercel                           Fastmail (Myke)
signals@faraday-            signal@panel.faraday-            POST /api/email/inbound
intelligence.ai  --fwd-->   thoughtforge.com   --webhook-->  verify (Svix) + fetch message
                                                              classify: digest
                                                              store tf_signal_digests
                                                              runSignal (thread | roundtable) --Resend-->  ten takeaways in one thread
                                                                                                           (Reply-To: <panelist>@faraday-thoughtforge.com)
Myke replies to Margo  ----> margo@faraday-thoughtforge.com
                             (Fastmail rule) --fwd-->  reply@panel.faraday-thoughtforge.com
                                               --webhook-->  classify: reply (In-Reply-To matches tf_email_messages.message_id)
                                                              runReply: Margo alone, thread in context  --Resend-->  "Re: ..." in the same thread
```

## What goes out

| Kind | When | From | Subject |
| --- | --- | --- | --- |
| `briefing` | Weekdays, 07:00 Central | Today's chair (rotation below) | `Morning note from <first name>: <5 to 8 word hook>` |
| `cold-open` | Tuesday and Thursday, with the briefing | A seeded panelist for the ISO week | `<first name>: you should be looking at this` |
| `signal-takeaway` | When a Signal edition arrives (inbound) or is posted to `/api/email/signal` | **thread** mode: all ten, cast order, 2 s apart. **roundtable** mode: one email from the day's chair | thread: exactly `Re: <Signal subject>`. roundtable: `Panel roundtable: Re: <Signal subject>` |
| `reply` | When Myke writes back to a panelist | That panelist only (no ruling, no fact-check) | `Re: <the subject answered>` |

Every email is plain text (no HTML, images or tracking) and ends with a two-line signature: `<Name>, <Role>` then `ThoughtForge panel, Faraday Intelligence`. Briefings, cold opens and takeaways ask 120 to 220 words of the model; replies 80 to 200. Signal takeaways open with `My most important takeaway:` on its own line.

**The opener (TH-47).** Every persona email's first one or two sentences say why the panelist is writing: the Signal edition and the item they picked, the message of Myke's they are answering, or, for a briefing with no digest on file, that nothing new landed and what they chose to raise instead. It is a prompt rule (`OPENER_RULE` in `compose.ts`), not a template, so each panelist phrases it their own way. The register is conversational and uses the reader's first name once (`PANEL_RECIPIENT_NAME`, default Myke).

**Briefing context.** The weekday briefing is written with the latest raw digest in front of the chair when one landed in the last four days (`tf_signal_digests`); otherwise the chair says so.

**Roundtable mode (TF-DEC-82).** `PANEL_SIGNAL_MODE=roundtable`, or `"mode": "roundtable"` in the `/api/email/signal` body, sends one email from the chair for that date: a two-line opener in the chair's voice, then each panelist's takeaway in cast order under `— <Name>, <Role>`, then the chair's signature. It still writes ten `tf_email_messages` rows (one per panelist, same `message_id`) so threading is unaffected. Reply-To on the roundtable is `panel@` (the chair writes for the panel); a reply to it is answered by that day's chair.

## Endpoints

- `GET /api/email/cron`: called by Vercel cron (`vercel.json`). Sends the chair's briefing; on Tue/Thu also the cold open; does nothing on weekends.
- `POST /api/email/signal`: body `{ "subject": string, "text": string, "edition_date"?: "YYYY-MM-DD", "mode"?: "thread" | "roundtable" }`. One takeaway per panelist. `edition_date` defaults to today in US Central; `mode` to `PANEL_SIGNAL_MODE`.
- `POST /api/email/inbound` (TH-47): Resend's `email.received` webhook. Auth is the Svix signature against `RESEND_WEBHOOK_SECRET` (503 when unset, 401 on a bad signature or a timestamp older than five minutes). The webhook body is only trusted for the email id; the message itself is fetched from Resend (`emails.receiving.get`). Every handled, ignored or duplicate message answers 200 so Resend does not retry; 500 only on a real failure.

The first two require `Authorization: Bearer <PANEL_CRON_SECRET>` (constant-time compare). With the secret unset they answer 503; with a wrong or missing bearer, 401. A run with any failed email answers 502 with per-email outcomes.

### What inbound does with a message

| Mail | Test | Action |
| --- | --- | --- |
| Signal Digest | original sender `signals@faraday-intelligence.ai` (the From, or the inner `From:` line Gmail adds when forwarding) and subject, after `Fwd:`/`FW:`, starts with `Faraday Daily Signal Digest` | upsert `tf_signal_digests` on `digest_date` (parsed from `· YYYY-MM-DD` at the end of the subject, else today), then the ten takeaways |
| Gmail forwarding confirmation | From `forwarding-noreply@google.com` | stored with status `gmail-confirmation`; the body (with the confirmation link or code) is logged at info level for Myke |
| Reply to a panelist | `In-Reply-To`/`References` names a `tf_email_messages.message_id`, or the To address is a panelist's `first.last@panel…` or `firstname@faraday-thoughtforge.com`; From is on `PANEL_REPLY_ALLOWLIST` | that panelist answers (below) |
| Anything else | | one `tf_email_inbound` row with status `ignored` and the reason; no send |

Loop guards: mail from `@panel.faraday-thoughtforge.com` and auto-replies are ignored; at most `PANEL_REPLY_MAX_PER_THREAD_PER_DAY` (default 6) replies per thread per US Central day; a re-delivered webhook (same Resend email id) is a no-op.

### The reply

The panelist is the one on the thread's root email (the chair for a roundtable), else the one addressed. The thread is every outbound row and inbound row sharing the `thread_key` (the root's `thread_key`, or its `message_id` when the root was a single email, or the inbound Message-ID when Myke started the thread), oldest first, capped at the last 12 messages, with quoted history stripped from Myke's text. The reply goes out from the panelist's address with Reply-To their own inbox, subject `Re: <subject>`, and `In-Reply-To`/`References` set so Fastmail threads it. One `tf_email_messages` row with kind `reply`, `in_reply_to` = the inbound Message-ID; one `tf_email_inbound` row with status `accepted`, note `reply:<slug>`.

```bash
curl -X POST https://<deployment>/api/email/signal \
  -H "Authorization: Bearer $PANEL_CRON_SECRET" -H "Content-Type: application/json" \
  -d '{"subject":"Faraday Signal: ...","text":"..."}'
```

**Cron schedule.** `0 13 * * 1-5` is 13:00 UTC, which is 07:00 CST. During daylight time (CDT, March to November) Myke moves it to `0 12 * * 1-5` so the email still arrives at 07:00 Central.

**Cron auth.** Vercel attaches `Authorization: Bearer <CRON_SECRET>` to cron calls only when the project has a `CRON_SECRET` variable. Our guard compares against `PANEL_CRON_SECRET`, so set `CRON_SECRET` to the same value or the cron gets 401.

## Rotation

- Chair for a date = `EMAIL_ORDER[daysSince(2026-11-03) mod 10]`, by calendar day (weekends count), over: gilbert-faraday, margo-brandt, mach-eigen, delia-marchetti, albert-thorne, hartford-nakamura, rosalind-ferraro, victoria-stroud, ingrid-halverson, constance-wright. So 2026-11-03 is Gilbert, 2026-11-04 Margo, 2026-11-13 Gilbert again.
- Cold-open sender = mulberry32 seeded with `ISO year * 100 + ISO week`, so Tuesday and Thursday of one week share a sender.

## Idempotency and storage

`public.tf_email_messages` (migration `supabase/migrations/20261102_tf_email_messages.sql`, RLS on, service role only), unique on `(kind, send_date, panelist_slug)` for every kind but `reply` (TH-47 migration `20261105_th47_signal_inbound.sql` turns the constraint into a partial unique index; a panelist may answer several times a day, and replies are idempotent on the inbound email id instead).

TH-47 adds `public.tf_signal_digests` (one raw edition per `digest_date`, the shape TH-36 specifies so the podcast parser can add `tf_digest_signals` later; raw digests are kept, not parsed, here) and `public.tf_email_inbound` (every received email: `resend_email_id` unique, status, note, `message_id`, `in_reply_to`, `thread_key`, the new text of a reply). Both RLS on, no policies. Per email: skip if a row exists, compose, insert the row (a unique conflict also skips), send, then store `resend_id` and `message_id`. A failed send deletes its row so the next run retries. Resend also gets an `Idempotency-Key` of `kind/send_date/slug`. Signal rows carry `thread_key = subject`. Every Supabase path asserts the project of record `ycadmmngkdhvpcsrcuaq` first and refuses the decoy.

`message_id` is the `Message-ID` header we set on each email (`<uuid@panel.faraday-thoughtforge.com>`): Resend's send API returns only its own id. Check one received email's headers on the first live send to confirm Resend kept it.

## Environment

All read through `src/email/env.ts`, which fails fast and names missing variables without printing values: `RESEND_API_KEY`, `PANEL_RECIPIENT_EMAIL`, `PANEL_REPLY_TO`, `PANEL_CRON_SECRET`, `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, plus `CRON_SECRET` (same value as `PANEL_CRON_SECRET`, for Vercel cron).

TH-47 (all optional except the first for inbound): `RESEND_WEBHOOK_SECRET` (Svix signing secret from the Resend webhook page; inbound answers 503 without it), `PANEL_SIGNAL_MODE` (`thread`, default, or `roundtable`), `PANEL_RECIPIENT_NAME` (default `Myke`), `PANEL_REPLY_ALLOWLIST` (comma-separated; default `PANEL_RECIPIENT_EMAIL`), `PANEL_REPLY_MAX_PER_THREAD_PER_DAY` (default 6). Sensitive values go in through the Vercel CLI, never chat: `vercel env add RESEND_WEBHOOK_SECRET production --sensitive` and again for `preview`.

- `DRY_RUN=1`: compose, print the would-be email to stdout (To and Reply-To shown as variable names), and still insert rows with `resend_id = 'dry-run'`. `RESEND_API_KEY` is not needed. Delete those rows (`delete from tf_email_messages where resend_id = 'dry-run'`) before the first live run on the same day, or that day's live sends are skipped.
- `TF_MOCK=1`: canned compose with no model call, marked as a placeholder. Allowed only with `DRY_RUN=1`, so a canned email can never be sent.

## Local commands

```bash
npm run email:preview -- --kind briefing --slug delia-marchetti   # one email; never sends or stores
npm run email:preview -- --kind signal-takeaway --all             # all ten, on the fixture Signal
npm run email:preview -- --kind signal-takeaway --mode roundtable --file fixtures/digests/sample.txt   # one roundtable email
npm run email:preview -- --kind briefing --slug mach-eigen --file fixtures/digests/sample.txt          # briefing with a digest in front of the chair
npm run email:preview -- --kind reply --slug margo-brandt --file fixtures/replies/sample.txt            # a reply to the fixture message
TF_MOCK=1 npm run email:preview -- --kind cold-open --all         # canned compose, no key needed
TF_MOCK=1 npm run email:dry-run -- --date 2026-11-03              # cron twice, in-memory store
TF_MOCK=1 npm run email:dry-run -- --signal --fast                # Signal twice, in-memory store
```

Without `ANTHROPIC_API_KEY` (and without `TF_MOCK=1`) the preview prints the From and subject format, says "NOT COMPOSED", and exits 2.

## Mail split (Fastmail and Resend)

- Root domain `faraday-thoughtforge.com`: Fastmail. One full user per panelist, `firstname@` (gilbert, margo, mach, delia, albert, hartford, rosalind, victoria, ingrid, constance), each the Reply-To on that panelist's emails (TF-DEC-83), plus `panel@`, the Reply-To on the roundtable email only.
- Subdomain `panel.faraday-thoughtforge.com`: Resend, sending **and** (TH-47) receiving. Sends come from `first.last@panel…`; inbound lands on any address at the subdomain (`signal@` for the digest forward, `reply@` for the Fastmail rules).
- Both record sets live in Vercel DNS (the domain is registered on Vercel, TH-3). Resend's records sit on the subdomain (`send.`, `resend._domainkey.`, and with receiving on, an MX), Fastmail's on the root.

### Setup that is Myke's, not code

1. **Resend, receiving.** On `panel.faraday-thoughtforge.com` turn on *Enable receiving* and add the MX record Resend shows to Vercel DNS (type MX, name `panel`, the value and priority Resend gives).
2. **Resend, webhook.** Add a webhook for `email.received` pointing at `https://www.faraday-thoughtforge.com/api/email/inbound`; copy its signing secret (`whsec_…`) into Vercel as `RESEND_WEBHOOK_SECRET` (production and preview, sensitive, via the CLI).
3. **Gmail, the digest.** Settings → Forwarding: add `signal@panel.faraday-thoughtforge.com`. Gmail's confirmation email comes through the inbound route; its body (link and code) is in the Vercel function logs for `/api/email/inbound`. Then a filter `from:signals@faraday-intelligence.ai` → forward to that address.
4. **Fastmail, the replies.** On each `firstname@faraday-thoughtforge.com` user add a rule: forward every incoming message to `reply@panel.faraday-thoughtforge.com` (keep a copy). Replying to a panelist's email from any client then reaches the route. (Replying to the From address, `first.last@panel…`, also works with no rule, because the To address names the panelist.)
5. **Apply the migration** `supabase/migrations/20261105_th47_signal_inbound.sql` to the project of record, then merge.

## Content rules

The model writes as the panelist, first person, one idea, no lists, no "as an AI", never says the panelist is fictional, uses no numbers that are not in its context and labels estimates `(EST)`. Real people may appear only as public figures in public settings, never quoted, never given an opinion, never addressed (TF-DEC-45); no panelist is a real person (TF-DEC-13). A draft that breaks a checkable rule (forbidden phrase, a list) is retried once, then that email is skipped and reported.
