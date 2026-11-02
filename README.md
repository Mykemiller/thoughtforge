# ThoughtForge

Ten original AI advisors argue a datacenter question in the open and hand back one decision-ready ruling. Built by Faraday Intelligence; the panel is fixed at ten (TF-DEC-31) and every panelist is fictional (TF-DEC-13). Linear project P-TH-8.

## The three capabilities

| Capability | Routes | What it does |
| --- | --- | --- |
| **Meet the Panel** | `/panel`, `/panel/<slug>` | The roster from the cast files in `cast/`: headshot, role, voice brief, then a full bio page per panelist (About, Experience, Education, Life outside work, Voices they follow, Working with the panel). Public. |
| **Ask the Panel** | `/ask`, `POST /api/ask` | Eight domain panelists answer in parallel, the Fact-Checker grades every claim on the VRF/SRC/EST/INF ladder and marks what she downgrades, and the Chief of Staff rules last with a dissent line and what would change his mind. Streams over server-sent events. Private (see Access). |
| **Artifact path** | `npm run ingest:artifact`, `tf_artifacts` | Two ways in, one table: Markdown files with front matter, and every finished panel session. Retrieval reads that table and the Faraday artifact library in the same Supabase project. See `docs/artifacts.md`. |

## Running locally

```bash
npm ci
npm run dev            # http://localhost:3000
```

**Without keys.** Everything builds and runs with no environment at all. `/panel` and `/panel/<slug>` are static. To demo `/ask` with no model or database calls:

```bash
TF_MOCK=1 npm run dev
```

The canned session in `src/cast/__fixtures__/mock-session.json` streams through the real route and UI.

**With keys.** Pull the Vercel environment into `.env.local` (never committed) and run normally:

```bash
vercel env pull .env.local
npm run dev
```

If `TF_ACCESS_KEY` is unset the gate is open and logs one warning; set it to lock `/ask`.

## Environment variables (names only)

`ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `ELEVENLABS_API_KEY`, `HEYGEN_API_KEY`, `TF_ACCESS_KEY`, `TF_MOCK`. See `.env.example`. Secrets live on the Vercel project `thoughtforge` (team `project-foundry`); code reads them from `process.env` only. The Supabase project of record is `ycadmmngkdhvpcsrcuaq`; every database path asserts that first and refuses the decoy project.

## Access

`/ask` and `/api/ask` are gated by `proxy.ts` (TF-DEC-05): a `tf_access` cookie equal to the SHA-256 hex of `TF_ACCESS_KEY` allows; visiting `/ask?key=<TF_ACCESS_KEY>` once sets that cookie for 90 days and redirects to the clean path; otherwise `/ask` renders a locked page and `/api/ask` answers 401. Everything else is public.

## Adding artifacts

Drop a Markdown file with YAML front matter (`title`, `publisher`, `url`, `published_at`, `source`, `idf_domains`, `tags`) into `artifacts/inbox/` and run:

```bash
npm run ingest:artifact -- artifacts/inbox
```

Format and a fictional example: `artifacts/inbox/README.md`, `artifacts/inbox/_example.md`. Every completed panel session is also saved as a `source = 'panel'` artifact, so later panels can cite earlier rulings as `[SRC]`. Full detail in `docs/artifacts.md`.

## Checks

```bash
npm run typecheck      # Next app + scripts
npm test               # node:test via tsx: cast tooling, loader, prompt budget, SSE, access, front matter
npm run validate:cast  # cast standard (docs/cast-standard.md)
npm run audit:cast -- --stdout   # TH-30 QA gate, now with the app's UI copy in scope
npm run build
npm run screenshots    # Playwright: docs/screenshots/*.png from production builds (mock and locked)
```

## Cast

The ten panelists live in `cast/<slug>/` (dossier, persona.json, linkedin.md, network.json, skills). The repo copy is canonical (TF-DEC-40); the standard is `docs/cast-standard.md`. Do not add, remove or rename panelists.

## Branch and merge history

- `feat/meet-the-panel` (Next.js app, `/` and `/panel`, headshots) and `th-cast-bring-to-life` (the ten dossiers and cast tooling) were developed in parallel from `main`.
- `th-32-v1-app` merged both (TF-DEC-52), reconciled `package.json`/`tsconfig`, and added the cast loader, bio pages, Ask the Panel, the artifact path and the access gate (Linear TH-32; decisions in `docs/decisions-th32.md`).
- PR "TH-32: ThoughtForge v1" is the merge gate (TF-DEC-19).
