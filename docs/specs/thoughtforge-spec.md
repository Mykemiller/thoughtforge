# ThoughtForge Product Spec v1.0

**Status:** Spec of record, proposed in TH-2 (Phase 1). Awaiting Myke's review (TF-DEC-19).
**Written:** 2026-11-07, US Central. **Replaces:** the Linear draft "ThoughtForge Product Spec v0.1 (TH-2)", saved verbatim in `docs/specs/thoughtforge-spec-v0.1-snapshot.md`.
**Home:** this file is canonical; the repo is the source of record (TF-DEC-40). Linear keeps the v0.1 draft as history.

How to read this document. Every statement cites a file, a table or a decision id. Anything that could not be checked in code or in a decision record is listed under §12, Open questions, and is not asserted here. "As built" means the `main` branch at commit `5acc3a6`.

---

## 1. Purpose

ThoughtForge is a panel of ten fictional AI advisors who argue a datacenter question in the open and hand back one decision-ready ruling (`README.md`; TF-DEC-13, TF-DEC-31). Every factual claim carries an evidence tag, the Fact-Checker grades the claims, and the Chief of Staff rules last, records any dissent and says what would change his mind (`src/ask/orchestrate.ts`).

## 2. Scope

**In scope, as built:**

| Capability | Routes or command | Evidence |
| --- | --- | --- |
| Meet the Panel | `/panel`, `/panel/<slug>` (public) | `app/panel/`, `src/cast/bio.ts`, `src/cast/params.ts` |
| Ask the Panel | `/ask`, `POST /api/ask` (gated, streamed) | `app/ask/page.tsx`, `app/api/ask/route.ts` |
| 1:1 interviews | `/interview`, `/interview/<slug>`, `POST /api/interview`, `/api/interview/voice` (gated) | `app/interview/`, `src/interview/`, TF-DEC-84 |
| Voice playback for interviews | ElevenLabs text-to-speech | `src/voice/`, `docs/voice-avatar-pipeline.md` |
| Artifact path | `npm run ingest:artifact`, table `tf_artifacts` | `scripts/ingest-artifact.ts`, `docs/artifacts.md` |
| Panel email (outbound only) | `GET /api/email/cron`, `POST /api/email/signal`, `/api/email/inbound` | `src/email/README.md`, `vercel.json` |

**Out of scope for v1.0:** a live web or industry lookup tier inside a panel session (see §4.3 and the drift table), public sign-up, pricing or metering, and any change to the IDF taxonomy or Lexicon.

## 3. Architecture and request flow, as built

**Stack.** Next.js App Router on Vercel project `thoughtforge` (team `project-foundry`), the Anthropic SDK as the engine, and Supabase Postgres project `ycadmmngkdhvpcsrcuaq` (`README.md`, `package.json`, `src/lib/supabase.ts`). Panelist prompts are composed from files in the repo's `cast/` folder, not from Notion (`src/cast/loader.ts`, `src/cast/prompt.ts`; TF-DEC-40).

**Request flow for one question** (`app/api/ask/route.ts`, `src/ask/orchestrate.ts`, turn order TF-DEC-08):

1. The gate in `proxy.ts` checks the `tf_access` cookie (§8). `/api/ask` answers 401 without it.
2. The route validates the body: a question of at most 1,200 characters (`LIMITS.questionMaxChars` in `src/ask/roster.ts`). One session runs at a time per access key (`src/ask/inflight.ts`); a second gets 429.
3. If `TF_MOCK=1`, a canned session streams through the real route and UI (`src/ask/mock.ts`, `src/cast/__fixtures__/mock-session.json`). If `ANTHROPIC_API_KEY` is missing, the stream reports an error and stops.
4. Retrieval runs unless the request sets `retrieval: false` (§4). Building the Supabase client first calls `assertProjectOfRecord`, which fails closed on the decoy project or any other URL (`src/lib/supabase.ts`).
5. **Stage 1.** Eight domain panelists answer in parallel on `claude-sonnet-5-5` with 600 output tokens each. Their text streams to the browser as server-sent events (`src/ask/sse.ts`).
6. **Stage 2.** Constance Wright, the Fact-Checker, grades all eight replies on `claude-sonnet-5-5` (400 tokens) and returns JSON: one verdict per panelist plus every claim she downgrades (`src/ask/factcheck.ts`).
7. **Stage 3.** Gilbert Faraday, the Chief of Staff, rules last on `claude-opus-5-5` (1,000 tokens) with all nine outputs in context. The ruling ends with two fixed lines: "Dissent on the record" and "What would change my mind" (`RULING_TURN` in `src/ask/orchestrate.ts`).
8. The finished session is saved to `tf_sessions` and as a `source = 'panel'` row in `tf_artifacts`, so later panels can cite earlier rulings (`src/ask/save.ts`).

