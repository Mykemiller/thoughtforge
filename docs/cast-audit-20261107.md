# Cast audit 2026-11-07

Generated Nov 6, 2026, 11:33 PM CT by `npm run audit:cast` (Linear TH-30). Overall: **WARN**. This report is input to Myke's sign-off, which stays his; nothing from the cast reaches production, ElevenLabs or HeyGen until he signs.

| # | Check | Result |
| --- | --- | --- |
| 1 | Real-name audit | WARN |
| 2 | Network provenance | PASS |
| 3 | Cross-dossier consistency | PASS |
| 4 | Register check | PASS |
| 5 | Prompt budget | PASS |
| 6 | Evidence tags | PASS |

## 1. Real-name audit: WARN

715 distinct proper nouns. Classified per file: FIC 360, REAL-ORG 517, REAL-EVENT 0, VOICE 152, reviewed non-person 582, unclassified 0. Spine scan is stale (taken 2026-11-05 over a different candidate list); rerun it before sign-off.

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

Provisional composition until the cast loader (TH-27) fixes it: role and domains, voice brief and sample, Backstory and Life outside work, the panelist's three skills and the three shared skills. Estimated at 3.5 characters per token. Per panelist: albert-thorne 3371, constance-wright 3393, delia-marchetti 3405, gilbert-faraday 3613, hartford-nakamura 3554, ingrid-halverson 3415, mach-eigen 3508, margo-brandt 3470, rosalind-ferraro 3523, victoria-stroud 3374. Limit 6000.

No exceptions.

## 6. Evidence tags: PASS

443 dossier fact lines checked for FIC, REAL-ORG, REAL-EVENT or VOICE. 77 bio Experience and Education entries traced to tagged persona.json facts (the in-app bio carries no inline tags).

No exceptions.
