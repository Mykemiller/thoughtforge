# Panel email (TH-31, Week 1 of 3)

The ten panelists send plain-text email to Myke from their own addresses. Week 1 is outbound only: nothing here reads mail. Week 2 adds threading (the columns are already stored), Week 3 adds inbound. Decisions: TF-DEC-47 to TF-DEC-49.

## What goes out

| Kind | When | From | Subject |
| --- | --- | --- | --- |
| `briefing` | Weekdays, 07:00 Central | Today's chair (rotation below) | `Morning note from <first name>: <5 to 8 word hook>` |
| `cold-open` | Tuesday and Thursday, with the briefing | A seeded panelist for the ISO week | `<first name>: you should be looking at this` |
| `signal-takeaway` | When a Signal edition is posted to `/api/email/signal` | All ten, cast order, 2 s apart | Exactly `Re: <Signal subject>`, so all ten land in one thread |

Every email is plain text (no HTML, images or tracking), 120 to 220 words asked of the model, and ends with a two-line signature: `<Name>, <Role>` then `ThoughtForge panel, Faraday Intelligence`. Signal takeaways open with `My most important takeaway:` on its own line.

## Endpoints

- `GET /api/email/cron`: called by Vercel cron (`vercel.json`). Sends the chair's briefing; on Tue/Thu also the cold open; does nothing on weekends.
- `POST /api/email/signal`: body `{ "subject": string, "text": string, "edition_date"?: "YYYY-MM-DD" }`. One takeaway per panelist. `edition_date` defaults to today in US Central.

Both require `Authorization: Bearer <PANEL_CRON_SECRET>` (constant-time compare). With the secret unset they answer 503; with a wrong or missing bearer, 401. A run with any failed email answers 502 with per-email outcomes.

```bash
curl -X POST https://<deployment>/api/email/signal \
  -H "Authorization: Bearer $PANEL_CRON_SECRET" -H "Content-Type: application/json" \
  -d '{"subject":"Faraday Signal: ...","text":"..."}'
```

**Cron schedule.** `0 13 * * 1-5` is 13:00 UTC, which is 07:00 CST. During daylight time (CDT, March to November) Myke moves it to `0 12 * * 1-5` so the email still arrives at 07:00 Central.

**Cron auth.** Vercel attaches `Authorization: Bearer <CRON_SECRET>` to cron calls only when the project has a `CRON_SECRET` variable. Our guard compares against `PANEL_CRON_SECRET`, so set `CRON_SECRET` to the same value or the cron gets 401.

## Rotation

- Chair for a date = `EMAIL_ORDER[daysSince(2026-11-03) mod 10]`, by calendar day (weekends count), over: gilbert-faraday, margo-brandt, mach-eigen, delia-marchetti, albert-thorne, hartford-caldwell, rosalind-ferraro, victoria-stroud, ingrid-halverson, constance-wright. So 2026-11-03 is Gilbert, 2026-11-04 Margo, 2026-11-13 Gilbert again.
- Cold-open sender = mulberry32 seeded with `ISO year * 100 + ISO week`, so Tuesday and Thursday of one week share a sender.

## Idempotency and storage

`public.tf_email_messages` (migration `supabase/migrations/20261102_tf_email_messages.sql`, RLS on, service role only), unique on `(kind, send_date, panelist_slug)`. Per email: skip if a row exists, compose, insert the row (a unique conflict also skips), send, then store `resend_id` and `message_id`. A failed send deletes its row so the next run retries. Resend also gets an `Idempotency-Key` of `kind/send_date/slug`. Signal rows carry `thread_key = subject`. Every Supabase path asserts the project of record `ycadmmngkdhvpcsrcuaq` first and refuses the decoy.

`message_id` is the `Message-ID` header we set on each email (`<uuid@panel.faraday-thoughtforge.com>`): Resend's send API returns only its own id. Check one received email's headers on the first live send to confirm Resend kept it.

## Environment

All read through `src/email/env.ts`, which fails fast and names missing variables without printing values: `RESEND_API_KEY`, `PANEL_RECIPIENT_EMAIL`, `PANEL_REPLY_TO`, `PANEL_CRON_SECRET`, `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, plus `CRON_SECRET` (same value as `PANEL_CRON_SECRET`, for Vercel cron).

- `DRY_RUN=1`: compose, print the would-be email to stdout (To and Reply-To shown as variable names), and still insert rows with `resend_id = 'dry-run'`. `RESEND_API_KEY` is not needed. Delete those rows (`delete from tf_email_messages where resend_id = 'dry-run'`) before the first live run on the same day, or that day's live sends are skipped.
- `TF_MOCK=1`: canned compose with no model call, marked as a placeholder. Allowed only with `DRY_RUN=1`, so a canned email can never be sent.

## Local commands

```bash
npm run email:preview -- --kind briefing --slug delia-marchetti   # one email; never sends or stores
npm run email:preview -- --kind signal-takeaway --all             # all ten, on the fixture Signal
TF_MOCK=1 npm run email:preview -- --kind cold-open --all         # canned compose, no key needed
TF_MOCK=1 npm run email:dry-run -- --date 2026-11-03              # cron twice, in-memory store
TF_MOCK=1 npm run email:dry-run -- --signal --fast                # Signal twice, in-memory store
```

Without `ANTHROPIC_API_KEY` (and without `TF_MOCK=1`) the preview prints the From and subject format, says "NOT COMPOSED", and exits 2.

## Mail split (Fastmail and Resend)

- Root domain `faraday-thoughtforge.com`: mailbox on Fastmail, including `panel@faraday-thoughtforge.com`, the Reply-To. Week 1 replies land there and are read by hand.
- Subdomain `panel.faraday-thoughtforge.com`: sending only, through Resend. Nothing sends from the root domain.
- Both record sets live in Vercel DNS (the domain is registered on Vercel, TH-3). They do not conflict: Resend's records sit on the subdomain (and its `send.` and `resend._domainkey.` names), Fastmail's on the root.

## Content rules

The model writes as the panelist, first person, one idea, no lists, no "as an AI", never says the panelist is fictional, uses no numbers that are not in its context and labels estimates `(EST)`. Real people may appear only as public figures in public settings, never quoted, never given an opinion, never addressed (TF-DEC-45); no panelist is a real person (TF-DEC-13). A draft that breaks a checkable rule (forbidden phrase, a list) is retried once, then that email is skipped and reported.
