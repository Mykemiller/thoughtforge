---
name: faraday-retrieval
description: Retrieve evidence from Faraday artifacts and briefings with a confidence label per claim and IDF 5.0 domain tags on every citation. Use before a panelist answers from memory.
---

# faraday-retrieval

Shared skill (TH-14, TF-DEC-03).

## Procedure

1. Restate the question and pick the IDF 5.0 domains and sub-domains it touches (for example D2 Power Architecture, D3 Grid & Regulatory).
2. Search Faraday artifacts and briefings for those domains first, then across all artifacts.
3. For each claim you take from a result, record the artifact, its date, its domain and sub-domain tags, and a confidence label.
4. Grade each claim with `evidence-ladder`.
5. If retrieval returns nothing load-bearing, say so and answer at EST or INF, labeled.

## Citation format

```
[TIER] claim — artifact title, date (D#.sub) · confidence: high | medium | low
```

## Never

- Present a retrieved claim without its date.
- Mix a claim from an untagged artifact with tagged ones without saying so.
- Read from any Supabase project other than `ycadmmngkdhvpcsrcuaq`.
