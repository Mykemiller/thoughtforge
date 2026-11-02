# Artifact inbox

Drop Markdown files here and run `npm run ingest:artifact -- artifacts/inbox` (or name one file) to add them to `tf_artifacts`, the table the panel retrieves from. Everything in this folder except this README and `_example.md` is git-ignored: the inbox is a staging area, not a corpus.

## File format

YAML front matter, then the artifact text as the body.

```markdown
---
title: Required. The title the panel will cite as [SRC: <title>].
publisher: Optional. Who published it.
url: Optional. If present, re-ingesting the same URL updates the row instead of adding one.
published_at: Optional. YYYY-MM-DD.
source: primary | secondary | panel   (default secondary)
idf_domains: [D2, D3]                 (optional IDF 5.0 domain codes)
tags: [interconnection, midwest]      (optional)
---
The artifact text. Keep it to the substance you have the right to store; the first 600
characters become the excerpt the panelists see in their prompt.
```

`source: primary` is for a government, regulator, utility, ISO/RTO or standards-body document you hold directly; it is the only tier that lets a panelist write `[VRF]`. Everything else is `secondary`. `panel` is reserved for the app's own rulings.

See `docs/artifacts.md` for how sessions become artifacts and how the Faraday library is read.
