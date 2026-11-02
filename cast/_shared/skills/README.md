# Shared cast skills

Every panelist imports all three shared skills through one line each in the `skills[]` manifest of their `persona.json`:

```json
{"name": "gdelt-research", "path": "cast/_shared/skills/gdelt-research/SKILL.md", "kind": "shared"}
```

Each panelist then adds a `gdelt-lens` skill and two persona skills under `cast/<slug>/skills/`.

## Recommendations recorded (TH-14)

- Default GDELT lookback is 90 days and default max rows is 250.
- The BigQuery fallback is stubbed until CC-GDELT-RESEARCH-SKILL-1.0 is gated.
- Write-back is gated on `CAST_GDELT_WRITEBACK` (default `false`) and on the guard assertion for project `ycadmmngkdhvpcsrcuaq`.
- Smoke test: `npm run smoke:gdelt` runs one DOC 2.0 `timelinevol` query for "data center moratorium" over 90 days and prints the row count (`scripts/smoke-gdelt.ts`). It exits 1 on an empty timeline or on GDELT's plain-text error answers, and retries twice (after 5 and 15 seconds) when GDELT rate limits it, including HTTP 429. `npm test` covers the parsing offline.
