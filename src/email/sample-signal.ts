/**
 * A fixture Signal for previews, dry runs and tests (TH-31). Hypothetical
 * throughout: no real company, utility, place or person, and it says so.
 */
import type { SignalInput } from "./types";

export const SAMPLE_SIGNAL: SignalInput = {
  subject: "Faraday Signal: sample edition (fixture)",
  text: [
    "This is a fixture edition used for previews and tests. Every item is hypothetical.",
    "",
    "1. A utility in a hypothetical Midwest service territory files a large-load tariff: new loads above 50 MW sign 15-year contracts with a minimum demand charge of 80 percent of contracted capacity.",
    "2. A hypothetical county board pauses new data center permits for 120 days to study water use and noise.",
    "3. A hypothetical developer reports that lead times for large power transformers on its projects have reached 30 months.",
    "4. A hypothetical operator moves a planned hall from air cooling to direct-to-chip liquid cooling at 130 kW per rack.",
  ].join("\n"),
};
