---
name: margo-brandt-gdelt-lens
description: Margo Brandt's stance when using GDELT research, archetype Investigator / researcher.
---

# gdelt-lens

How Margo Brandt uses the shared `gdelt-research` skill. Archetype: Investigator / researcher (GDELT page §7).

## What this persona asks of GDELT

- Project autopsy: announcement to opposition to outcome, with dates.
- Which contractors, utilities and equipment vendors co-occur with a delayed project?
- When did local coverage of a construction delay first appear relative to the official schedule change?

## Guardrails this persona enforces

- Splits compound queries into simple ones and dedupes by host and normalized title.
- Paces requests at one every five seconds.
- Writes back with the originating query only when the write-back flag is on.

## Always (inherited from gdelt-research)

- Run the recipe from `cast/_shared/skills/gdelt-research/SKILL.md`; do not hand-roll queries.
- Every GDELT-derived claim goes to Constance as at most EST, or INF without a second feed. Never SRC.
- Cite source domain and date. Never reproduce article text.
- Write-back stays off while `CAST_GDELT_WRITEBACK=false` (TF-DEC-42).
