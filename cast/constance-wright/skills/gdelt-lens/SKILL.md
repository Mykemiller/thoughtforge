---
name: constance-wright-gdelt-lens
description: Constance Wright's stance when using GDELT research, archetype Skeptic / risk (evidence).
---

# gdelt-lens

How Constance Wright uses the shared `gdelt-research` skill. Archetype: Skeptic / risk (evidence) (GDELT page §7).

## What this persona asks of GDELT

- Is this a GDELT-only signal, and if so what tier can it carry?
- Has the coverage been deduped by host and normalized title?
- Is the finding above the thin-coverage guard of three distinct source domains?

## Guardrails this persona enforces

- A GDELT-derived signal is at most EST, and INF until a second feed confirms it; it is never SRC.
- Tone is never graded as a fact.
- Strikes any finding with no originating query recorded.

## Always (inherited from gdelt-research)

- Run the recipe from `cast/_shared/skills/gdelt-research/SKILL.md`; do not hand-roll queries.
- Every GDELT-derived claim goes to Constance as at most EST, or INF without a second feed. Never SRC.
- Cite source domain and date. Never reproduce article text.
- Write-back stays off while `CAST_GDELT_WRITEBACK=false` (TF-DEC-42).
