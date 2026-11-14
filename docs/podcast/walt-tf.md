# Walt-TF: Panel Podcast audio producer (TH-38, PP-04)

`pnpm walt:tf <episode_id>` turns one scripted `tf_episodes` row into an episode MP3: one ElevenLabs request per turn in the
right panelist's voice, an ffmpeg mixdown, an upload to R2, and the row moved to `audio_ready`. Audio only; video is PP-09.

```
pnpm walt:tf PP-20261107-01 --dry-run          # plan only: no network, no database, no ffmpeg (reads a local episode-row.json)
pnpm walt:tf PP-20261101-01                    # live: TTS -> mixdown -> R2 -> tf_episodes
pnpm walt:tf PP-20261101-01 --regen-turn 7     # re-voice one bad turn, reuse the others, re-mix, re-upload
pnpm walt:tf PP-20261101-01 --regen audio      # rebuild the mixdown from cached turns and re-upload
pnpm walt:tf PP-20261101-01 --regen all        # re-voice every turn
pnpm walt:tf PP-20261101-01 --video            # stub: prints "video is PP-09"
```

## Environment (names only)

Read from `process.env`, or from `.env.local` after `vercel env pull .env.local` in the linked checkout. Nothing is written
to a credentials file and no value is ever printed. A missing variable stops the run with one line naming it.

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | must name `ycadmmngkdhvpcsrcuaq`; the decoy `xgbpmlkanxewtfizloay` is refused |
| `SUPABASE_SERVICE_ROLE_KEY` | writes to `tf_episodes` |
| `ELEVENLABS_API_KEY` | voices list, pronunciation dictionary, TTS |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | S3-compatible endpoint `https://<account>.r2.cloudflarestorage.com` |
| `R2_BUCKET` | must be `thoughtforge-episodes` |
| `R2_PUBLIC_BASE_URL` | the bucket's public domain; `audio_url` = `<base>/episodes/<episode_id>/audio.mp3` |

`HEYGEN_API_KEY` is not read until PP-09. `ffmpeg` and `ffprobe` must be on `PATH`.

## What a run does

1. Loads the row. Runs on `scripted` or `failed`; on `audio_ready` only with `--regen`. If `audio_url` is already set and
   there is no `--regen`, it prints the URL and exits 0 (idempotent).
2. Validates `script` against the PP-03 zod schema and checks every speaker has `elevenLabsVoiceName` in
   `src/data/panel.ts`. A speaker without one stops the run with one line naming the slug. There is no fallback voice.
3. Resolves each voice name to a `voice_id` with `GET /v1/voices` (exact name; zero or several matches stop the run) and
   records the ids in `podcast/voice-ids.json`. Ids are not secrets; commit the file after the first live run.
4. Ensures the ElevenLabs pronunciation dictionary `thoughtforge-podcast` exists, built from `podcast/pronunciation.json`
   (alias rules only, which `eleven_multilingual_v2` honours). Its id, version and a hash of the rules are cached in
   `podcast/pronunciation-dictionary.json` (commit it). When the rules file changes, the next run pushes the new rules.
5. Voices each turn: `POST /v1/text-to-speech/{voice_id}`, model `eleven_multilingual_v2`, stability 0.5, similarity 0.75,
   style 0.2, `mp3_44100_128`, the dictionary locator on every call, concurrency 3, 429 and 5xx retried 3 times with
   backoff. Files land in `out/podcast/<episode_id>/turns/NNN-<slug>.mp3` (gitignored) and are reused for 7 days.
6. Mixdown: 350 ms of silence between turns, 900 ms between segments, `loudnorm I=-16 TP=-1.5 LRA=11`, 44.1 kHz mono
   throughout; writes `audio.mp3` (128 kbps) and `audio.wav` (master). Duration from ffprobe. Outside 9:00 to 15:30 the
   row is set to `failed` with `failure_reason`, and nothing is uploaded.
7. Uploads `audio.mp3` to `thoughtforge-episodes/episodes/<episode_id>/audio.mp3` (one retry).
8. Updates the row: `audio_url`, `duration_seconds`, `status = 'audio_ready'`, `failure_reason = null`. If that write fails
   the R2 object is deleted and the run exits non-zero.
9. Prints one report block: episode, cast, duration, URL, word count, turn counts, warnings. Log lines are in US Central.

## How it differs from Walt (Throughline)

| Walt (Throughline) | Walt-TF |
|---|---|
| One historical figure per run | Three panelists per episode, turns interleaved in script order |
| Character row in Airtable | Cast manifest `src/data/panel.ts` and `cast/<slug>/` |
| Voice cloned from a reference | Never cloned (TF-DEC-13/16): a named voice already in My Voices, resolved by exact name |
| Keys in `~/.config/walt/*.key`, and one embedded in the skill file | `process.env` only (TF-DEC-66) |
| `throughline-clips`, Supabase `clips`, Airtable Video Vault | `thoughtforge-episodes`, `tf_episodes`, no Airtable |
| HeyGen photo-avatar video | Audio only; video is PP-09 |

Kept from Walt: the generate mode (an import mode can come later), the idempotency check, R2 upload with one retry, R2
rollback on a Supabase write failure, one concise report.

**Key rotation.** The Throughline Walt skill file embeds a literal ElevenLabs key. Walt-TF does not copy that pattern.
Myke should rotate that key in ElevenLabs and remove it from the skill file.

## Voices

Confirmed by Myke (TH-38 update, 2026-11-02): `gilbert-faraday` = "Gil Faraday", `mach-eigen` = "Mach Eigen - Articulate
Engineering Professor". The names for `margo-brandt`, `albert-thorne` and `ingrid-halverson` in `src/data/panel.ts` are the
library voices proposed in TH-38 and still need Myke's listen-and-confirm; the other five panelists have no voice yet and
cannot appear on an episode until they do.

## Migrations

- `supabase/migrations/20261114204547_tf_episodes_compat.sql`: creates `tf_episodes` with the PP-03 shape if it is missing
  (it was not in production on 2026-11-14), additive statements only.
- `supabase/migrations/20261114204605_th38_tf_episodes_failure_reason.sql`: adds `failure_reason text`.

### Rollback

- failure_reason: `alter table public.tf_episodes drop column if exists failure_reason;`
- compat, only if it created the table and the table is still empty:
  `drop table if exists public.tf_episodes; drop function if exists public.tf_episodes_touch();`
  (per CLAUDE.md, retire the function by rename and revoke instead of dropping it if anything references it).

## Tests

`scripts/tests/walt-tf.test.ts`: a fake ElevenLabs server on 127.0.0.1 returning short MP3s, real ffmpeg on fixtures
(skipped with a message when ffmpeg is absent; CI installs it), an in-memory R2 store and episode repo. Covers the turn
plan and gaps, the duration gate, idempotency, the missing-voice path, voice-name resolution, the dictionary cache, the
429 retry, R2 rollback on a Supabase failure, `--regen-turn`, `--video`, and a dry run that makes no network calls.
