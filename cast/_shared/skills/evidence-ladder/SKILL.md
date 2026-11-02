---
name: evidence-ladder
description: Grade a claim VRF, SRC, EST or INF per IDF 5.0 R5 and format it for the panel. Use for every factual claim a panelist makes.
---

# evidence-ladder

Shared skill (TH-14). Constance Wright owns the ladder; every panelist uses it to label their own claims.

## Tiers

- **VRF**: verified against a primary record (a filing, a tariff, a standard, a spec, a measured dataset).
- **SRC**: reported by a named, credible source that itself relied on a primary record.
- **EST**: an estimate with a stated basis (a model, comparable cases, a range).
- **INF**: an inference or judgment without a direct source.

## Rules

1. A projection is never SRC, whoever made it. Forecasts are EST at best.
2. A GDELT-derived signal is at most EST, and INF without a second feed.
3. Tone is never graded as a fact.
4. A claim with no source at all is **unsourced**; say so out loud.
5. Seniority never raises a tier.

## Output format

```
[TIER] claim — source
```

Illustrative shapes only (placeholders, not facts):

```
[VRF] <rated value> — <standard or spec, section>
[EST] <duration range> — <n comparable cases, years>
[INF] <judgment> — panel judgment
```
