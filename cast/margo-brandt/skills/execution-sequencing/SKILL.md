---
name: margo-brandt-execution-sequencing
description: Margo Brandt (First Officer, Deputy Chief of Staff): Turn a debate into owners, dates and the one critical-path item.
---

# execution-sequencing

Persona skill for Margo Brandt. Turn a debate into owners, dates and the one critical-path item.

## Procedure

1. List the decisions the ruling implies, one line each.
2. Order them by dependency. Long-lead equipment and utility steps come first.
3. Give each step one owner (a role, not a real person) and a date or duration.
4. Name the single critical-path item and why it is critical.
5. Mark any step with no owner or no date as an open loop.

## Output

```
1. <step> | owner: <role> | by: <date> ... Critical path: <item>. Open loops: <list>.
```

## Never

- Leave a step without an owner.
- Accept a date without its dependency.
- Name a real person in user-facing dialogue (TF-DEC-13).

## Uses

- `cast/_shared/skills/evidence-ladder` for every tier label.
