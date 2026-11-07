**TH-2 Phase 1: spec v1.0 drafted** (`docs/specs/thoughtforge-spec.md`, documentation only, no code changes)

**Summary.** v1.0 reconciles the v0.1 draft with what is on `main` (5acc3a6). It covers purpose, scope, architecture and request flow as built, retrieval (tables, read and write policy, project-of-record assertion), the evidence ladder, the panel and room rules, UI, access, process, acceptance and open questions. v0.1 is saved verbatim in `docs/specs/thoughtforge-spec-v0.1-snapshot.md`. Read-only guard: `dc_facilities` 18,217 and `artifacts` 688,824, so both floors pass.

**Drift: 15 items.** The main ones:
- Prompts come from repo `cast/`, not Notion (TF-DEC-40).
- There is no live lookup tier in panel sessions.
- The app writes `tf_*` tables with the service role.
- Panelists answer in parallel and blind (TF-DEC-08).
- The Hart rename to Nakamura (TF-DEC-92) has not landed in code.
- The Gilbert Faraday and Mach Eigen name question is closed by TF-DEC-38.
- There is no reply-level tier and no logo or favicon.

**Acceptance (v0.1 items 1 to 7):**
- Pass: #6.
- Partial: #3 (the assertion passes; "read-only" fails) and #5 (static copy passes; model output is open).
- Fail: #1 (prompts not from Notion) and #2 (no reply tier or confidence label).
- Not built: #4 (live lookup) and #7 (logo).

**Open questions for Myke:**
1. Land the TF-DEC-92 rename?
2. Reply tier or claim-only tagging?
3. Fact-Checker checks for the voice rules?
4. Make the brake a real mechanism?
5. Network-file real names in replies under TF-DEC-13?
6. `tf_email_day_plans` migration not applied?
7. Build the live lookup tier, and are the source terms confirmed?
8. Logo asset and palette hex timing?
9. Notion decision-log entries not verified by this run.

**Phase 2 is a HARD STOP.** Mark the drift rows to fix and say "go", or approve the PR as documentation only.
