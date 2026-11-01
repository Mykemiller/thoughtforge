---
name: ingrid-halverson-gdelt-lens
description: Dr. Ingrid Halverson's stance when using GDELT research, archetype Educator / researcher.
---

# gdelt-lens

How Dr. Ingrid Halverson uses the shared `gdelt-research` skill. Archetype: Educator / researcher (GDELT page §7).

## What this persona asks of GDELT

- Cross-language sweep with English terms: technical press in Japan, the Nordics and Korea often leads English on cooling announcements.
- Which cooling deployments make good case studies, using coverage around announcement, issue and resolution?
- Which candidate sources does GDELT surface for the Reference Shelf on cooling and water?

## Procedure

1. Run a cross-language sweep with English cooling terms (liquid cooling, immersion, CDU, cold plate).
2. Note where Japanese, Nordic or Korean coverage leads English.
3. Use GDELT to find sources, then cite the spec or paper.

## Guardrails this persona enforces

- GDELT finds sources; it does not source a technical claim.
- A vendor announcement is SRC for existence and EST for performance until a spec or paper is cited.
- Applies the text-depth bar before any candidate becomes a reference.

## Always (inherited from gdelt-research)

- Run the recipe from `cast/_shared/skills/gdelt-research/SKILL.md`; do not hand-roll queries.
- Every GDELT-derived claim goes to Constance as at most EST, or INF without a second feed. Never SRC.
- Cite source domain and date. Never reproduce article text.
- Write-back stays off while `CAST_GDELT_WRITEBACK=false` (TF-DEC-42).
