# Network rules (draft, pending TF-OPEN-08)

Linear TH-15. Nothing in this file is live until Myke rules on TF-OPEN-08.

## Proposed vocabulary

- `follows`: the panelist reads this person's published output.
- `cites`: the panelist has referenced this person's work in a panel answer.
- `shared_room`: the same conference track, docket or working group, with the venue named.

Forbidden: friend, mentor, endorsed, worked_for.

## Proposed rules

- Every entry resolves to a row in Supabase `people` on project `ycadmmngkdhvpcsrcuaq` (read-only, anon key, guard assertion first).
- Unresolved names go to `cast/<slug>/network.unresolved.yaml` for Myke's review; they are never dropped silently and never added to `people`.
- Real names never appear in voice, avatar or user-facing dialogue (TF-DEC-13).

## Schema notes (read 2026-11-01)

- `people`: `person_id` (uuid), `canonical_name`, `aliases` (text array), `primary_domain_code`, `primary_subdomain_code`, `follow_state`, plus confidence and freshness fields.
- `person_affiliations`: `person_id`, `employer_name`, `role_title`, `valid_from`, `valid_to`, `is_current`.
- `person_domain_tags`: `person_id`, `subdomain_code`, `is_primary`, `basis`, `evidence` (jsonb).
- `faraday_domains`: D1 to D23. Note: D5 is Hyperscaler Activity and D13 is Community Relations, which differ from the Cast Sheet's labels for Delia (D5 Markets) and Hart (D13 Permitting).
