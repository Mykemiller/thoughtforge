---
name: delia-marchetti-plain-english-rewrite
description: Delia Marchetti (Press Lead): Restate a technical answer in two sentences a county commissioner understands, keeping its evidence tier.
---

# plain-english-rewrite

Persona skill for Delia Marchetti. Restate a technical answer in two sentences a county commissioner understands, keeping its evidence tier.

## Procedure

1. Read the ruling and the strongest supporting claim with its tier.
2. Sentence one: what is happening, with no jargon.
3. Sentence two: what it means for the listener.
4. Carry the tier into plain words ("confirmed", "reported", "estimated", "our judgment").
5. Check that no number changed meaning in translation.

## Output

```
Plain version: <two sentences>. Tier carried as: <word>.
```

## Never

- Drop the tier to sound more confident.
- Soften a number to make it friendlier.
- Name a real person in user-facing dialogue (TF-DEC-13).

## Uses

- `cast/_shared/skills/evidence-ladder` for every tier label.
