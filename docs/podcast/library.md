# Podcast Library, home card and RSS feed (TH-39, PP-05)

Public pages (no access gate; `proxy.ts` is untouched). They read `tf_episodes` through the anon key, so RLS policy
`tf_episodes_anon_read_published` limits them to `status = 'published'`; the queries filter on it too.

| Route | What it shows | Cache |
|---|---|---|
| `/` | "Latest episode" card below the hero (title, date in US Central, duration, on-mic headshots, play button). Not rendered when nothing is published. | ISR 5 min |
| `/podcast` | Published episodes, newest first, 20 per page (`?before=<published_at>` keyset cursor), play button per row | per request |
| `/podcast/[episode_id]` | Player, the three signals (source links open in a new tab), cast strip linking to `/panel/<slug>`, show notes (Markdown via react-markdown + rehype-sanitize), Transcript disclosure | per request |
| `/podcast/feed.xml` | RSS 2.0 + iTunes namespace, one `<item>` per published episode with audio | 5 min (`revalidate` + `Cache-Control`) |
| `/sitemap.xml` | adds `/podcast` and every published episode | 1 h |

Player: one sticky bottom `<audio>` for the whole site (`src/components/podcast/PlayerProvider.tsx`, mounted in
`app/layout.tsx`), so only one episode plays at a time; speed 1x / 1.25x / 1.5x.

Show name: `tf_episodes.show`, falling back to "ThoughtForge: The Signal" until TH-35 rules.

If the table is missing, the env is missing or a read fails, the pages log the error and render the empty state
("The first episode is in production"), the home card stays hidden, and the feed is a valid channel with zero items. A
public page never 500s because the podcast is not live yet.

## Feed

URL: **https://faraday-thoughtforge.com/podcast/feed.xml**

Channel: title (show name), link, `atom:link rel=self`, description, `language en-us`, `itunes:author` ThoughtForge,
`itunes:summary`, `itunes:image` (`/podcast/cover-3000.png`), `itunes:explicit false` (Apple's current form of "no"),
`itunes:category Technology`, `itunes:type episodic`, RSS `<image>` (`/podcast/cover-600.png`).

Item: title, link, `<guid isPermaLink="false">episode_id</guid>`, `pubDate` (RFC 822, from `published_at`), description
and `itunes:summary` (signals discussed), `<enclosure url length type="audio/mpeg">`, `itunes:duration` (HH:MM:SS),
`itunes:explicit`, `itunes:episodeType full`. `length` is `tf_episodes.audio_bytes` (migration
`20261114205430_th39_tf_episodes_audio_bytes.sql`), `0` while null. Episodes without `audio_url` are left out.

Validate after the first published episode (TH-40): https://podba.se/validate/ or https://www.castfeedvalidator.com/

## Submitting later (links only)

- Apple Podcasts: https://podcasters.apple.com/support/897-submit-a-show
- Spotify for Creators: https://support.spotify.com/us/creators/article/getting-your-podcast-on-spotify/
- Apple feed requirements: https://podcasters.apple.com/support/823-podcast-requirements

## Cover art

`npm run podcast:cover` writes `public/podcast/cover-3000.png` and `cover-600.png` (committed) with sharp. There is no
monogram SVG in the repo yet (the approved Primary Monogram PNG from TH-10 has not landed; `src/components/Monogram.tsx`
is a CSS placeholder), so the script draws that monogram as SVG with the TF-DEC-34 lightning-bolt slash and the
`app/globals.css` tokens (TF-DEC-33 placeholders). No panelist likeness. Re-run when the approved monogram or final hexes land.

## Mock mode and screenshots

`TF_MOCK=1` reads `fixtures/podcast/library.json` (two published episodes, one with `show` and `audio_bytes` null to
exercise the fallbacks, and one `audio_ready` draft that must never render). `TF_MOCK` is not set on the Vercel project.

```
TF_MOCK=1 npm run build && npm run podcast:screenshots   # docs/podcast/screenshots/*.png, fails on mobile horizontal scroll
```

## Migrations

- `20261114204547_tf_episodes_compat.sql`: creates `tf_episodes` with the PP-03 end state if it is missing (it was not in
  production on 2026-11-14). Byte-identical copy in the TH-38 PR; whichever merges first carries it.
- `20261114205430_th39_tf_episodes_audio_bytes.sql`: `audio_bytes bigint` (non-negative), nullable.

### Rollback

- audio_bytes: `alter table public.tf_episodes drop column if exists audio_bytes;`
- compat: see docs/podcast/walt-tf.md#rollback (TH-38) or, if TH-39 merges first, the same statements: drop the table only
  if this file created it and it is still empty; retire `tf_episodes_touch()` by rename and revoke, never DROP FUNCTION.

## Follow-ups

- walt-tf (TH-38) should write `audio_bytes` after upload, once both PRs are merged.
- "At least one published episode" checks (home card visible, `/podcast` lists it, feed validates) move to TH-40.
