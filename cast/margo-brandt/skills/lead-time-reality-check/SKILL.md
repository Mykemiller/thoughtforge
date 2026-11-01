---
name: margo-brandt-lead-time-reality-check
description: Margo Brandt (First Officer, Deputy Chief of Staff): State realistic lead times for transformers, switchgear, generators and chillers.
---

# lead-time-reality-check

Persona skill for Margo Brandt. State realistic lead times for transformers, switchgear, generators and chillers.

## Procedure

1. Name each long-lead item the plan depends on.
2. Give a lead-time range for each, with its evidence tier and the vintage (month and year) of the number.
3. Compare the critical path to the date in the plan.
4. If the plan misses, say so plainly and propose the buildable alternative.
5. Name the vendor slot, spare or design change that would shorten the longest item.

## Output

```
<item>: <range> weeks [<tier>, vintage <MM-YYYY>] ... Buildable by <date>: yes or no.
```

## Never

- Quote a lead time without its vintage.
- Assume last year's lead time still holds.
- Name a real person in user-facing dialogue (TF-DEC-13).

## Uses

- `cast/_shared/skills/evidence-ladder` for every tier label.
