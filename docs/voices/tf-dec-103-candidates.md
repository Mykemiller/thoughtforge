# TF-DEC-103: region-matched voice candidates for eight panelists

Date: 2026-11-06 (US Central). Decision TF-DEC-103: every panelist voice except Margo Brandt's and Mach Eigen's sounds too British, so each is re-cast to the accent of the panelist's home region in the cast dossier. This document proposes candidates only. **No voice id in code or in `cast/_shared/voices.yaml` changes here**; Myke picks by ear from the previews below and a follow-up change wires the picks.

Rules followed: ElevenLabs was used only to search the shared voice library (`GET /v1/shared-voices`) and read voice metadata (`GET /v2/voices`). No voice was created, cloned, edited or deleted, and no audio was generated beyond the library's own free preview URLs. Every candidate is an original library persona; none is named after or imitates a real person (TF-DEC-13). Any library voice tagged with a British or English accent was excluded.

## Unchanged

| Panelist | Voice | Status |
| --- | --- | --- |
| Margo Brandt | "Sarah - Mature, Reassuring, Confident" (library voice, as wired in `src/data/panel.ts`) | unchanged |
| Mach Eigen | "Mach Eigen - Articulate Engineering Professor" (My Voices) | unchanged |

## Home regions from the cast dossiers

Source for each row: `cast/<slug>/persona.json` (`born_year`, `hometown`, `voice_brief`) and `cast/<slug>/dossier.md` v2 (Identity and Backstory sections). Gender presentation follows the dossier pronouns and the `gender` field in `cast/_shared/voices.yaml`.

| Panelist (slug) | Home region (birth and upbringing) | Born (age in 2026) | Gender | Voice brief (Cast Sheet, verbatim) |
| --- | --- | --- | --- | --- |
| Gilbert Faraday (`gilbert-faraday`) | Tacoma, Washington; grew up on the Tacoma waterfront (Pacific Northwest) | 1962 (64) | male | Measured, dry, never hurried. Asks one clarifying question, lets the room argue, then rules in a sentence and names what evidence would change his mind. Speaks last. |
| Delia Marchetti (`delia-marchetti`) | Joliet, Illinois; grew up in Joliet (Chicagoland) | 1976 (50) | female | Fast, wry, warm. Restates the engineering answer in two sentences a county commissioner would understand, and flags what will be misquoted. |
| Albert Thorne (`albert-thorne`) | Born Columbus, Ohio; grew up in Mansfield, Ohio | 1968 (58) | male | Precise, academic, unflappable. Cites the docket, the tariff section, the queue position. Distinguishes what the rule says from how the ISO actually behaves. |
| Hartford Caldwell, "Hart" (`hartford-caldwell`; see note on the TF-DEC-92 rename) | Richmond, Virginia; grew up in Richmond | 1970 (56) | male | Prepared, policy-dense, dry wit. Opens with the exposure, closes with the mitigation. Can brake a recommendation that creates legal or consent risk. |
| Rosalind Ferraro, "Rose" (`rosalind-ferraro`) | Chicago, Illinois (Bridgeport); grew up in Bridgeport | 1978 (48) | female | Relentless drive and vote-counting instinct, delivered with warmth, directness, and moral clarity. Knows who is in the room at the zoning hearing and why. Names the community cost before anyone else does. |
| Victoria Stroud, "Vick" (`victoria-stroud`) | Charlotte, North Carolina; grew up in Charlotte | 1972 (54) | female | Quiet authority, numbers first, sparing with words. Converts every technical choice into cost of capital and exit value. Not impressed by narrative. |
| Dr. Ingrid Halverson (`ingrid-halverson`) | Fargo, North Dakota; grew up in Fargo | 1975 (51) | female | Curious, exact, allergic to hand-waving. Starts from heat flux and works outward. Will correct a unit mid-sentence. Only her closest friends call her Doc; the panel does not. |
| Constance Wright (`constance-wright`) | Baltimore, Maryland; grew up in Baltimore | 1969 (57) | female | Unsparing, brief, cites or strikes. Grades every claim the panel makes before the Chief of Staff rules. A projection is never SRC. Says "unsourced" out loud. |

No panelist is UNCLEAR: all eight carry a `hometown` and a "grew up in" line in the v2 dossier Backstory.

**Note on Hart's slug.** The task names him `hartford-nakamura` (renamed from Hartford Caldwell per TF-DEC-92). On `main` as of this branch the dossier folder, `src/data/panel.ts` and `cast/_shared/voices.yaml` still use `hartford-caldwell`; only `src/email/panelists.test.ts` references `hartford-nakamura` (as an alias that resolves to the same inbox). The home region (born 1970, Richmond, Virginia) is the same under either name and was read from `cast/hartford-caldwell/persona.json` and `dossier.md`.

## Accent mapping

The ElevenLabs shared library tags accent as a free-text label (filter `accent=`). The mapping below uses the labels that exist in the library; where a region has no label of its own, the nearest label is used and the reason is stated.

