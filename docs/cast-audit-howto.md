# Cast audit (TH-30)

`npm run audit:cast` runs the six QA gate checks and writes `docs/cast-audit-<YYYYMMDD>.md`. It exits 1 on any FAIL. A WARN means something needs a person's review before sign-off. Passing the audit is input to Myke's sign-off, not a substitute for it.

| # | Check | How |
| --- | --- | --- |
| 1 | Real-name audit | Extracts capitalized runs from every dossier, bio, voice brief and skill file. Each one is classified as FIC (panelists, family, associates, talk titles), REAL-ORG (`cast/_shared/real-orgs.yaml` plus every employer, school, organization, title and domain label in persona.json), VOICE (this panelist's network) or reviewed non-person (`cast/_shared/audit-allow.yaml`). These fail: an archetype name from `cast/_shared/cast-sheet-v1.snapshot.json`, a people-spine name outside the panelist's network, or any real name in a voice brief or skill. Anything unclassified is a WARN for review. |
| 2 | Network provenance | Re-resolves every `network.draft.yaml` against the people snapshot and compares the result with persona.json: person_id, kind, venue, `since` before 2025. Waivers go in `cast/_shared/network-waivers.yaml` as `slug:Name`, and only Myke adds them. |
| 3 | Cross-dossier consistency | Every relationship appears in both persona.json files and both dossiers with the same years. Each participant was at the named firm in those years. Every same-firm overlap between two panelists needs a relationship that joins them there. |
| 4 | Register check | All voice briefs match Cast Sheet v1 word for word. At least six panelists are women (judged by backstory pronouns), each born 1980 or earlier with 20 or more years of career. |
| 5 | Prompt budget | Estimates a provisional system prompt per panelist (role, voice, backstory, life outside work, persona and shared skills) at 3.5 characters per token, against a 6,000-token limit. TH-27 sets the real composition. |
| 6 | Evidence tags | Every dossier fact line carries FIC, REAL-ORG, REAL-EVENT or VOICE. Every bio Experience and Education entry traces to a tagged persona.json fact. |

## Reviewing check 1

When a run lists phrases for review, read each one where it appears:
- A place, venue, team, band, product or term goes in the right list in `audit-allow.yaml`.
- A real person outside the networks is fixed in the cast generator, then the cast is re-rendered.
- A person never goes in the allow list.

## Refreshing the spine scan

The audit writes every candidate phrase to `cast/_fixtures/spine-candidates.txt`. When the report says the spine scan is stale:
1. Check those phrases read-only through the Supabase connector against `people` on `ycadmmngkdhvpcsrcuaq`. A match is an equal canonical name, an equal alias, or a phrase that contains a full canonical name.
2. Write the matches, the count and the list's SHA-256 to `cast/_fixtures/spine-scan.json`. The SHA-256 is of the sorted phrases joined by newlines.
