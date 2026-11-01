# Network rules

Linear TH-15. TF-OPEN-08 ruled by Myke 2026-11-01: connections to real people date from before 2025 and run through public settings (conferences, commission proceedings, published work, sports, concerts, travel).

## Vocabulary

- `follows`: the panelist reads this person's published output.
- `cites`: the panelist has referenced this person's work in a panel answer.
- `shared_room`: the same conference track, docket or working group, with the venue named.

Forbidden: friend, mentor, endorsed, worked_for.

## Rules

- Every entry resolves to a row in Supabase `people` on project `ycadmmngkdhvpcsrcuaq` (read-only, anon key, guard assertion first).
- Unresolved names go to `cast/<slug>/network.unresolved.yaml` for Myke's review; they are never dropped silently and never added to `people`.
- Real names never appear in voice, avatar or user-facing dialogue (TF-DEC-13).
- Every entry carries `since`, a year before 2025.
- No private relationship, quote or opinion is attributed to a real person.
- Networks are curated by hand from the people spine (6 to 8 per panelist on 2026-11-01). The curated list lives in `cast/<slug>/network.draft.yaml`; `network.json` is always the resolver's output, never edited by hand.

## Resolver (`scripts/resolve-network.ts`)

```
npm run resolve:network -- --slug albert-thorne      # live, anon key from .env.local
npm run resolve:network -- --all                     # every panelist
npm run resolve:network:snapshot                     # every panelist, offline snapshot
npm run resolve:network:dry                          # 3-name fixture, prints only
npm test                                             # offline tests, including the fixture
```

- Input: `cast/<slug>/network.draft.yaml` with `name`, `relationship_kind`, `venue`, `since`, `evidence` and an optional `expected_person_id`.
- Output: `cast/<slug>/network.json` with `person_id`, canonical name, current affiliation, `primary_domain_code`, IDF domain tags (primary first) and `resolution: exact|alias`. Anything else goes to `cast/<slug>/network.unresolved.yaml` with a reason, and the run exits 2.
- Matching: case-insensitive equality on `people.canonical_name`, then exact match in `people.aliases`. More than one match, a person_id that differs from `expected_person_id`, a duplicate person, a forbidden or unknown kind, or a `since` of 2025 or later are all unresolved, never guessed.
- Officeholders take their current seat from `office_occupancies` joined to `offices` (DEC-IDF-07), so a seat change needs no edit to the draft. Everyone else takes the most recent current row in `person_affiliations`.
- Guard, in order: the URL's project ref must be `ycadmmngkdhvpcsrcuaq` (the decoy `xgbpmlkanxewtfizloay` is refused by name); the key must be an anon or publishable key (a `service_role` JWT or `sb_secret_` key aborts); then a one-row schema probe of each table, which aborts if a column is missing or the anon key sees no rows.
- `--snapshot <file>` runs the same logic over a JSON snapshot instead of the live database. `cast/_fixtures/people-snapshot.json` holds only the rows the cast and the fixture need, taken read-only on 2026-11-01. Refresh it when a network changes.

## Schema notes (read 2026-11-01)

- `people`: `person_id` (uuid), `canonical_name`, `aliases` (text array), `primary_domain_code`, `primary_subdomain_code`, `follow_state`, plus confidence and freshness fields.
- `person_affiliations`: `person_id`, `employer_name`, `role_title`, `valid_from`, `valid_to`, `is_current`.
- `person_domain_tags`: `person_id`, `subdomain_code`, `is_primary`, `basis`, `evidence` (jsonb).
- `faraday_domains`: D1 to D23. Note: D5 is Hyperscaler Activity and D13 is Community Relations, which differ from the Cast Sheet's labels for Delia (D5 Markets) and Hart (D13 Permitting).
- `offices` (475 rows): `office_id`, `office_name`, `seat_identifier`, `jurisdiction_id`. `office_occupancies` (475 rows): `office_id`, `person_id`, `role_title`, `valid_from`, `valid_to`, `succeeded_by`. Most occupancies have no dates yet, so "current" means `valid_to` is empty or today or later.
- **Surprise: the anon key cannot read the spine.** `people`, `person_affiliations`, `person_domain_tags`, `offices` and `office_occupancies` all have row level security on and no policy for the `anon` role, so a live run with the anon key sees zero rows. The resolver aborts in that case instead of marking every name unresolved. Until a read path exists, use `--snapshot`. The narrowest fix is a read-only function such as `resolve_people(names text[])`, granted to `anon`, that returns only person_id, canonical name, current affiliation and domain tags; a table-wide anon SELECT policy would expose all 1,734 rows to anyone holding the public key. Not applied: it is a database change and needs Myke's call.
- Some people carry two current affiliation rows for the same job (for example a free-text row and an SEC-sourced row). The resolver picks the most recent `valid_from`, so SEC-dated rows win.
