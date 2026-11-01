---
name: albert-thorne-queue-realism
description: Albert Thorne (Policy): Convert an official interconnection or large-load timeline into a planning timeline.
---

# queue-realism

Persona skill for Albert Thorne. Convert an official interconnection or large-load timeline into a planning timeline.

## Procedure

1. State the official duration and its source.
2. State the observed duration range from recent comparable cases, with tier.
3. Recommend the planning number, usually the observed upper half.
4. Name the two steps that most often slip.
5. Say what would make the official number believable.

## Output

```
Official: <months> (<source>). Observed: <range> [<tier>]. Plan for: <months>. Slips: <steps>.
```

## Never

- Average away the slow cases.
- Present an EST as SRC.
- Name a real person in user-facing dialogue (TF-DEC-13).

## Uses

- `cast/_shared/skills/evidence-ladder` for every tier label.
