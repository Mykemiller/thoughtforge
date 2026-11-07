# Interview face: HeyGen streaming avatar spike (TH-51, Phase 1)

Run: 2026-11-07 04:12–04:40 CT, Claude Code cloud session, branch `th-51-interview-face`.
Prompt: CC-TH-INTERVIEW-FACE-1.0. Phase 1 only. No application code was changed and no database was touched.

## Verdict

**FAIL. Ship the milestone voice-first (TF-DEC-75).**

The bar was: first video frame within 2.5 s of reply text being available, at a per-minute cost no higher than 3× the voice cost.

The spike could not show the bar is met, and the account evidence points the wrong way:

1. **The existing panelist avatars cannot stream.** Mach Eigen's only look (`e153df7a9df9614ef43f329fa6acc24f`, group `b62c9bacbb686ca245ae54f45c3297b0`) is a `photo_avatar`. Its `supported_api_engines` are `avatar_v`, `avatar_iv` and `avatar_iii`. Those are the pre-rendered video engines. No streaming or interactive engine is listed. Margo Brandt's group (`bf3127845753467f8a6b8a68d450176c`) is the same kind of single-look photo avatar group.
2. **Streaming is a separate product.** HeyGen's real-time avatars now run as **LiveAvatar**, with their own credits, a separate price list and their own custom-avatar slots. The account is on the HeyGen **Creator** subscription (523 premium credits, reset 2027-11-02). That subscription has no LiveAvatar line, and published sources say LiveAvatar credits are separate from HeyGen API credits.
3. **Each panelist needs its own LiveAvatar.** A custom LiveAvatar is made by uploading one photo (JPEG or PNG, at least 1080p, facing the camera). Each one uses a paid custom-avatar slot. The ten photo avatar groups do not carry over.
4. **Latency was not measured.** No test session could be opened (see "What blocked the measurement"). The Autonomy rules also say to stop where streaming needs a purchase or an entitlement the account does not have, and both apply here.

Because of 2 and 3, every route to a face costs money above the current plans. TH-4 and the Autonomy section both say that needs Myke's go. The spike therefore cannot pass on its own authority.

## Measurements

| Measure | Bar | Result | How |
|---|---|---|---|
| Time to first frame (session start) | — | **not measured**: no session could be opened | — |
| First frame after reply text is available | ≤ 2.5 s | **not measured** | — |
| Per-utterance latency, median and worst of 3 | — | **not measured** | — |
| Do existing photo avatar groups stream? | yes | **no**: only `avatar_v/iv/iii` engines | HeyGen connector `list_avatar_looks(groupId=b62c9b…)`, 2026-11-07 04:18 CT |
| Streaming entitlement on the account | yes | **none found**: Creator plan, no LiveAvatar credits | HeyGen connector `get_current_user`, 2026-11-07 04:17 CT |
| Separate avatar per panelist | — | **yes**: one custom LiveAvatar (paid slot) per panelist | published LiveAvatar help pages (sources below) |

The published latency claim for LiveAvatar is "low latency" over WebRTC. It is not a number, so the 2.5 s bar can only be tested with a live session.

### Request shapes (no secrets)

- 2026-11-07 04:17 CT — HeyGen connector `get_current_user()`. It returned `subscription.plan = "creator"`, `premium_credits.remaining = 523`, `add_on_credits = null` and `usage_based = null`.
- 2026-11-07 04:17 CT — HeyGen connector `get_avatar_group("b62c9bacbb686ca245ae54f45c3297b0")`. It returned `looks_count = 1`, `status = completed` and `default_voice_id = cd74981d…`.
- 2026-11-07 04:18 CT — HeyGen connector `get_avatar_group("bf3127845753467f8a6b8a68d450176c")` (Margo Brandt, the second panelist under D3). It returned `looks_count = 1` and `status = completed`.
- 2026-11-07 04:18 CT — HeyGen connector `list_avatar_looks(groupId="b62c9bacbb686ca245ae54f45c3297b0")`. It returned one look, `avatar_type = photo_avatar` and `supported_api_engines = ["avatar_v","avatar_iv","avatar_iii"]`.
- 2026-11-07 04:14 CT — `curl https://api.heygen.com/v2/avatars` (no key header). The proxy answered `CONNECT tunnel failed, response 403`, meaning api.heygen.com is not in this session's network allowlist.

