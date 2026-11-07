<!--
Verbatim snapshot of the Linear document "ThoughtForge Product Spec v0.1 (TH-2)"
(id 8512ebe0-784f-4c10-9f5f-aec82769d904), taken 2026-11-07 04:20 CST before v1.0
was written. The only edit: the two signed Linear upload URLs have their
`?signature=` token replaced with `[signature removed]`, because the tokens are
short-lived credentials. The content is otherwise unchanged.
-->

# ThoughtForge Product Spec v0.1

**Linear:** [TH-2](<https://linear.app/my-faraday/issue/TH-2/write-the-thoughtforge-spec-architecture-retrieval-evidence-ladder-ui>) · **Project:** [ThoughtForge Panel App](<https://linear.app/my-faraday/project/thoughtforge-panel-app-effd3983713b>) ThoughtForge Panel App · **Status:** Draft for Myke review · **Drafted:** 2026-10-31, 5:45 PM CDT (America/Chicago)

**Tagline:** Datacenter Insights & Ecosystems

---

## 1. Purpose

ThoughtForge is a panel of ten AI personas, each with a defined role, that discuss a datacenter question and give the user a decision-ready answer. Every claim carries a confidence label and an evidence tier. The panel should disagree where the evidence disagrees, and say so.

## 2. Scope (from [TH-2](<https://linear.app/my-faraday/issue/TH-2/write-the-thoughtforge-spec-architecture-retrieval-evidence-ladder-ui>))

* Next.js app on a new Vercel project (domain purchase and project creation complete per [TH-3](<https://linear.app/my-faraday/issue/TH-3/purchase-faraday-thoughtforgecom-and-create-the-vercel-project-hard>)).
* Claude is the reasoning engine. Each panelist has one system prompt, loaded from Notion at session start.
* Supabase retrieval over all artifacts, read-only. Project of record: `ycadmmngkdhvpcsrcuaq`. Never the decoy `xgbpmlkanxewtfizloay`. Assert the project ID before any call.
* A confidence label on every claim.
* A live web/industry lookup tier. Named sources: OCP Academy, OCP Summit, DCD, Coverage Matrix.
* West Wing room dynamic: panelists disagree in the open, and the Chief of Staff rules on the outcome.
* An evidence tier shown on every reply.

## 3. Brand and identity

**Logo:** Primary Monogram. The stacked "TF" mark in a circle with a lightning-bolt slash, paired with the "ThoughtForge" wordmark and the tagline "DATACENTER INSIGHTS & ECOSYSTEMS". Use the monogram alone for app icon, favicon and avatar. Use the full lockup for headers and marketing.

**Logo variants approved in the source board:** Primary Monogram, Lockup, Submark (TF with orbit ring), Reversed Badge (white on teal).

**Ecosystem iconography (from the source board):** Data Center Hub, Insights & Analytics, Network Ecosystems, Thought/Idea Generation, Growth/Forward Movement. Use these for panel and section markers.

**Palette (standalone ThoughtForge, from the source board):** Cyber Teal, Metallic Turquoise, Dark Charcoal.

> **Decision (closed):** ThoughtForge uses its own standalone palette. It is not a Faraday sub-brand.
> **Acknowledged conflict:** The Faraday Brand Bible 5.0 locks Faraday Forest and Faraday Gold, and says not to introduce electric greens, cool grays or anything that reads as generic tech. The ThoughtForge palette departs from that on purpose. The Brand Bible does not govern ThoughtForge colors.
> **Still to do:** Hex values are not yet sampled. Pull them from the master logo file before design lock. Do not invent them.

## 4. The Dream Team: roles in this product

The Product Team Template governs how the build runs. Roles apply as follows.

| Role | Owns in ThoughtForge | Authority |
| -- | -- | -- |
| Founder | Direction, stretch goals, budget, accountability | Can override any call |
| Product Manager | Weekly plan; turns direction into scoped TH issues | Makes the call on contested decisions |
| Lead Architect | Architecture in this spec; keeps every change consistent with the whole | Designs for easy change |
| Quality Lead | Standard for panel output; judges sample replies | Sets the bar |
| Subject-Matter Editor | Substance and voice check on panelist prompts and replies | Checks each piece |
| Data Engineer | Supabase inputs complete, current, healthy; decoy guard | Keeps retrieval inputs clean |
| Growth & Customer Lead | Who buys, why, at what price, what customers say | Shapes the offer |
| Trust & Compliance Counsel | Consent, disclaimers, public claims, real-person rule | **Can stop a release** for legal or consent exposure or false public claims |
| Program & Quality Manager | Sequencing, testing, rollback | **Can stop a release** for broken production or data loss |

**Rules that apply:** Ship fast, ship daily. Disagreements are written down with the Product Manager's decision. The two brakes apply only to harm that is hard to undo. Myke approves every pull request (TF-DEC-19).

## 5. Architecture

**Stack:** Next.js (App Router), Vercel hosting, Claude API as the engine, Supabase Postgres (read-only role for the app), Notion as the source for panelist prompts.

**Request flow:**

1. User asks a question.
2. App asserts Supabase project ID `ycadmmngkdhvpcsrcuaq`. Fails closed if it does not match.
3. Retrieval pulls relevant artifacts (read-only).
4. Live lookup tier runs if the question needs current data. Sources: OCP Academy, OCP Summit, DCD, Coverage Matrix.
5. Each panelist receives the question, its Notion-loaded system prompt, and the retrieved evidence.
6. Panelists respond in the room. Disagreement is kept, not smoothed over.
7. Chief of Staff gives the room's answer and ruling.
8. Reply renders with a confidence label per claim and an evidence tier for the whole reply.

**Secrets:** API keys and service-role keys are never pasted into chat. Myke sets them through the Vercel CLI.

**Decisions to record in the Notion decision log** (append only, one plain-English sentence each): stack choice, retrieval read-only policy, and palette decision once made.

## 6. Evidence ladder and confidence

**Evidence tier (reply level):** `VRF · SRC · EST · INF`

* **VRF:** verified against a retrieved primary source.
* **SRC:** sourced to a named document or publication.
* **EST:** estimate built from sourced inputs. Method stated.
* **INF:** inference or judgment. No direct source.

**Confidence label (claim level):** every factual claim carries one label. Confidence and certainty are different objects; do not blend them.

**Rules, adapted from the Faraday Brand Bible voice rules:**

* **Absence is not evidence.** "We have not observed X" is not "X does not exist." Say which one applies.
* **A projection is never a source.** A forecast from a respected body is an EST, not a VRF.
* **A people signal cannot outweigh a document.** When a person's statement and a filing disagree, the filing governs and the disagreement is reported.
* When the answer is not clear, its reasonable for the panel to formulate a thesis and state it as such with assumptions or caveats
* **Conviction in language, not numbers.** Panelists say "the read is that..." and do not print scores.

## 7. Panel model

**Cast:** Ten panelists, fixed by TF-DEC-31 and ruled 2026-10-31 in the ThoughtForge Cast Sheet v1 (Notion, under All Things ThoughtForge). All ten are original personas.

| \# | Name | Role | Domains | Voice (register only) |
| -- | -- | -- | -- | -- |
| 1 | Gilbert Faraday | Chief of Staff | All; rules on contested calls | Measured, dry. Speaks last and rules in a sentence. |
| 2 | Margo Brandt | First Officer, Deputy Chief of Staff | Cross-domain execution; D10 Construction, D14 Development | Pragmatic, execution-first. Turns debate into sequenced owners and dates. |
| 3 | Mach Eigen | Chief Engineer | D2 Power architecture (800 VDC, BESS, SMR); D10 Construction engineering | First-principles, numbers before adjectives. |
| 4 | Delia Marchetti | Press Lead | D5 Markets, D22 Media; lay translation | Fast, wry, warm. Flags what will be misquoted. |
| 5 | Albert Thorne | Policy | D3 Grid, interconnection, FERC, ISOs, PUCs | Precise, academic. Separates what the rule says from how the ISO behaves. |
| 6 | Hartford Caldwell (Hart) | Counsel | D13 Permitting, D19 Tax and incentives | Prepared, policy-dense. Opens with exposure, closes with mitigation. Can brake. |
| 7 | Rosalind Ferraro (Rose) | Political Director | D18 Opposition and community, D13 local politics | Relentless, warm, direct. Names the community cost first. |
| 8 | Victoria Stroud (Vick) | Economic Advisor | D4 Capital markets, deal structure, cost of capital | Quiet, numbers first. Converts choices into cost of capital. |
| 9 | Dr. Ingrid Halverson | Science Advisor, Thermal Management | D7 Cooling and thermal, D1 Chips and density | Curious, exact. Starts from heat flux. Corrects units mid-sentence. |
| 10 | Constance Wright | Fact-Checker | All; owns the evidence ladder | Unsparing, brief. Cites or strikes. Grades every claim before the ruling. |

**Name note:** Gilbert Faraday and Mach Eigen are also the names of Faraday Intelligence's analyst personas in the Faraday Brand Bible 5.0 (§10). Their ThoughtForge roles are different. This is not yet decided. Raise it in TH-8 before anything user-facing ships.

**Room rules (from Cast Sheet v1):**

* The Chief of Staff speaks last and rules. Before ruling, he names the evidence that would change his mind.
* Constance grades every claim before the ruling. A projection is never SRC. Unsourced claims are called out.
* Hart and the Program & Quality brake can stop a recommendation only for hard-to-undo harm.
* Every reply shows the speaker and the evidence tier.

**Real people are archetypes only** (TF-DEC-13). Riker, C.J. Cregg, Rice, Obama and Clinton inform voice register. They never appear in names, user-facing prompts, voice cloning or likeness work.

**West Wing room dynamic:**

* Panelists speak in turn and may challenge each other.
* Each disagreement is shown in the reply, labelled by panelist.
* The Chief of Staff makes the closing call and states the basis for it.

**Ruling criteria and override conditions:** Listed in Closed Questions §11, item 3. Full room rules are in the Cast section above. Still to be reviewed in [TH-8](<https://linear.app/my-faraday/issue/TH-8/dream-team-review-of-the-thoughtforge-plan-release-26-45-v01>) Dream Team review before build.

## 8. UI requirements

* Evidence tier visible on every reply.
* Confidence label visible on every claim.
* Panelist name and role shown on each turn.
* Disagreements visually distinct from consensus.
* Source links shown for every SRC and VRF claim.
* Mobile-first layout.

## 9. Release and process

* Work tracked in Linear, team key **TH** (not TF). FDY is the Faraday team. FAR-### are legacy Jira.
* Build work is done by Claude Code from self-contained prompts attached to Linear issues (TF-DEC-18).
* Release names: **YY-WW-vXX** (TF-DEC-20). Example: `26-45-v01`, which is the release named in [TH-8](<https://linear.app/my-faraday/issue/TH-8/dream-team-review-of-the-thoughtforge-plan-release-26-45-v01>).
* Part of initial release is building the CV for each panelist, including profile pictures from Heygen.  The UI needs to include a set of background pages, including Panel Bio and recent research findings from the panelist
* Summaries for each release go to Notion in plain English.

## 10. Acceptance criteria for v0.1

1. A question returns panel replies from all ten panelists, each using its own Notion-loaded prompt.
2. Every reply shows an evidence tier. Every factual claim has a confidence label.
3. Supabase queries run read-only and the project-ID assertion blocks the decoy.
4. Live lookup returns at least one source from the named set when the question requires current data.
5. No real person's name appears in any user-facing text.
6. The Chief of Staff ruling appears after any contested exchange.
7. Logo renders correctly at favicon, header and full lockup sizes.- Use Primary Monogram and Submark -

<linear-image>{"type":"image","attrs":{"src":"https://uploads.linear.app/e622c9fa-9745-4d41-85cb-ea4c5a6ed426/6badc368-2147-4e6b-a130-065c9fa65e75/c4d16570-66e2-4363-8c0c-a04654bd9dc9?[signature removed]","title":"ThoughtForge-logo.png","width":1024,"height":572}}</linear-image>

## 11. Closed  questions

1. **Palette:** Use the ThoughtForge brand palette - acknowledge that its in conflict with Faraday color palette
2. **Panel roster:** Ten names, roles and Notion prompt locations - identified in Notion →[https://app.notion.com/p/ThoughtForge-Cast-Sheet-v1-40a89a0c168081819dc2e84a29a6e040?source=copy_link](<https://app.notion.com/p/ThoughtForge-Cast-Sheet-v1-40a89a0c168081819dc2e84a29a6e040?source=copy_link>)
3. **Chief of Staff rules:** Listens to all parties - Ruling criteria and override conditions.
4. **Live lookup:** Confirm access terms and rate limits for OCP Academy, OCP Summit, DCD and Coverage Matrix.
5. **Dream Team review:** Run [TH-8](<https://linear.app/my-faraday/issue/TH-8/dream-team-review-of-the-thoughtforge-plan-release-26-45-v01>) against this spec before build starts.

## 12. Source documents

* Notion: Product Team Template: The Dream Team (`3f489a0c-1680-8131-a950-fa1e93226e99`)
* Notion: Faraday Brand Bible 5.0 (`3da89a0c-1680-80b7-a913-f600e489156e`). Canonical 2026-09-13. Used for the evidence ladder and voice rules. Read in part; the remainder was truncated and should be re-read before any brand decision.
* Linear: [TH-2](<https://linear.app/my-faraday/issue/TH-2/write-the-thoughtforge-spec-architecture-retrieval-evidence-ladder-ui>) (this issue), [TH-3](<https://linear.app/my-faraday/issue/TH-3/purchase-faraday-thoughtforgecom-and-create-the-vercel-project-hard>) (domain and Vercel, Done), [TH-8](<https://linear.app/my-faraday/issue/TH-8/dream-team-review-of-the-thoughtforge-plan-release-26-45-v01>) (Dream Team review, Backlog)

**Thought Forge Deliverables described below in attached**

<linear-embed node-type="file">{"uploadState":"finished","uploadId":"upload-1793493258569-k8z3wgm","href":"https://uploads.linear.app/e622c9fa-9745-4d41-85cb-ea4c5a6ed426/e35bb84d-a300-4aa1-ae0f-cd048fecf2ae/0718ccaa-2f29-4fcf-b735-e708af1d57ca?[signature removed]","name":"Thought Forge Artifact Hierarchy.pdf","size":129516,"mimetype":"application/pdf","contentAttribution":{"userId":"69ebccd4-5815-4e34-9b57-5492fdd57586","actorType":"user_with_agent"}}</linear-embed>

6\. **Interface tool (OPEN-07):** Claude Design builds the UI shell (TH-10, canvas [https://claude.ai/artifact/SdwiCYmrJMBBZZbNvp2oKS](<https://claude.ai/artifact/SdwiCYmrJMBBZZbNvp2oKS>)). Claude Code builds orchestration and the Claude linkage (TH-11). Recorded in Notion as TF-DEC-37.
7\. **Persona names (OPEN-08):** Gilbert Faraday and Mach Eigen play their ThoughtForge roles. Their Faraday Brand Bible biographies are background context only. Recorded in Notion as TF-DEC-38. Supersedes the Name note in §7.
