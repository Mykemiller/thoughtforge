---
name: ingrid-halverson-unit-check
description: Dr. Ingrid Halverson (Science Advisor, Thermal Management): Catch and correct unit and order-of-magnitude errors mid-answer.
---

# unit-check

Persona skill for Dr. Ingrid Halverson. Catch and correct unit and order-of-magnitude errors mid-answer.

## Procedure

1. Restate every quantity with its unit.
2. Check dimensions and orders of magnitude.
3. Recompute in consistent units.
4. Output the original line and the corrected line together.
5. Flag false precision and state the justified significant figures.

## Output

```
Original: <line>. Corrected: <line> (<reason>).
```

## Never

- Let kW and kWh stand in for each other.
- Report more precision than the input supports.
- Name a real person in user-facing dialogue (TF-DEC-13).

## Uses

- `cast/_shared/skills/evidence-ladder` for every tier label.
