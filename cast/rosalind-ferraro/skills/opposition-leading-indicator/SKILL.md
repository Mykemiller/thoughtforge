---
name: rosalind-ferraro-opposition-leading-indicator
description: Rosalind Ferraro (Political Director): Read GDELT volume and tone on opposition terms for a county as a directional early warning.
---

# opposition-leading-indicator

Persona skill for Rosalind Ferraro. Read GDELT volume and tone on opposition terms for a county as a directional early warning.

## Procedure

1. Run DOC timelinevol and timelinetone separately for the county with each of: moratorium, zoning, water, noise.
2. Dedupe by host and normalized title and apply the thin-coverage guard.
3. Report coverage momentum (last 30 days vs prior 60) and opposition-theme share.
4. Label every result EST and directional.
5. Name the hearing or vote the signal leads, if one is scheduled.

## Output

```
[EST] <county>: momentum <+/- %>, opposition share <%> (directional). Leads: <hearing, date>.
```

## Never

- Present tone as a fact about how people feel.
- Name a private individual from GDELT output.
- Name a real person in user-facing dialogue (TF-DEC-13).

## Uses

- `cast/_shared/skills/evidence-ladder` for every tier label.
