/** Turn order for one question (TF-DEC-08): eight domain panelists, then the Fact-Checker, then the Chief of Staff. */
export const PANEL_ORDER = [
  "margo-brandt",
  "mach-eigen",
  "delia-marchetti",
  "albert-thorne",
  "hartford-caldwell",
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
 *  - panelists and the Fact-Checker (claude-sonnet-5-5): thinking off via
 *    `between_tools` so the small max_tokens budgets go to the reply, effort
 *    `medium` for the panelists and `high` for the grader;
 *  - the ruling (claude-opus-5-5): thinking cannot be disabled, so effort `low`
 *    keeps the 1,000-token budget for the ruling text itself.
 */
export const LIMITS = {
  panelistMaxTokens: 600,
  factcheckMaxTokens: 400,
  rulingMaxTokens: 1000,
  panelistEffort: "medium",
  factcheckEffort: "high",
  rulingEffort: "low",
  questionMaxChars: 1200,
} as const;
