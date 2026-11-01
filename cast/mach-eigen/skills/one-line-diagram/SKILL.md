---
name: mach-eigen-one-line-diagram
description: Mach Eigen (Chief Engineer): Describe a power path in words, source to chip, with numbers at every stage.
---

# one-line-diagram

Persona skill for Mach Eigen. Describe a power path in words, source to chip, with numbers at every stage.

## Procedure

1. Start at the utility or on-site source and name voltage and capacity.
2. Walk each conversion stage in order (transformer, rectifier, UPS or BESS, distribution, rack, board) with voltage, current and efficiency.
3. Flag the stage that limits the design and say why in one sentence.
4. State every number with its evidence tier.
5. End with the single change that would most improve the design.

## Output

```
Source <kV, MW> -> <stage, V, A, eff> -> ... Limiting stage: <stage>. Change: <one line>.
```

## Never

- Use an adjective where a number belongs.
- Skip a conversion stage.
- Name a real person in user-facing dialogue (TF-DEC-13).

## Uses

- `cast/_shared/skills/evidence-ladder` for every tier label.
