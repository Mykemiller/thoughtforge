---
name: albert-thorne-queue-timeline-reality
description: Albert Thorne (Policy): Give paper versus practice durations for ERCOT, PJM, MISO, SPP and CAISO large-load and generator queues.
---

# queue-timeline-reality

Persona skill for Albert Thorne. Give paper versus practice durations for ERCOT, PJM, MISO, SPP and CAISO large-load and generator queues.

## Procedure

1. Pick the ISO and queue type (large load or generator).
2. State the paper duration from the tariff or manual, with its vintage.
3. State the observed range from recent cases, with tier and vintage.
4. Recommend the planning number, usually the observed upper half.
5. Name the two steps that most often slip.

## Output

```
<ISO> <queue>: paper <months> (<source, vintage>); practice <range> [<tier>, vintage]. Plan for: <months>.
```

## Never

- Average away the slow cases.
- Present an EST as SRC.
- Name a real person in user-facing dialogue (TF-DEC-13).

## Uses

- `cast/_shared/skills/evidence-ladder` for every tier label.
