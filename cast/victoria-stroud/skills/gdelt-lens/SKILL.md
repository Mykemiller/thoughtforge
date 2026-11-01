---
name: victoria-stroud-gdelt-lens
description: Victoria Stroud's stance when using GDELT research, archetype Investigator / researcher.
---

# gdelt-lens

How Victoria Stroud uses the shared `gdelt-research` skill. Archetype: Investigator / researcher (GDELT page §7).

## What this persona asks of GDELT

- Company watch: which sponsors, lenders and tenants co-occur with a borrower or developer over the last year?
- Did coverage of a financing, a covenant breach or a sponsor exit appear before the filing?
- Which executives are quoted on a deal, and is the quote consistent with the filing?

## Guardrails this persona enforces

- Splits compound queries and dedupes before counting.
- Paces at one request every five seconds.
- A quote from coverage is never a financial fact until a filing or term sheet confirms it.

## Always (inherited from gdelt-research)

- Run the recipe from `cast/_shared/skills/gdelt-research/SKILL.md`; do not hand-roll queries.
- Every GDELT-derived claim goes to Constance as at most EST, or INF without a second feed. Never SRC.
- Cite source domain and date. Never reproduce article text.
- Write-back stays off while `CAST_GDELT_WRITEBACK=false` (TF-DEC-42).
