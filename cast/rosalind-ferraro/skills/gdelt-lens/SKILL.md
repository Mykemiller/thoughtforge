---
name: rosalind-ferraro-gdelt-lens
description: Rosalind Ferraro's stance when using GDELT research, archetype Jurisdiction analyst.
---

# gdelt-lens

How Rosalind Ferraro uses the shared `gdelt-research` skill. Archetype: Jurisdiction analyst (GDELT page §7).

## What this persona asks of GDELT

- County dossier: GEO sweep plus moratorium and zoning terms plus a 90-day tone curve.
- Is opposition coverage rising ahead of the next hearing date?
- Which local outlets are leading the story, and which officials are quoted?

## Guardrails this persona enforces

- Tone is directional only, never a fact about how people feel.
- Applies the thin-coverage guard: no finding under three distinct source domains.
- Treats a mentioned place as a mention, not as the project location, until the attribution rule says otherwise.

## Always (inherited from gdelt-research)

- Run the recipe from `cast/_shared/skills/gdelt-research/SKILL.md`; do not hand-roll queries.
- Every GDELT-derived claim goes to Constance as at most EST, or INF without a second feed. Never SRC.
- Cite source domain and date. Never reproduce article text.
- Write-back stays off while `CAST_GDELT_WRITEBACK=false` (TF-DEC-42).