Every stage degrades rather than failing the whole session. A panelist error or refusal becomes an inline note tagged `[INF]`. A Fact-Checker failure becomes "Fact-check unavailable" verdicts. A ruling failure becomes an error event (`src/ask/orchestrate.ts`).

**Sampling.** The Claude 5 models reject `temperature`, so the code uses thinking and effort settings instead: medium effort for panelists, high for the grader and low for the ruling (`src/ask/roster.ts`; `docs/decisions-th32.md`, 2026-11-01 21:09 CT).

**Prompt composition** (`src/cast/prompt.ts`). The order is fixed: identity and IDF domains, voice brief and sample line, Backstory and Life outside work from the dossier, the panelist's own three skills, the three shared skills (`evidence-ladder`, `faraday-retrieval`, `gdelt-research`), and the evidence-ladder contract. The retrieved-artifacts block and the turn instructions come last. Each fixed core must stay under 6,000 tokens, which `src/cast/prompt.test.ts` asserts.

**Secrets.** Code reads keys from `process.env` only, and `.env.local` is never committed. Variable names are listed in `README.md` and `.env.example`.

## 4. Retrieval

### 4.1 Tables and functions

| Object | Role | Evidence |
| --- | --- | --- |
| `tf_artifacts` | Source A: ThoughtForge's own artifacts, including prior panel rulings. Full-text search over `search_vector` | `src/retrieval/index.ts`, `supabase/migrations/20261101_tf_artifacts.sql` |
| `public.artifacts` | Source B: the Faraday library, read only through `tf_search_faraday_artifacts(q, n)` | same migration; TF-DEC-03 |
| `tf_sessions` | Saved panel and interview sessions (`kind` is `panel` or `interview`) | `20261101_tf_artifacts.sql`, `20261105_tf_interview_kind.sql` |
| `tf_email_messages`, `tf_signal_digests`, `tf_email_inbound`, `tf_email_day_plans` | Panel email state | `20261102_*`, `20261105_th47_*`, `20261106_th66_day_plans.sql` |

Retrieval returns up to eight artifacts (`RETRIEVAL_LIMIT`). Sources A and B are interleaved and de-duplicated by URL, so a strong Faraday hit is not pushed out by weak local rows. Any failure, such as missing environment variables, an unapplied migration or a schema mismatch, returns fewer artifacts and never throws (`src/retrieval/index.ts`).

Each artifact is tiered by publisher domain. A `.gov` domain, a regulator, an ISO or RTO, a utility or a standards body (including `opencompute.org`) is `primary`. Everything else is `secondary`, and prior panel rulings are `panel` (`src/retrieval/primary.ts`).

**Read-only counts, measured 2026-11-07 04:15 CST** in `ycadmmngkdhvpcsrcuaq` with `select` only. `dc_facilities` has 18,217 rows (floor 18,000) and `artifacts` has 688,824 rows (floor 100,000), so the guard passes. The `tf_*` tables present are `tf_artifacts`, `tf_email_inbound`, `tf_email_messages`, `tf_sessions` and `tf_signal_digests`. The function `tf_search_faraday_artifacts` exists. `tf_email_day_plans` is **not** present (§12, Q6).

### 4.2 Read and write policy

