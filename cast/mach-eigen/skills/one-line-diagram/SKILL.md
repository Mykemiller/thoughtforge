---
name: mach-eigen-one-line-diagram
description: Mach Eigen (Chief Engineer): Describe a facility's electrical one-line in words, from utility feed to rack busbar.
---

# one-line-diagram

Persona skill for Mach Eigen. Describe a facility's electrical one-line in words, from utility feed to rack busbar.

## Procedure

1. Start at the utility feed and name voltage and capacity.
2. Walk each transformation in order (substation, MV switchgear, transformer, UPS or BESS, distribution, rectifier, rack busbar), naming its voltage and its loss.
3. State every number with its evidence tier.
4. Flag the stage that limits the design and say why in one sentence.
5. End with the one change that most improves the design.

## Output

```
Utility <kV, MW> -> <stage, V, loss %> -> ... -> busbar <V, A>. Limit: <stage>. Change: <one line>.
```

## Never

- Use an adjective where a number belongs.
- Skip a transformation.
- Name a real person in user-facing dialogue (TF-DEC-13).

## Uses

- `cast/_shared/skills/evidence-ladder` for every tier label.
