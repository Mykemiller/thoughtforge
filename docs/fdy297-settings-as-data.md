# FDY-297 (ADM-2.4) — panel email settings as data

PANEL_SIGNAL_MODE and the reply caps are read from the Faraday config store (`v_effective_config`, app `TF`)
through `src/config/resolver.ts` (the FDY-295 reference contract: 60 s cache, 4 s timeout, fail closed, service
key server-only) and overlaid on the validated env by `src/email/settings.ts`. The overlay runs in the cron and
signal handlers after the bearer check, and in the inbound handler after the Svix signature check.

| Env var (fallback) | Setting key | Type / range | Status | Read in |
|---|---|---|---|---|
| `PANEL_SIGNAL_MODE` (code default `thread`) | `panel_signal_mode` | enum `thread` \| `roundtable` | enforced | `src/email/env.ts` → `http.ts` (`buildRunDeps`, `buildInboundDeps`) |
| `PANEL_REPLY_MAX_PER_THREAD_PER_DAY` (code default `6`) | `panel_reply_max_per_thread_per_day` | integer 1–100 | enforced | `src/email/env.ts` → `reply.ts` via `buildInboundDeps` |
| `PANEL_MAX_DAILY` (code default `5`) | `panel_max_daily` | integer 1–10 | enforced | `src/email/env.ts` → `day-run.ts` via `buildDayDeps` |

Rule: a console value wins. The env value stays when the read fails, the key is unknown, the value is out of range
or not an allowed mode, or nobody has set a value. `npm run email:preview` still reads `PANEL_MAX_DAILY` from env
directly (a local tool, not a deployed path).

Secrets stay in env and are never settings: `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `PANEL_CRON_SECRET`,
`CRON_SECRET`, `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `LINEAR_API_KEY`.

Tests: `src/config/resolver.test.ts`, `src/email/settings.test.ts`.
