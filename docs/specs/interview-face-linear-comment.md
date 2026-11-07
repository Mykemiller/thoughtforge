**TH-51 spike verdict: FAIL. Recommend moving to Backlog and shipping the Panelist 1:1 Interviews milestone voice-first (TF-DEC-75).**

Spec: `docs/specs/interview-face.md` on branch `th-51-interview-face`.

What the account shows (HeyGen connector, 2026-11-07 CT):
- The panelist avatars are single-look **photo avatars**. Their only engines are `avatar_v`, `avatar_iv` and `avatar_iii`, which make pre-rendered video. None is a streaming engine. This holds for both Mach Eigen and Margo Brandt.
- The account is on HeyGen **Creator** with 523 premium credits and no LiveAvatar entitlement. Real-time avatars are a separate product, **LiveAvatar**, with separate credits.

Per-panelist cost and effort, if funded later:
- **One custom LiveAvatar per panelist (ten in all), each a paid slot.** The slot price is not published ("contact your account manager").
- Streaming in Lite mode (our own LLM and ElevenLabs audio) costs 1 LiveAvatar credit per minute, about $0.08–0.20 per minute from published sources. That is under the D2 ceiling of about $0.30 per minute, which is 3× the estimated $0.10 per minute of ElevenLabs voice.
- Effort: about 1 hour to create the ten avatars, plus 1–1.5 days for the flag-gated build (token route, face component, headshot fallback, tests), plus a re-run of the latency measurements.

Latency against the 2.5 s first-frame bar was **not measured**. No session could be opened: there is no key in the session, api.heygen.com is outside the network allowlist, and a test would need a LiveAvatar plan purchase, which this run may not make.

Myke decides:
1. Accept the fail, so the issue moves to Backlog and the milestone ships voice-first, **or**
2. Fund a LiveAvatar plan with 10 slots, then say "go" to re-run the measurements and start Phase 2.