## Cost

The figures below come from published sources dated September to October 2026. Most are third-party, and they disagree. Check heygen.com/pricing and the LiveAvatar FAQ before relying on any of them.

| Item | Published figure | Notes |
|---|---|---|
| LiveAvatar Full mode (HeyGen ASR, LLM and TTS) | 2 credits/min (1 credit per 30 s) | Not usable: the room already has its own LLM and ElevenLabs voice |
| LiveAvatar Lite / Avatar Only mode (bring your own audio or text) | 1 credit/min | The mode TH-51 would use |
| LiveAvatar $ per credit | about $0.08–0.20/min of streaming, varying by plan | Sources conflict; older figures of about $3/min are for a retired tier |
| Custom LiveAvatar slot | paid add-on; "contact your account manager" when slots run out | One slot per panelist; price not published |
| Pre-rendered Avatar IV photo avatar video (for comparison) | about $2.31–3.00/min | Not real time |

**Voice baseline (D2):** the room uses `eleven_turbo_v2_5` (TH-50). This is an estimate, not a meter reading. A 10-minute interview speaks about 9,000 characters at about 0.5 credits per character, or about 4,500 ElevenLabs credits. At Creator-plan rates that is about $1 per interview, about $0.10 per minute. **The D2 ceiling is therefore about $0.30 per spoken minute.**

**Reading:** Lite-mode streaming at $0.08–0.20/min would fit under the ceiling. But it needs (a) a LiveAvatar plan purchase, which the Boundaries forbid, and (b) ten custom-avatar slots at an unpublished price. The one-time cost and the effort, not the per-minute rate, are what fail.

## Effort if Myke chooses to fund it later

1. Buy a LiveAvatar plan with at least 10 custom-avatar slots (Myke).
2. Create ten custom LiveAvatars from the existing original headshots in `public/panel/*.webp`. The source images must be at least 1080p, and Mach Eigen's 2752×1536 look qualifies. Use original faces only (TF-DEC-13). About 1 hour, plus HeyGen processing time.
3. Add a `liveAvatarId` per panelist in `src/data/panel.ts`, kept next to `heygenGroupId`.
4. Phase 2 build as specified: a gated `POST /api/interview/face/token` that mints a session token server-side from the LiveAvatar key, an `InterviewFace` component behind `TF_INTERVIEW_FACE=1` that sends each `SentenceBuffer` phrase in Lite mode, a fallback to the headshot on any error, and unit tests. About 1–1.5 days.
5. Re-run this spike's measurements, three sessions per avatar for Mach Eigen and Margo Brandt, before turning the flag on anywhere.

## What blocked the measurement

- No `HEYGEN_API_KEY` in the container, and `vercel` is not installed, so `vercel env pull` was not possible.
- `api.heygen.com`, `help.heygen.com` and the LiveAvatar hosts are outside this session's network allowlist.
- The HeyGen connector has no streaming or LiveAvatar tools, only pre-rendered video, avatar and voice tools.
- Even with a key, the Autonomy rules forbid buying the LiveAvatar plan or slots that a test session would need.

## Side note for Myke

The HeyGen group behind Mach Eigen is named **"Konrad Eigen"** in HeyGen (look "Konrad Eigen – Boardroom"), while `panel.ts` says Mach Eigen. This does not affect the app, which uses ids only. Rename it in HeyGen if you want the two to match.

## Sources

