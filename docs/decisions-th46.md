# TH-46 decisions log

One plain-English sentence per decision, US Central timestamps.

- 2026-11-07 CT — A failed save is shown, never blocks the ruling: the `saved` event carries the outcome and the person still gets the answer (D1).
- 2026-11-07 CT — On `/api/ask` only, `done` now follows `saved`; `/api/interview` keeps `saved` on its `done` event unchanged (D2).
- 2026-11-07 CT — `src/interview/save.ts` and the retrieval notes use the same `describeError` helper, since they had the identical `[object Object]` defect (D3).
- 2026-11-07 CT — `/api/health` runs a head-only count on `tf_sessions` through the service client, because PostgREST cannot run `select 1` and this still proves URL, key and project of record (D4).
- 2026-11-07 CT — `/api/health` sits behind the same access gate as `/ask` (in `GATED_PREFIXES` and the proxy matcher) because it names which dependency is down (D5).
- 2026-11-07 CT — Demo mode (`TF_MOCK=1`) emits no `saved` event and shows no amber bar, so a false alarm never teaches people to ignore it (D6).
- 2026-11-07 CT — No Vercel cron is added; the health check is for Myke or Claude Code to hit after an env change (D7).
- 2026-11-07 CT — The live event sequence moved into `src/ask/live.ts` with injected dependencies so the order retrieval, panelists, factcheck, ruling, saved, done is unit-tested; `done` is emitted on every path.
- 2026-11-07 CT — The health route skips the library-size guard on purpose, since its job is to report connection state; it reads only `tf_sessions` and never echoes a key, key prefix or URL.
