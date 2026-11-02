---
name: gdelt-research
description: Quirk-aware research over GDELT DOC 2.0 and GEO 2.0 for ThoughtForge panelists, with three recipes (County dossier, Company watch, Project autopsy). Use when a panel question needs what the press is saying, where, and since when.
---

# gdelt-research

Shared skill (TH-14, TF-DEC-42). GDELT is a signal and discovery layer, never content. Source: Notion page "GDELT — a net new pipeline" §3 and §6.

## Endpoints

- DOC 2.0: `https://api.gdeltproject.org/api/v2/doc/doc` with `mode=artlist`, `mode=timelinevol` or `mode=timelinetone`, `format=json`, `timespan=90d` by default (up to 1 year), `maxrecords=250`.
- GEO 2.0: `https://api.gdeltproject.org/api/v2/geo/geo`, 24-hour default window, up to 7 days.
- BigQuery (`gdelt-bq.gdeltv2.gkg_partitioned`): **stubbed** until CC-GDELT-RESEARCH-SKILL-1.0 is gated. Say "BigQuery fallback not available yet" if a question needs more than a year or more than 250 rows.

## Hard rules (always)

1. Split boolean queries into several simple ones and dedupe by host plus normalized title. Compound expressions are unreliable.
2. Pace at one request every 5 seconds.
3. Tone is directional, never fact.
4. Never reproduce article text. Cite source domain and date.
5. Thin-coverage guard: suppress any finding supported by fewer than 3 distinct source domains.
6. A mentioned place is not the project location. Do not attribute a county until the county-attribution rule is approved (GDELT D2).
7. Write-back to `artifacts` tagged `gdelt:research` with the originating query happens only when `CAST_GDELT_WRITEBACK=true` and only after the guard assertion confirms the Supabase project is `ycadmmngkdhvpcsrcuaq` (never `xgbpmlkanxewtfizloay`). It is `false` until Gate 1 of the GDELT pack.
8. Every GDELT-derived claim goes to the evidence ladder as at most EST, or INF without a second feed. Never SRC.

## Recipe 1: County dossier

1. GEO sweep for the county name plus "data center" over the last 7 days.
2. DOC `artlist` for each of these, run separately: `"<county> data center"`, `"<county> moratorium"`, `"<county> rezoning data center"`, `"<county> substation"`.
3. DOC `timelinevol` and `timelinetone` for `"<county> data center"` over 90 days.
4. Dedupe, apply the thin-coverage guard, list the top five source domains and whether volume is syndication-dominated.
5. Output: 90-day volume and tone trend (directional), top domains, three most recent local headlines as domain plus date, opposition indicator yes or no.

## Recipe 2: Company watch

1. DOC `artlist` for `"<company>"` plus each of `data center`, `financing`, `lawsuit`, `interconnection`, run separately.
2. Note co-occurring organizations and quoted executives (metadata only).
3. DOC `timelinevol` for `"<company>"` over 90 days.
4. Output: co-occurring organizations, quoted roles (not names in user-facing text), volume trend, notable dated items.

## Recipe 3: Project autopsy

1. Identify the announcement date with DOC `artlist` on the project or campus description.
2. Find first opposition coverage (moratorium, lawsuit, hearing, petition) with separate queries.
3. Find the outcome (approved, delayed, withdrawn) and its date.
4. Output: announcement, then opposition, then outcome, each with date and source domains; weeks between each step; comparator note that DC Hub `deal_autopsy` is the narrower, cleaner source.

## Example queries

```
https://api.gdeltproject.org/api/v2/doc/doc?query=%22data%20center%20moratorium%22&mode=timelinevol&timespan=90d&format=json
https://api.gdeltproject.org/api/v2/doc/doc?query=%22Loudoun%20County%22%20%22data%20center%22&mode=artlist&maxrecords=250&timespan=90d&format=json
```
