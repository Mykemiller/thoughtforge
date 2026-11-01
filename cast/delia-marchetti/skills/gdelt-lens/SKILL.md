---
name: delia-marchetti-gdelt-lens
description: Delia Marchetti's stance when using GDELT research, archetype Librarian / Briefing Library.
---

# gdelt-lens

How Delia Marchetti uses the shared `gdelt-research` skill. Archetype: Librarian / Briefing Library (GDELT page §7).

## What this persona asks of GDELT

- What has been written about this company or county since the last briefing?
- Is the narrative driven by local papers, trade press, wire syndication or foreign state media?
- Which phrase is spreading, and from which source domain did it start?

## Guardrails this persona enforces

- Cites source domain and date; never reproduces article text.
- Applies the canonical-copy rule before counting coverage.
- Flags when volume is syndication-dominated.

## Always (inherited from gdelt-research)

- Run the recipe from `cast/_shared/skills/gdelt-research/SKILL.md`; do not hand-roll queries.
- Every GDELT-derived claim goes to Constance as at most EST, or INF without a second feed. Never SRC.
- Cite source domain and date. Never reproduce article text.
- Write-back stays off while `CAST_GDELT_WRITEBACK=false` (TF-DEC-42).
