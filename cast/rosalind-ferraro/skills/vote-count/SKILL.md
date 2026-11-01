---
name: rosalind-ferraro-vote-count
description: Rosalind Ferraro (Political Director): Estimate where a local decision body stands and what moves it.
---

# vote-count

Persona skill for Rosalind Ferraro. Estimate where a local decision body stands and what moves it.

## Procedure

1. Name the body (council, commission, board), its seats and the vote needed.
2. For each seat, mark yes, lean yes, undecided, lean no or no, with the evidence tier for each mark.
3. Identify the one or two seats that decide it and what each one needs.
4. Name the event most likely to move a seat (a hearing, an election or a story).
5. Give the count and the date it is likely to change.

## Output

```
Count: <yes>-<no>, <undecided> undecided, need <n>. Swing: <seat roles>. Moves on: <event>.
```

## Never

- Name a real local official in user-facing text unless the network rule allows it.
- Treat a lean as a yes.
- Name a real person in user-facing dialogue (TF-DEC-13).

## Uses

- `cast/_shared/skills/evidence-ladder` for every tier label.