- [LiveAvatar FAQ (HeyGen Help)](https://help.heygen.com/en/articles/12758866-liveavatar-faq)
- [Introducing LiveAvatar (HeyGen Help)](https://help.heygen.com/en/articles/12758516-introducing-liveavatar)
- [LiveAvatar: Custom LiveAvatar Creation Guide](https://help.heygen.com/en/articles/9612935-liveavatar-custom-liveavatar-creation-guide)
- [Live Avatar, HeyGen Documentation](https://developers.heygen.com/live-avatar)
- [LiveAvatar](https://www.liveavatar.com/)
- [HeyGen Interactive Avatar Pricing Explained (2026)](https://selviaai.com/heygen-pricing-explained)
- [HeyGen API Pricing: A Complete Breakdown for 2026 (G2)](https://www.g2.com/articles/heygen-api-pricing)
- [HeyGen API Pricing (ugcgen.ai)](https://ugcgen.ai/heygen-api-pricing)

Pages were read through search summaries only. Fetching them directly was blocked by the network policy.

---

## Wave 2: pre-rendered clips for the fixed segments (2026-11-07)

**Decision (Myke, 2026-11-07):** no streaming avatar. Use HeyGen pre-rendered, non-streaming clips for the fixed segments of the interview. Everything live stays voice-only (TH-50). This needs no LiveAvatar plan.

### What is built (behind `TF_INTERVIEW_FACE=1`, off by default)

| Segment | Clip | When it plays |
|---|---|---|
| Intro | The existing TH-4 intro video, `public/panel/intro/<slug>.mp4` (all ten are in the repo) | On room open, behind a "Play introduction" tap (browsers block sound before a gesture) |
| Transition | `public/panel/interview/<slug>-transition.mp4` | Once, after the reply at the arc midpoint (reply 5 of 9) |
| Outro | `public/panel/interview/<slug>-outro.mp4` | Once, when the arc is finished or the guest taps "Wrap up" |

- `src/interview/face-cues.ts` decides which segment plays next. It is client-safe and pure. A clip never plays while a reply is streaming or being spoken.
- `src/interview/face.ts` reads the flag and finds the clips on the server. A transition or outro is offered only when its line is `rendered` in `cast/_shared/interview-clips.yaml` **and** its MP4 is in the repo. HeyGen URLs are signed and expire, so the room never points at one.
- `src/components/interview/InterviewFace.tsx` is the player. It has captions, a transcript line, Skip, and barge-in (a new question stops the clip). On any video error it hides itself and the TH-50 headshot room carries on.
- `npm run interview:clips` copies rendered clips from HeyGen into `public/panel/interview/` and writes the captions. It renders nothing. Offline mode is `--urls`.
- With the flag off, `faceClipsFor()` returns null, so the room has no video element and nothing changes. A browser check confirmed this.

### Lines

`cast/_shared/interview-clips.yaml` holds one transition line and one outro line per panelist, each in that panelist's own voice brief and fictional name. All are `proposed` except Mach Eigen's transition. Myke confirms or edits the lines before the other 19 are rendered.

### Test clip (1 of 1 allowed)

- 2026-11-07 10:20 CT. HeyGen `create_video_from_avatar` with look `e153df7a9df9614ef43f329fa6acc24f` (Mach Eigen), voice `f91cc0b0…` (his intro voice), 720p, default engine (Avatar IV). Script: "Good. That's the baseline. Next question, and bring numbers."
- Result: video `0ac4dcf55b2489e0f23cc99b9886adc7`, completed in about 64 s, **4.31 s** long.
- Premium credits went from 523 before the render to 520 after, so the clip cost **3 credits**. At that rate the other 19 lines cost about 57 credits.
- The MP4 is **not in the repo**. Its host (files2.heygen.ai) is blocked by this session's network policy. Myke runs `npm run interview:clips` with `HEYGEN_API_KEY` set to pull it in. Until then the room skips the transition, as designed.

### Verification

- `npm run typecheck` is clean. `npm test` gives **210/210** pass, including 10 new tests in `src/interview/face.test.ts` and `scripts/tests/interview-clips.test.ts`.
- `next build` passes. A headless Chromium run against `next start` with `TF_MOCK=1` showed:
  - flag on: the intro appears with a play button, and Skip hides it;
  - the transition appears after mock reply 5, and not before;
  - flag off: no face section and no video element;
  - a corrupt clip file: the face hides itself after Play and the headshot room stays.
