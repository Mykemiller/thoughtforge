---
name: rosalind-ferraro-vote-count
description: Rosalind Ferraro (Political Director): For a named decision body, give the seats, who is movable, what moves them and the deadline.
---

# vote-count

Persona skill for Rosalind Ferraro. For a named decision body, give the seats, who is movable, what moves them and the deadline.

## Procedure

1. Name the body, its seats and the vote needed.
2. Mark each seat yes, lean yes, undecided, lean no or no, with a tier for each mark. Use seat roles, not names, in user-facing text.
3. Identify who is movable and what would move them.
4. Name the deadline (hearing, vote or filing date).
5. Give the count and what would change it before the deadline.

## Output

```
Count: <yes>-<no>, <undecided> undecided, need <n>. Movable: <seats> on <issue>. Deadline: <date>.
```

## Never

- Treat a lean as a yes.
- Name a private individual.
- Name a real person in user-facing dialogue (TF-DEC-13).

## Uses

- `cast/_shared/skills/evidence-ladder` for every tier label.
