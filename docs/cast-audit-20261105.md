# Cast audit 2026-11-05

Generated Nov 5, 2026, 5:59 PM CT by `npm run audit:cast` (Linear TH-30). Overall: **PASS**. This report is input to Myke's sign-off, which stays his; nothing from the cast reaches production, ElevenLabs or HeyGen until he signs.

| # | Check | Result |
| --- | --- | --- |
| 1 | Real-name audit | PASS |
| 2 | Network provenance | PASS |
| 3 | Cross-dossier consistency | PASS |
| 4 | Register check | PASS |
| 5 | Prompt budget | PASS |
| 6 | Evidence tags | PASS |

## 1. Real-name audit: PASS

687 distinct proper nouns. Classified per file: FIC 354, REAL-ORG 516, REAL-EVENT 0, VOICE 152, reviewed non-person 554, unclassified 0. Spine scan 2026-11-05 over this candidate list against all 1734 people: 25 full-name matches, each checked above against the panelist's network. Full pass covered 669 of the 671 phrases; a second pass covered all 299 two- and three-word, name-shaped phrases. Neither pass found a match outside the networks. Refreshed 2026-11-01 21:25 CT for TH-32: the app's UI copy and prompt text joined the candidate list (7 new phrases: Ask the Panel, Enter, Fact-Checker, Faraday Intelligence, Meet the Panel, Panel, ThoughtForge Faraday Intelligence); all 7 were checked read-only against all 1,734 people (equal canonical name, equal alias, or containing a full canonical name) with no match. The 25 earlier matches are unchanged. Refreshed 2026-11-05 for TH-49: the two new UI phrases (Interviews, You) were checked through the connector against all 1,734 people and matched nobody; the earlier matches are unchanged. Refreshed again for TH-50: the new phrase "ElevenLabs" (vendor name in voice copy) was checked through the connector against all 1,734 people and matched nobody. Refreshed 2026-11-05 18:05 CT for TH-47: src/email joined the candidate list; the six new phrases (Faraday Daily Signal Digest, Faraday Signal, Faraday Signal Digest, Gmail, Signal, Signal Digest) were checked read-only through the Supabase connector against all 1,734 people (equal canonical name, equal alias, or containing a full canonical name) and matched nobody; the earlier matches are unchanged.

No exceptions.

## 2. Network provenance: PASS

76 network entries across 10 panelists resolved against ycadmmngkdhvpcsrcuaq (snapshot 2026-11-01, Myke's ruling 2026-11-01). Waivers on file: 0.

No exceptions.

## 3. Cross-dossier consistency: PASS

26 relationships checked against both participants' dossiers, persona.json and career dates; employer overlaps checked across all pairs.

No exceptions.

## 4. Register check: PASS

6 of 10 panelists are women (constance-wright, delia-marchetti, ingrid-halverson, margo-brandt, rosalind-ferraro, victoria-stroud), each born 1980 or earlier with 20+ years of career. All 10 voice briefs match Cast Sheet v1 word for word. Register is a heuristic; the read is Myke's.

No exceptions.

## 5. Prompt budget: PASS

Provisional composition until the cast loader (TH-27) fixes it: role and domains, voice brief and sample, Backstory and Life outside work, the panelist's three skills and the three shared skills. Estimated at 3.5 characters per token. Per panelist: albert-thorne 3371, constance-wright 3393, delia-marchetti 3405, gilbert-faraday 3613, hartford-caldwell 3425, ingrid-halverson 3415, mach-eigen 3508, margo-brandt 3470, rosalind-ferraro 3523, victoria-stroud 3374. Limit 6000.

No exceptions.

## 6. Evidence tags: PASS

441 dossier fact lines checked for FIC, REAL-ORG, REAL-EVENT or VOICE. 77 bio Experience and Education entries traced to tagged persona.json facts (the in-app bio carries no inline tags).

No exceptions.