- **Faraday library: read-only.** The app reads `public.artifacts` only through the search function and never writes it (`src/retrieval/index.ts`). The one designed write-back, GDELT rows tagged `gdelt:research`, is off until `CAST_GDELT_WRITEBACK=true` (`cast/_shared/skills/gdelt-research/SKILL.md`, rule 7).
- **ThoughtForge tables: written.** The app writes `tf_sessions`, `tf_artifacts` and the `tf_email_*` tables with the service-role key (`src/ask/save.ts`, `src/interview/save.ts`, `src/email/store.ts`). This differs from the v0.1 "read-only role for the app" (drift D3).
- **Project of record.** `getServiceClient()` calls `assertProjectOfRecord()` before any client exists. It refuses a URL containing the decoy `xgbpmlkanxewtfizloay` and any URL that does not name `ycadmmngkdhvpcsrcuaq` (`src/lib/supabase.ts`, tested in `src/lib/supabase.test.ts`).

### 4.3 Live lookup tier

**Not built for panel sessions.** No code path in `/api/ask` or `/api/interview` calls OCP Academy, OCP Summit, DCD or the Coverage Matrix. GDELT is wired only into the panel-email news lane (`src/email/context/news.ts`, `scripts/lib/gdelt.ts`). The `gdelt-research` skill text is in every panelist prompt, but panelists have no tool to call it during a session (`src/ask/orchestrate.ts` passes no tools). Registering the OCP sources is tracked in TH-7.

## 5. Evidence ladder and confidence rules

**Tags** (`EVIDENCE_LADDER_CONTRACT` in `src/cast/prompt.ts`, and `cast/_shared/skills/evidence-ladder/SKILL.md`):

- **VRF:** verified against a retrieved artifact marked `primary`.
- **SRC:** sourced to a named document. When the document is a retrieved artifact, it is written `[SRC: <exact title>]`.
- **EST:** an estimate from sourced inputs, with the method stated.
- **INF:** inference with no direct source.

**Claim-level rules as built:**

1. Every factual claim ends with a tag. This is a prompt rule; the parser in `src/ask/render.ts` turns tags into badges.
2. A projection is never SRC. The Fact-Checker always downgrades it to EST (`FACTCHECK_TURN`).
3. A `[SRC: title]` whose title is not in the retrieved block is downgraded to INF.
4. A `[VRF]` on anything except a primary retrieved artifact is downgraded to SRC or lower.
5. A prior panel ruling can support SRC at most (`src/retrieval/primary.ts`).
6. A GDELT-derived claim is EST at most, or INF without a second feed, and never SRC (gdelt-research skill, rule 8).
7. The ruling must not rest on a claim downgraded to INF without saying so (`RULING_TURN`).

**Confidence versus tier.** v0.1 asked for a separate confidence label on each claim and an evidence tier on each reply. As built, there is one object: a tier tag on each claim, plus the Fact-Checker's verdict line on each reply. No reply-level tier is computed (drift D7; §12, Q2).

The v0.1 voice rules carry over as prompt guidance only, with no code check: absence is not evidence, a people signal cannot outweigh a document, a thesis is allowed when stated as a thesis, and conviction is expressed in words, not scores (§12, Q3).

## 6. Panel model and room rules

**The cast** is fixed at ten fictional personas (TF-DEC-13, TF-DEC-31). The manifest is `src/data/panel.ts`, and the canonical persona files are `cast/<slug>/` (TF-DEC-40). The loader fails if any slug drifts between the two (`checkSlugs` in `src/cast/loader.ts`).

| Order | Name (as built) | Role in the room | Slug |
| --- | --- | --- | --- |
| Stage 3 | Gilbert Faraday | Chief of Staff; rules last | `gilbert-faraday` |
| Stage 1 | Margo Brandt | First Officer, Deputy Chief of Staff | `margo-brandt` |
| Stage 1 | Mach Eigen | Chief Engineer | `mach-eigen` |
| Stage 1 | Delia Marchetti | Press Lead | `delia-marchetti` |
| Stage 1 | Albert Thorne | Policy | `albert-thorne` |
| Stage 1 | Hartford Caldwell ("Hart") | Counsel | `hartford-caldwell` |
| Stage 1 | Rosalind Ferraro ("Rose") | Political Director | `rosalind-ferraro` |
| Stage 1 | Victoria Stroud ("Vick") | Economic Advisor | `victoria-stroud` |
| Stage 1 | Dr. Ingrid Halverson | Science Advisor, Thermal Management | `ingrid-halverson` |
| Stage 2 | Constance Wright | Fact-Checker | `constance-wright` |

