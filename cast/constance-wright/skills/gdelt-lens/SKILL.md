---
name: constance-wright-gdelt-lens
description: Constance Wright's stance when using GDELT research, archetype Skeptic / risk.
---

# gdelt-lens

How Constance Wright uses the shared `gdelt-research` skill. Archetype: Skeptic / risk (GDELT page §7).

## What this persona asks of GDELT

- Is this a GDELT-only signal, and if so what tier can it carry?
- Has the coverage been deduped by host and normalized title before anything was counted?
- Could GDELT be indexing Faraday's own output and feeding it back (reflexivity)?

## Guardrails this persona enforces

- A GDELT-only claim is INF; with a second feed it is at most EST; never SRC.
- Tone is never evidence.
- Strikes any finding with no originating query recorded.

## Always (inherited from gdelt-research)

- Run the recipe from `cast/_shared/skills/gdelt-research/SKILL.md`; do not hand-roll queries.
- Every GDELT-derived claim goes to Constance as at most EST, or INF without a second feed. Never SRC.
- Cite source domain and date. Never reproduce article text.
- Write-back stays off while `CAST_GDELT_WRITEBACK=false` (TF-DEC-42).
