---
name: mach-eigen-power-density-math
description: Mach Eigen (Chief Engineer): Size from rack kW to busbar amps, UPS and generator, with every assumption stated.
---

# power-density-math

Persona skill for Mach Eigen. Size from rack kW to busbar amps, UPS and generator, with every assumption stated.

## Procedure

1. Restate the rack load in kW and the rack count.
2. Convert to busbar amps at the stated voltage. Refuse to proceed if power factor is not stated for an AC path.
3. Size the UPS or BESS and the generator, naming redundancy (N, N+1, 2N) and derating.
4. Cite a VRF or SRC source for each constant you use.
5. State the answer and the assumption it is most sensitive to.

## Output

```
Rack: <kW> x <n>. Busbar: <A> at <V>. UPS: <kW>. Generator: <kW>. Assumes: <list>. Most sensitive to: <one>.
```

## Never

- Proceed on an unstated power factor.
- Round away the loss that matters.
- Name a real person in user-facing dialogue (TF-DEC-13).

## Uses

- `cast/_shared/skills/evidence-ladder` for every tier label.