Names come from `cast/*/persona.json` (`display_name`), and the turn order from `PANEL_ORDER`, `FACT_CHECKER` and `CHIEF_OF_STAFF` in `src/ask/roster.ts`. **Hart's name:** TF-DEC-92 renames him to Hartford Nakamura, but the rename has not landed in code. The folder, manifest, persona and roster still say Caldwell, and only `src/email/panelists.test.ts` knows `hartford-nakamura`, as an email alias (`docs/voices/tf-dec-103-candidates.md`). This spec records names and does not rename anyone (drift D5; §12, Q1).

**Gilbert Faraday and Mach Eigen** play their ThoughtForge roles. Their Faraday Brand Bible biographies are prior-career background only (TF-DEC-38; `docs/cast-standard.md`). This closes the v0.1 name note.

**Room rules as built:**

1. The eight domain panelists answer independently and in parallel. They do not see each other's replies (`src/ask/orchestrate.ts`, Stage 1). Disagreement is invited by the prompt ("state disagreement with the likely view of another panelist"), not produced by live turn-taking.
2. Constance grades all eight before the ruling, and her downgrades appear inline as "contested" marks (§7).
3. Gilbert speaks last on every question, contested or not. His ruling names any panelist he overrules and the evidence that would change his mind.
4. No panelist may name a real person except someone listed in that panelist's own `network.json`, and then only as someone they follow, cite or shared a room with (`EVIDENCE_LADDER_CONTRACT`; `docs/network-rules.md`).
5. The v0.1 "brake" (Hart and the Program & Quality role stopping a recommendation for hard-to-undo harm) is not built as a mechanism. It exists only as voice-brief text (§12, Q4).

## 7. UI requirements

| Requirement | As built | Evidence |
| --- | --- | --- |
| Panelist name and role on each turn | Built: headshot, name and role on each reply card | `src/components/ask/AskPanel.tsx` |
| Tag visible on every claim | Built: `[VRF]`, `[SRC: title]`, `[EST]` and `[INF]` render as badges | `EvidenceBadge.tsx`, `ReplyText.tsx`, `src/ask/render.ts` |
| Evidence tier on every reply | Not built: no reply-level tier | — |
| Disagreement distinct from consensus | Built: Fact-Checker downgrades show as "contested · X→Y" marks, and the ruling shows "Dissent on the record" | `EvidenceBadge.tsx` (`ContestedBadge`), `AskPanel.tsx` |
| Source links for SRC and VRF | Partly built: a "Sources the panel saw" list links each retrieved artifact; individual SRC/VRF badges show the title but no link | `AskPanel.tsx` |
| Mobile first | Built: screenshots checked at 375 px with no horizontal scroll | `docs/decisions-th32.md` (21:22 CT), `docs/screenshots/` |
| Panelist background pages | Built: a bio page per panelist (About, Experience, Education, Life outside work, Voices they follow, Working with the panel) with HeyGen headshots | `app/panel/[slug]/page.tsx`, `src/cast/bio.ts`, `public/panel/` |
| Logo | Not built: `Monogram.tsx` is a text "TF" placeholder, and there is no favicon or icon file in `app/` or `public/` | `src/components/Monogram.tsx` |

**Palette.** ThoughtForge uses its own palette and is not a Faraday sub-brand (v0.1 §3, closed). Hex values are still unsampled and are not invented here.

## 8. Access and gating

