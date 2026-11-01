# ThoughtForge cast dossier standard

Draft v1, 2026-11-01. Linear TH-13. Applies to every folder under `cast/`. Myke approves this standard through the pull request (TF-DEC-19).

## Recommendations (decisions made in this draft)

- **Birth years.** 1962 to 1985, skewing senior. The v1 cast runs 1962 (Gilbert) to 1975 (Ingrid).
- **Minimum counts per dossier.** 3 family entries, 2 degrees, 5 career entries (the ThoughtForge Panel entry counts), 4 fictional associates, 3 professional organizations, 2 persona skills plus a `gdelt-lens` skill, and the three shared skills. 8 real-Voice network entries once TF-OPEN-08 is ruled; until then `network_status` is `pending_tf_open_08` and `network[]` is empty.
- **Evidence tags.** `FIC` (invented), `REAL-ORG` (real institution), `VOICE` (real person from the Supabase people spine, with `person_id`). Career lines read `REAL-ORG employer, FIC role`: the firm is real and the person holding the role is not.
- **No singular officer titles at real firms.** A fictional person never holds a title only one real person can hold (CEO, general counsel, CTO, commissioner, president). Use titles many people hold at once (director, partner, senior counsel, managing director, distinguished engineer).
- **Real projects stay generic.** Shared history names the kind of project and the region ("a liquid-cooled AI campus in the Midwest"), never a real campus name, a real deal's terms or a real executive.
- **Validator has no external dependencies.** `scripts/validate-cast.mjs` runs on Node 20 with no packages. `cast/_schema/persona.schema.json` remains the contract for a later ajv check.

## Rules (ruled)

- The cast of 10 and their roles come only from the ThoughtForge Cast Sheet v1 (TF-DEC-31, TF-DEC-32). Voice briefs are copied verbatim and never rewritten.
- Real institutions, fictional people: degrees from real universities, careers at real firms, memberships in real organizations. Every family member, mentor and colleague is fictional (TF-DEC-41).
- Gilbert Faraday's and Mach Eigen's Brand Bible 5.0 biographies are background for their prior careers only (TF-DEC-38).
- The staff keeps a strong bias toward women with senior-statesperson register (TF-DEC-16). Six of the ten are women.
- Archetype or register references in the decision log never appear in a dossier, bio, skill, voice brief or any user-facing string (TF-DEC-13).
- The LinkedIn-style bio is rendered in-app only and is never posted to LinkedIn (TF-DEC-43).
- The repo copy under `cast/<slug>/` is canonical; the Notion page under the Cast Sheet is a read-only mirror (TF-DEC-40).
- Every panelist carries a GDELT lens built on the shared `gdelt-research` skill; write-back stays behind `CAST_GDELT_WRITEBACK=false` until the GDELT pack's Gate 1 (TF-DEC-42).

## Open (not ruled)

- **TF-OPEN-08, network wording.** The plan lists real Voices from the Supabase `people` spine as followed, cited or shared-room contacts with a named venue, never as friends, mentors or endorsers, and never in voice, avatar or user-facing dialogue. Until Myke rules, every `network[]` is empty and every dossier's Network section is marked pending.

## Dossier outline (`cast/<slug>/dossier.md`)

1. Decisions made
2. Identity
3. Backstory (two to three short paragraphs)
4. Family
5. Academics
6. Career timeline (dated)
7. Licenses and credentials (if any)
8. Associates (fictional, ids from `cast/_shared/associates.json`)
9. Shared history with the panel (ids from `cast/_shared/relationships.json`)
10. Network (real Voices) — pending TF-OPEN-08
11. Professional organizations
12. Publications and talks (fictional titles, real venues)
13. Skills manifest
14. GDELT lens
15. Voice brief (copied from the Cast Sheet)

## Folder layout

```
cast/
  _schema/persona.schema.json
  _template/{dossier.md, persona.json, linkedin.md}
  _shared/{associates.json, relationships.json, timeline.md, real-orgs.yaml}
  _shared/skills/{gdelt-research, evidence-ladder, faraday-retrieval}/SKILL.md
  <slug>/{dossier.md, persona.json, linkedin.md, network.draft.yaml}
  <slug>/skills/<skill>/SKILL.md
```

## Consistency rules enforced by `npm run validate:cast`

- Every persona.json has the required fields and minimum counts above.
- Every associate and relationship id a persona references exists, and every relationship lists the persona as a participant.
- Every relationship's participants each list it, and every panelist appears in at least three relationships.
- No two panelists work at the same employer in overlapping years unless a relationship joins them (the ThoughtForge Panel entry is exempt).
- No fictional name (panelist, family, associate) appears in any `network[]`.
- Every skill path in the manifest exists.
