/**
 * A fixture day context for `email:preview --date` under TF_MOCK=1 (TH-66). Hypothetical
 * projects, Signal items and headlines (example.com outlets); the personal lane is read from
 * the real v2 dossiers. No scores, so the preview shows the "no invented result" path.
 */
import type { DayContext } from "./context/types";
import { personalLanes } from "./context/personal";
import { SAMPLE_SIGNAL } from "./sample-signal";
import type { EmailPanelist } from "./types";

export function sampleDayContext(date: string, panelists: readonly EmailPanelist[]): DayContext {
  return {
    date,
    projects: [
      { title: "Panel email, Week 2: daily colleague conversation", state: "in review", updatedAt: `${date}T03:00:00Z`, lastComment: "Fixture comment: the day plan is drafted and waiting on review." },
      { title: "Signal panel takeaways (fixture)", state: "in progress", updatedAt: `${date}T01:00:00Z` },
    ],
    signal: {
      editionDate: date,
      subject: SAMPLE_SIGNAL.subject,
      items: SAMPLE_SIGNAL.text.split("\n").filter((l) => /^\d+\./.test(l)).map((l) => l.replace(/^\d+\.\s*/, "")),
      fresh: false,
    },
    news: [
      { title: "Fixture headline: county weighs noise rules for a hypothetical data center campus", domain: "news.example.com", url: "https://news.example.com/1", seen: "" },
      { title: "Fixture headline: hypothetical utility files a large-load interconnection study", domain: "grid.example.com", url: "https://grid.example.com/2", seen: "" },
      { title: "Fixture headline: transformer lead times hold at record levels (hypothetical)", domain: "build.example.com", url: "https://build.example.com/3", seen: "" },
    ],
    personal: personalLanes(panelists),
    sports: {},
  };
}
