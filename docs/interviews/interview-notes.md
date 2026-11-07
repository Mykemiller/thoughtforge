# Interview notes and proposed deltas (TH-52)

After each 1:1 interview (TH-53 to TH-62), one command turns the saved session into
`cast/<slug>/interview-notes.md` and, on its own branch, a reviewed PR of proposed cast deltas.
Nothing merges automatically (TF-DEC-19, TF-DEC-40, TF-DEC-50).

```bash
# 1. Look first: prints the notes file and the delta summary, writes nothing.
npm run interview:notes -- --slug gilbert-faraday --session <tf_sessions id> --dry-run

# 2. Notes plus deltas on branch th-52-notes-<slug>, committed, pushed, draft PR opened with gh.
npm run interview:notes -- --slug gilbert-faraday --session <id> --pr

# 3. Only after Myke has confirmed a dry run: save the Q6 answer as its own tf_artifacts row.
npm run interview:notes -- --slug gilbert-faraday --session <id> --save-midterm

# Then, on the delta branch:
npm run validate:cast && npm run audit:cast && npm test
```

Other flags: `--deltas` writes the persona and dossier proposals to the working tree without
touching git. `--fixture <file.json>` reads a session from a file instead of Supabase
(`scripts/tests/fixtures/interview-session.json` is a fictional Gilbert session).

## What it reads

- `tf_sessions` row with `kind = 'interview'` and `panelist = <slug>` on the project of record
  `ycadmmngkdhvpcsrcuaq`. Before any read: the URL must name the project of record and not the decoy
  `xgbpmlkanxewtfizloay`, and `dc_facilities` must have at least 18000 rows and `artifacts` at
  least 100000. The run stops if the session does not resolve, belongs to another panelist, or
  the slug is not in `src/data/panel.ts` (TH-64 may rename Hartford).
- `cast/<slug>/` (dossier, linkedin, persona), `cast/_fixtures/people-snapshot.json` and the arc
  in `docs/interviews/guide.md`.

## What it writes

- `cast/<slug>/interview-notes.md`: the transcript from `transcriptMarkdown` (the same text the
  saver stores), then "What held, what drifted, what was new", up to five lines each, every line
  tagged `Tn, Ln` (turn, line in the file).
  - Held: the panelist used an anchor the persona already has (hometown, family, employers,
    schools, organisations, hobbies, venues).
  - Drifted: a real person from the people spine outside the panelist's network (TF-DEC-45), and
    any Q6 sentence with a number but no grade (VER, SRC, EST, INF).
  - New: a proper noun that none of the cast files contain. Sentence-initial single words are
    skipped, so the list errs short.
- Proposed deltas, additions only (D2): `persona.json` gains `interview_additions` (verbatim quote,
  turn, line, `status: "proposed"`); `dossier.md` gains a section "Interview additions (proposed,
  TH-52)" at the end. No existing field is rewritten. Myke moves what he keeps into the real
  sections and drops the rest.
- With `--save-midterm`: one `tf_artifacts` row per panelist titled
  "[Temper Mark] <Name> on the 2026 midterms", `source = 'panel'`, tags
  `interview, temper-mark, midterms-2026, panelist:<slug>, from-session:<id>`. It is upserted by the
  `midterms-2026` and `panelist:<slug>` tags. It deliberately carries no `session:<id>` tag, because
  `src/interview/save.ts` finds the transcript artifact by that tag and would overwrite this row.
  Matching rows are exported to `docs/interviews/snapshots/` before the write.

## Guarantees

- Deterministic: a rerun on the same session rewrites byte-identical notes and deltas, including on
  the delta branch, where earlier proposals are kept out of the "already known" corpus.
- Never pushes `main`, never merges, never runs `mirror:cast` (the TH-28 mirror picks the notes up
  on its next publish).
- `audit:cast` scans `interview-notes.md` like the dossier. A real person outside the network in a
  transcript fails the audit on the delta branch. That is the signal to fix it in the PR, not to
  waive it.
