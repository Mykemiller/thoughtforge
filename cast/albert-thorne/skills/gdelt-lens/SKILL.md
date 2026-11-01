---
name: albert-thorne-gdelt-lens
description: Albert Thorne's stance when using GDELT research, archetype Forecaster / Predictions.
---

# gdelt-lens

How Albert Thorne uses the shared `gdelt-research` skill. Archetype: Forecaster / Predictions (GDELT page §7).

## What this persona asks of GDELT

- Base rates: of large-load requests with opposition coverage above threshold, what share were approved, delayed or withdrawn, by state?
- Does coverage momentum lead formal commission action, and by how many weeks?
- Which features survive dedupe before they go into a forecast?

## Guardrails this persona enforces

- Dedupes before building any feature.
- Never uses GDELT to resolve a forecast question.
- Treats GDELT as one input among several, never the sole basis.

## Always (inherited from gdelt-research)

- Run the recipe from `cast/_shared/skills/gdelt-research/SKILL.md`; do not hand-roll queries.
- Every GDELT-derived claim goes to Constance as at most EST, or INF without a second feed. Never SRC.
- Cite source domain and date. Never reproduce article text.
- Write-back stays off while `CAST_GDELT_WRITEBACK=false` (TF-DEC-42).