- `proxy.ts` gates `/ask`, `/api/ask`, `/interview` and `/api/interview` and everything under them (`GATED_PREFIXES` in `src/lib/access.ts`). The audience is the owner only (TF-DEC-05). Everything else is public.
- A `tf_access` cookie equal to the SHA-256 hex of `TF_ACCESS_KEY` lets a request through. Visiting `?key=<key>` once sets that cookie (httpOnly, secure, SameSite Lax, 90 days) and redirects to the clean URL. A wrong key redirects to `?denied=1`. Without the cookie, a page renders locked and an API route answers 401. The key comparison is constant-time on digests (`src/lib/access.ts`, tested in `src/lib/access.test.ts`).
- If `TF_ACCESS_KEY` is unset, the gate is open and logs one warning. That is meant for local development only.
- `/ask` is left out of the sitemap and is marked `noindex` (`docs/decisions-th32.md`, 21:22 CT).
- The email cron route is authorised by `CRON_SECRET` / `PANEL_CRON_SECRET` (`src/email/README.md`).

## 9. Release and process

- Work is tracked in Linear under team key TH. Build work runs from self-contained prompts (TF-DEC-18). Myke approves every PR (TF-DEC-19).
- Release names use the YY-WW-vXX format (TF-DEC-20), for example `26-45-v01`.
- Each build run keeps a decisions log of one plain-English sentence per decision, with US Central timestamps, in `docs/decisions-th*.md`.
- Checks: `npm run typecheck`, `npm test` (178 tests passing on 2026-11-07), `npm run validate:cast`, `npm run audit:cast` and `npm run build` (`README.md`).
- Cast changes land in `cast/` through a reviewed PR. Notion receives a read-only mirror via `npm run mirror:cast` (TF-DEC-40; TH-28).

## 10. Acceptance criteria (v0.1 items 1 to 7, checked against `main`)

| # | v0.1 criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | A question returns replies from all ten panelists, each from its own Notion-loaded prompt | **Fail as written** | All ten speak in three stages (8 + Fact-Checker + Chief of Staff), each with its own composed prompt. The prompts come from `cast/`, not Notion (`src/ask/orchestrate.ts`, `src/cast/prompt.ts`) |
| 2 | Every reply shows an evidence tier; every claim has a confidence label | **Fail** | Claim tags render as badges, but there is no reply-level tier and no separate confidence label (`src/ask/render.ts`, `EvidenceBadge.tsx`). Tagging is enforced by the prompt, not checked in code |
| 3 | Supabase queries are read-only and the project assertion blocks the decoy | **Pass for the assertion and Faraday reads; fail for "read-only"** | `assertProjectOfRecord` plus tests. The app writes `tf_*` tables (`src/ask/save.ts`, `src/email/store.ts`) |
| 4 | Live lookup returns a named-set source when the question needs current data | **Not built** | No OCP Academy, OCP Summit, DCD or Coverage Matrix client exists, and no tools are passed to panelists (§4.3) |
| 5 | No real person's name in any user-facing text | **Pass for static copy; open for model output** | `scripts/audit-cast.ts` scans app copy and prompt text (`docs/decisions-th32.md`, 21:22 CT). Panelist replies may name people from their own `network.json` by design (`EVIDENCE_LADDER_CONTRACT`), which conflicts with the v0.1 wording (§12, Q5) |
| 6 | The Chief of Staff ruling appears after any contested exchange | **Pass** | Stage 3 runs on every question, after the Fact-Checker (`src/ask/orchestrate.ts`). The ruling UI is in `AskPanel.tsx` |
| 7 | Logo renders at favicon, header and lockup sizes (Primary Monogram and Submark) | **Not built** | The header uses a text placeholder (`src/components/Monogram.tsx`). There is no favicon or icon asset |

Summary: 1 pass, 2 partial (pass in part), 2 fail, 2 not built.

## 11. Drift from v0.1

Each row is a v0.1 statement that no longer holds.

