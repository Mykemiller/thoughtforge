/** Turn order for one question (TF-DEC-08): eight domain panelists, then the Fact-Checker, then the Chief of Staff. */
export const PANEL_ORDER = [
  "margo-brandt",
  "mach-eigen",
  "delia-marchetti",
  "albert-thorne",
  "hartford-nakamura",
  "rosalind-ferraro",
  "victoria-stroud",
  "ingrid-halverson",
] as const;
export const FACT_CHECKER = "constance-wright";
export const CHIEF_OF_STAFF = "gilbert-faraday";

export const MODELS = {
  panelist: "claude-sonnet-5-5",
  factcheck: "claude-sonnet-5-5",
  ruling: "claude-opus-5-5",
} as const;

/**
 * Sampling. The pack asked for temperature 0.7 (panelists) and 0.3 (Fact-Checker,
 * ruling); the Claude 5 family rejects `temperature` with a 400, so the nearest
 * levers are used instead (docs/decisions-th32.md):
 *  - panelists (claude-sonnet-5-5): `thinking: {type: "between_tools"}` so the
 *    600-token budget goes to the reply, effort `medium`;
 *  - the Fact-Checker (claude-sonnet-5-5): no `thinking` field at all (TH-45,
 *    TF-DEC-57: thinking off), effort `high`, and 1,500 tokens. At 400 tokens
 *    with `between_tools` the grader's JSON was truncated or never started
 *    (TH-44: every session ungraded); 1,500 covers eight verdicts plus about
 *    eight items with 300-character notes. A live probe (`npm run
 *    probe:factcheck`) compares the thinking settings; it was not run in the
 *    TH-45 session (no key), so the field is omitted per the issue's default;
 *  - the ruling (claude-opus-5-5): thinking cannot be disabled, so effort `low`
 *    keeps the 1,000-token budget for the ruling text itself.
 */
export const LIMITS = {
  panelistMaxTokens: 600,
  factcheckMaxTokens: 1500,
  rulingMaxTokens: 1000,
  panelistEffort: "medium",
  factcheckEffort: "high",
  rulingEffort: "low",
  questionMaxChars: 1200,
} as const;
