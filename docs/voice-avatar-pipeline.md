# Voice and avatar pipeline (TH-4)

Each panelist gets one voice and one HeyGen avatar. The voice map lives in `cast/_shared/voices.yaml`; the avatar looks live in `src/data/panel.ts`.

## Rules

- Voices are HeyGen library voices on the ElevenLabs engine. No voice is cloned from anyone, and no real person's name, voice or likeness is used (TF-DEC-13, TF-DEC-45).
- Avatars are the original HeyGen looks already chosen for the headshots (`chosenLookId`, else `heygenGroupId`).
- Voice gender follows the panelist's backstory. Six of the ten are women, matching the register check.
- Nothing is rendered until Myke confirms the voices. Any HeyGen or ElevenLabs spend above the existing plans needs Myke's go.

## Steps

1. **Propose** (done in this PR). `voices.yaml` has `status: proposed`, a voice per panelist, the reason for the pick and a short intro line.
2. **Confirm.** Myke listens to the previews, swaps any voice, and sets `status: confirmed`.
3. **Plan.** `npm run plan:voices` checks the map against `panel.ts`, then prints each pairing and the estimated audio length. It makes no API calls. The intros total about 88 seconds.
4. **Render one, then the rest.** Render Gilbert's intro first as a test: his avatar look, his voice and his intro line, through HeyGen's avatar video tool. Check the lip sync and the credit cost. Only after Myke approves that cost, render the other nine.
5. **Record.** Write each video id back to `voices.yaml` and set `status: rendered`. The Meet the Panel page can then play the intro on each bio.

## Checks

- `npm test` includes `scripts/tests/voices.test.ts`. It checks that every panelist has one distinct voice, the gender count, that no intro names an archetype, and that every intro is 15 seconds or less.
- The cast audit (`npm run audit:cast`) still passes. The intros are short and use only the panelists' own fictional names.