| ID | v0.1 said | True now | Evidence |
| --- | --- | --- | --- |
| D1 | Prompts are loaded from Notion at session start | Composed from repo `cast/` files. Notion is a read-only mirror, and no request path reads Notion | `src/cast/loader.ts`, `src/cast/prompt.ts`; TF-DEC-40; no Notion import in `src/` or `app/` |
| D2 | A live web/industry lookup tier (OCP Academy, OCP Summit, DCD, Coverage Matrix) | Not built in panel sessions. GDELT is used only by panel email | §4.3; `src/email/context/news.ts` |
| D3 | Supabase gives the app a read-only role | Service role. It reads the Faraday library and writes `tf_*` tables | `src/lib/supabase.ts`, `src/ask/save.ts` |
| D4 | Panelists speak in turn and challenge each other live | Eight answer in parallel and blind, then grading, then the ruling (TF-DEC-08) | `src/ask/orchestrate.ts` |
| D5 | Counsel is "Hartford Caldwell" (no decision noted) | TF-DEC-92 renames him to Hartford Nakamura, but code still says Caldwell everywhere except one email alias test | `cast/hartford-caldwell/`, `src/data/panel.ts`, `src/ask/roster.ts`, `src/email/panelists.test.ts` |
| D6 | Gilbert Faraday / Mach Eigen name question "not yet decided" | Closed: they play ThoughtForge roles, with Brand Bible bios as background only | TF-DEC-38; `docs/cast-standard.md` |
| D7 | An evidence tier on each reply plus a confidence label on each claim, as separate objects | One tag per claim. No reply-level tier and no separate confidence label | `src/ask/render.ts`, `EvidenceBadge.tsx` |
| D8 | Each disagreement shown, labelled by panelist | Shown through Fact-Checker downgrades on the claim and the ruling's dissent line. Panelist-to-panelist disagreement is only what each reply volunteers | `AskPanel.tsx`, `RULING_TURN` |
| D9 | Chief of Staff rules "after any contested exchange" | Rules after every question | `src/ask/orchestrate.ts` |
| D10 | "Real people never appear in names or user-facing prompts" applied to all output | Replies may name people from the panelist's own network file | `EVIDENCE_LADDER_CONTRACT`; `docs/network-rules.md` |
| D11 | The Hart / Program & Quality brake can stop a recommendation | Not a mechanism. It exists only in persona text | `src/ask/orchestrate.ts` (no brake path) |
| D12 | Source links for every SRC and VRF claim | One list of retrieved sources. Inline badges show titles without links | `AskPanel.tsx`, `EvidenceBadge.tsx` |
| D13 | Primary Monogram as favicon and header logo | A text placeholder and no favicon. The approved PNG is not in the repo | `src/components/Monogram.tsx` |
| D14 | Scope was a panel Q&A app | Adds 1:1 interviews with voice, panel email and the artifact ingest path | `app/interview/`, `src/voice/`, `src/email/`; TF-DEC-84 |
| D15 | Stack decisions logged in the Notion decision log | Logged per run in the repo's `docs/decisions-th*.md`. Notion is not checked by this run | `docs/decisions-th32.md` and others |

**Drift count: 15.**

## 12. Open questions for Myke

1. **Hart's name (TF-DEC-92).** Should the Caldwell to Nakamura rename land in code (folder, manifest, persona, roster, UI)? That is a subscriber-facing rename, so it is outside this run.
2. **Reply-level tier.** Do you want a computed reply tier (for example, the lowest tag the ruling rests on) and a separate confidence label, or should v1.0 adopt one claim tag as the rule and retire the v0.1 wording?
3. **Voice rules.** Absence-is-not-evidence and people-versus-document are prompt-only. Do you want a Fact-Checker check for them?
4. **Brake.** Should the Counsel / Program & Quality brake become a real mechanism (for example, a ruling flag), or stay persona text?
5. **Real names in replies.** Is naming people from a panelist's own network file acceptable under TF-DEC-13, or should v0.1 criterion 5 apply to model output too?
6. **`tf_email_day_plans`.** The TH-66 migration `20261106_th66_day_plans.sql` is in the repo, but the table is not in `ycadmmngkdhvpcsrcuaq`. Was it meant to be applied before the PR merged?
7. **Live lookup.** Should the tier be built (as panelist tools, or as a pre-retrieval step), and are the access terms and rate limits for OCP Academy, OCP Summit, DCD and Coverage Matrix confirmed (v0.1 §11, item 4)?
8. **Logo asset.** When will `public/brand/thoughtforge-primary-monogram.png` and the Submark land, and are the palette hex values sampled yet?
9. **Not verified by this run:** the Notion decision-log entries for TF-DEC-20, TF-DEC-37 and TF-DEC-92, and whether release summaries are going to Notion. These were not readable from the repo.
