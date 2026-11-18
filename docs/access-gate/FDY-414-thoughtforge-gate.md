# FDY-414 (ADM-1.7) — Faraday beta access gate in ThoughtForge

ThoughtForge now carries the shared Faraday beta gate as an **additional** layer on top of the existing
magic-word wall. Access key: **`thoughtforge`**. App name on the gate page: **ThoughtForge Panel**.

## Nothing changes on merge
`estate_entitled(p_email, 'thoughtforge')` is seeded in mode **`open`**. In open mode the gate passes through
without looking up any identity, so every page renders exactly as before.

Until the estate migration is applied, `estate_entitled` does not exist and the mode probe returns reason
`error`. **That passes through** (ThoughtForge stays open) unless `FARADAY_GATE_ENFORCE=1`, in which case it
fails closed and shows "ThoughtForge Panel is unavailable right now". Missing or wrong Supabase config is
treated the same way. Once the probe succeeds, every later failure (for example the per-email check timing
out) fails closed, as the package intends. A probe answer of `unknown_app` is a real database answer, not a
probe error, so it closes the gate even without the flag.

## What is gated
| Surface | How |
|---|---|
| `/ask` | `app/ask/layout.tsx` → `FaradayGateBoundary behindMagicWord` |
| `/interview`, `/interview/[slug]` | `app/interview/layout.tsx` → `FaradayGateBoundary behindMagicWord` |
| `/podcast`, `/podcast/[episode_id]` (Panel Podcast) | `app/podcast/layout.tsx` → `FaradayGateBoundary` |
| `POST /api/ask`, `POST /api/interview`, `GET`/`POST /api/interview/voice` | `tfGateApiDenial(req)` at the top of each handler: 403 JSON when denied, no-op otherwise |

**Not gated:** the landing page `/`, `/panel` and `/panel/[slug]` (the panelists are public), `/sitemap.xml`,
static assets, `/api/health`, `/api/panel` (Live Agent bridge, has its own bearer token), `/api/email/*`, and
`/podcast/feed.xml` (a route handler: layouts do not wrap it, and podcast apps cannot sign in). ThoughtForge has
no legal pages of its own; the gate page links to the Faraday master Terms and Privacy on
`www.faraday-intelligence.ai`.

## Order of the two walls
1. **Magic-word wall, unchanged** (`proxy.ts` + `src/lib/access.ts`: `TF_ACCESS_KEY`, cookie `tf_access`).
   It still runs first on `/ask`, `/interview`, `/api/ask`, `/api/interview`, `/api/health`.
2. **Faraday gate.** When the wall has locked a request (`x-tf-locked: 1`), the page renders its own
   magic-word form and the gate steps aside; once the wall is passed, the gate applies. The header is only
   honoured on the two wall surfaces, where it can only ever produce the locked form, so spoofing it gains
   nothing. `/podcast` ignores it.

Verified locally against `next start`: with `FARADAY_GATE_ENFORCE=1` and no Supabase env, `/ask`, `/interview`,
`/interview/<slug>` and `/podcast` show the gate, `/`, `/panel` and `/podcast/feed.xml` do not, and `/api/ask`
answers 403; with `TF_ACCESS_KEY` set, a locked `/ask` still shows the magic-word form; without the flag every
surface renders normally.

## Identity
ThoughtForge has no email sign-in, so the only identity source is the **gate's own Supabase Auth email
one-time code**: the user types their email on the gate page, receives a code, types it in, and the gate sets
the httpOnly cookie **`fgate_at`** (one hour). It is separate from `tf_access`; neither cookie affects the
other. Endpoints: `POST /api/faraday-gate/{code,verify,request,signout}` (`app/api/faraday-gate/[action]/route.ts`,
same-origin only, not behind the magic word so the gate on `/podcast` can reach it).

## Env
| Name | Status | Used for |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | existing | project URL; must name `ycadmmngkdhvpcsrcuaq` (the decoy `xgbpmlkanxewtfizloay` is refused) |
| `SUPABASE_SERVICE_ROLE_KEY` | existing | `estate_entitled`, `estate_access_request`, verifying the gate cookie (server only) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | existing | sending and verifying the email one-time code |
| `FARADAY_GATE_ENFORCE` | **new, optional** | `"1"` = fail closed when the mode probe errors. Leave unset until the estate migration is live. |

## Files
- `lib/faraday-gate/` — vendored byte-identical from `Mykemiller/faraday-workbench/packages/faraday-gate/`
  (VERSION 1.0.0). **Never edit.** `MANIFEST.sha256` pins every file; `src/lib/faradayGateVendor.test.ts` fails
  on drift (and compares against the canonical package when `../faraday-workbench` is checked out). ESLint
  ignores this directory; TypeScript still checks it (`allowImportingTsExtensions` added to `tsconfig.json`,
  safe because `noEmit` is already true).
- `src/lib/faradayGate.ts` — the ThoughtForge wrapper (config, enforce flag, decision, API helper).
- `src/components/gate/FaradayGateBoundary.tsx` — the server boundary the three layouts use.
- Tests: `src/lib/faradayGate.test.ts` (wrapper logic), `src/lib/faradayGateVendor.test.ts` (manifest identity,
  GatePage render under React 19).

## Myke checks (one-time)
- **Supabase Auth email template contains `{{ .Token }}`** (Authentication → Email Templates: **Magic Link**, and **Confirm signup**, which a first-time address receives because the gate sends codes with `create_user: true`).
  Without it the email carries only a link and the typed-code sign-in cannot work.
- Gate copy `lib/faraday-gate/gate-copy/thoughtforge.json` is `status: "draft"`, so the gate shows neutral text.
  Approving it is a change to the canonical package, then a re-vendor.
- Decide whether the public RSS feed (`/podcast/feed.xml`) should stay open when the gate moves to invite mode.

## Known limits
- Before the migration lands, every request to a gated surface makes one `estate_entitled` call that 404s (error
  answers are never cached by the package). It is fast, but it is per request.
- The package's neutral draft text reads "Request demo access, or join the waitlist" even in waitlist view, where
  no demo button is shown. That is canonical copy, not changed here.