| Panelist | Home region | ElevenLabs accent filter | Why |
| --- | --- | --- | --- |
| Gilbert Faraday | Tacoma, WA | American (general) | The Pacific Northwest is the textbook General American region; there is no separate library label for it. |
| Delia Marchetti | Joliet, IL | American Midwest | Joliet is Chicagoland, Inland North dialect; the library's Midwest label is the closest tag. |
| Albert Thorne | Columbus / Mansfield, OH | American Midwest | Central Ohio is Midland speech, which the library files under its Midwest label. |
| Hartford Caldwell | Richmond, VA | American Southern | Richmond is Tidewater Virginia; a light, educated Southern label fits better than general American for a 1970 Richmond upbringing. |
| Rosalind Ferraro | Chicago, IL (Bridgeport) | American Midwest (Chicago where tagged) | Bridgeport is a South Side neighbourhood with a strong Chicago accent; the library has no reliable Chicago-only label, so Midwest is the filter and any voice tagged Chicago is preferred. |
| Victoria Stroud | Charlotte, NC | American Southern | Piedmont North Carolina; a restrained Southern label suits a Charlotte banker. |
| Dr. Ingrid Halverson | Fargo, ND | American Midwest | Upper Midwest, North Central dialect; the Midwest label is the nearest tag. |
| Constance Wright | Baltimore, MD | American (general), Mid-Atlantic where tagged | Baltimore speech is Mid-Atlantic; the library has no Baltimore label, so general American is the filter and any voice tagged Mid-Atlantic or East Coast is preferred. |

## Candidates: BLOCKED on an ElevenLabs key with the Voices Read scope

The candidate tables could not be produced in this pass. Every ElevenLabs read endpoint answered:

```
401 {"detail":{"type":"authentication_error","code":"unauthorized",
  "message":"The API key you used is missing the permission voices_read to execute this operation.",
  "status":"missing_permissions"}}
```

Three keys were tried through the session's secure credential store (never printed or logged); all three lacked `voices_read`, and `user_read` and `models_read` were missing too, which is the shape of a text-to-speech-only restricted key. Note that `vercel env pull` cannot help here either: the project's secrets are stored as type `sensitive` (see `.env.example`), which Vercel never returns.

To finish, create a key in ElevenLabs (Developers, API Keys, restricted access) with only **Voices: Read** enabled, set it as `ELEVENLABS_API_KEY` in an untracked local shell, and run the queries below. No other scope is needed; nothing here creates, clones, edits or deletes a voice or generates audio.

### Queries to run (read-only)

```bash
# Account voices (My Voices + default premade), with labels and preview URLs
curl -s -H "xi-api-key: $ELEVENLABS_API_KEY" \
  "https://api.elevenlabs.io/v2/voices?page_size=100" \
  | jq -r '.voices[] | [.voice_id, .name, .category, .labels.accent, .labels.gender, .labels.age, .labels.use_case, .preview_url] | @tsv'

# Shared voice library, one call per panelist filter (use_case narrative_story or conversational)
for q in \
  "gender=male&age=old&accent=american" \
  "gender=female&age=middle_aged&accent=american-midwest" \
  "gender=male&age=middle_aged&accent=american-midwest" \
  "gender=male&age=middle_aged&accent=american-southern" \
  "gender=female&age=middle_aged&accent=american-southern" \
  "gender=female&age=middle_aged&accent=american"; do
  curl -s -H "xi-api-key: $ELEVENLABS_API_KEY" \
    "https://api.elevenlabs.io/v1/shared-voices?page_size=100&language=en&use_case=narrative_story&$q" \
    | jq -r '.voices[] | select((.accent|ascii_downcase|test("brit|english|uk"))|not) | [.voice_id, .name, .accent, .age, .gender, .use_case, .preview_url, .description] | @tsv'
done
```

Accent label spellings vary in the library (for example `american`, `american-southern`, `us-midwest`, `midwestern`); run one unfiltered pull per gender and age first and read the distinct `accent` values before filtering. Exclude any voice whose accent or description says British, English or UK, and any voice named after or imitating a real person.

### Selection rule for the tables

For each panelist pick the 3 best matches on accent, age band and the voice brief above, recommended pick first, in this shape:

| Rank | Candidate name | voice_id | Accent | Age | Gender | Preview | Why it fits the voice brief |
| --- | --- | --- | --- | --- | --- | --- | --- |

Age bands: Gilbert `old` (64, also accept `middle_aged`); all others `middle_aged` (48 to 58). Use case `narrative_story` first, then `conversational` and `informative_educational` if a filter returns fewer than three fits.

### Interim: premade voices already in My Voices (unverified, from memory)

ElevenLabs ships a set of premade voices in every account, tagged by ElevenLabs as American. They are listed here only so Myke can start listening in the ElevenLabs app before the library search runs; the labels below are recalled, not read from the API, and must be confirmed by the queries above before any of them is wired. Resolution is by exact name at run time (TF-DEC-78), so no ids are given.

| Panelist | Premade voices to try first | Caveat |
| --- | --- | --- |
| Gilbert Faraday | Bill (older, trustworthy), Roger (confident), Brian (deep, resonant) | Bill is the only premade tagged old; the others read middle-aged. |
| Delia Marchetti | Matilda (middle-aged, friendly), Jessica (expressive), Laura (upbeat) | Only Matilda reads middle-aged; Jessica and Laura read young. |
| Albert Thorne | Brian (deep, resonant), Eric (friendly, clear), Chris (casual) | Brian is his current voice; TF-DEC-103 says it still reads British, so weigh Eric and Chris first. |
| Hartford Caldwell | Roger, Eric, Bill | No premade is tagged Southern; a real Southern match needs the library search. |
| Rosalind Ferraro | Matilda, Jessica, Laura | Same age caveat as Delia; no premade is tagged Midwest or Chicago. |
| Victoria Stroud | Matilda, Sarah (reassuring, confident) | Sarah is Margo's voice and stays hers; listed only as a register reference, not a pick. |
| Dr. Ingrid Halverson | Matilda, Jessica | Matilda is her current voice. |
| Constance Wright | Matilda, Jessica, Laura | Same age caveat. |

Excluded from every interim row: Lily, Alice, George, Daniel (British), Callum (transatlantic), Charlotte (Swedish).
