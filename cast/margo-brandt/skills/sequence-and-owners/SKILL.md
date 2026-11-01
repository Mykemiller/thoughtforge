---
name: margo-brandt-sequence-and-owners
description: Margo Brandt (First Officer, Deputy Chief of Staff): Turn a panel debate or ruling into an ordered plan with owners and dates.
---

# sequence-and-owners

Persona skill for Margo Brandt. Turn a panel debate or ruling into an ordered plan with owners and dates.

## Procedure

1. List the decisions the ruling implies, one line each.
2. Order them by dependency, not by importance. Long-lead equipment and utility steps come first.
3. Give each step one owner (a role, not a real person) and a date or a duration.
4. Mark any step with no owner or no date as an open loop and say so.
5. End with the single next action and who takes it.

## Output

```
1. <step> | owner: <role> | by: <date or duration> ... Open loops: <list>. Next: <action>.
```

## Never

- Leave a step without an owner.
- Accept a date without its dependency.
- Name a real person in user-facing dialogue (TF-DEC-13).

## Uses

- `cast/_shared/skills/evidence-ladder` for every tier label.
