import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDayContext } from "./context";
import { fetchNews, parseNews } from "./context/news";
import { personalLaneFor } from "./context/personal";
import { excerpt, fetchProjects, parseProjects, stripIssueNumbers, type Fetcher } from "./context/projects";
import { signalLaneFrom, topItems } from "./context/signal";
import { fetchSports, lastNight, parseScoreboard, scoreboardUrl, teamsIn } from "./context/sports";
import { loadEmailPanelists } from "./panelists";
import { MemoryDigestStore } from "./store";

const panel = loadEmailPanelists();
const NOW = new Date("2026-11-09T13:00:00Z");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const throwing: Fetcher = async () => {
  throw new Error("network down");
};
const status = (code: number): Fetcher => async () => new Response("nope", { status: code });

// ---------- projects ----------

const LINEAR_OK = {
  data: {
    issues: {
      nodes: [
        {
          identifier: "TH-66",
          title: "Panel email, Week 2: daily colleague conversation (TH-66)",
          updatedAt: "2026-11-09T02:00:00Z",
          state: { name: "In Progress" },
          comments: { nodes: [{ body: "older", createdAt: "2026-11-07T00:00:00Z" }, { body: "Blocked on **TH-47**'s MX record, see [docs](https://x.y)", createdAt: "2026-11-08T00:00:00Z" }] },
        },
        { identifier: "TH-1", title: "", state: { name: "Done" } },
      ],
    },
  },
};

test("projects: titles and newest comment, TH-numbers stripped, malformed nodes dropped", () => {
  const items = parseProjects(LINEAR_OK);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Panel email, Week 2: daily colleague conversation");
  assert.equal(items[0].state, "In Progress");
  assert.equal(items[0].lastComment, "Blocked on MX record, see docs");
  assert.equal(stripIssueNumbers("See TH-31 and TH-47's notes"), "See and notes");
  assert.ok(excerpt("x ".repeat(400)).length <= 284);
  assert.deepEqual(parseProjects({ errors: [{ message: "bad" }] }), []);
});

test("projects lane: no key, HTTP error or network error is empty, never a throw; the key is sent as Authorization", async () => {
  assert.deepEqual(await fetchProjects({ apiKey: undefined, now: NOW, fetcher: throwing }), []);
  assert.deepEqual(await fetchProjects({ apiKey: "lin_api_x", now: NOW, fetcher: throwing }), []);
  assert.deepEqual(await fetchProjects({ apiKey: "lin_api_x", now: NOW, fetcher: status(401) }), []);
  let seen: RequestInit | undefined;
  const ok = await fetchProjects({ apiKey: "lin_api_x", now: NOW, fetcher: async (_u, init) => ((seen = init), json(LINEAR_OK)) });
  assert.equal(ok.length, 1);
  assert.equal((seen?.headers as Record<string, string>).authorization, "lin_api_x");
  const vars = JSON.parse(String(seen?.body)).variables;
  assert.equal(vars.team, "TH");
  assert.equal(vars.since, "2026-11-08T01:00:00.000Z"); // 36 hours back
});

// ---------- signal ----------

const digest = (digest_date: string, ingested_at?: string) => ({
  digest_date,
  subject: "Faraday Daily Signal Digest — 6 signals",
  signal_count: 6,
  source_message_id: null,
  raw_html: null,
  raw_text: "From: x\n\n1. First item about a large-load tariff here.\n2. Second item about a permit pause here.\n3. Third item, transformer lead times here.\n4. Fourth item, liquid cooling at scale.\n5. Fifth item, a substation upgrade.\n6. Sixth item that is cut off.",
  ingested_at,
});

test("signal lane: newest digest within four days, top five items, fresh when ingested in the last 24h", () => {
  const lane = signalLaneFrom(digest("2026-11-09", "2026-11-09T11:00:00Z"), "2026-11-09", NOW)!;
  assert.equal(lane.items.length, 5);
  assert.match(lane.items[0], /^First item/);
  assert.equal(lane.fresh, true);
  assert.equal(signalLaneFrom(digest("2026-11-06", "2026-11-06T11:00:00Z"), "2026-11-09", NOW)!.fresh, false);
  assert.equal(signalLaneFrom(digest("2026-11-04"), "2026-11-09", NOW), null); // five days old
  assert.equal(signalLaneFrom(null, "2026-11-09", NOW), null);
  assert.equal(signalLaneFrom({ ...digest("2026-11-09"), raw_text: null }, "2026-11-09", NOW), null);
  assert.deepEqual(topItems("Para one is long enough to count as an item here.\n\nPara two is also long enough to count here."), [
    "Para one is long enough to count as an item here.",
    "Para two is also long enough to count here.",
  ]);
});

// ---------- news ----------

const article = (i: number, domain = `outlet${i}.example`) => ({ title: `Headline number ${i} about a data center grid`, url: `https://${domain}/a${i}`, domain, seendate: "20261109T080000Z" });

test("news lane: three to five items, one per outlet; GDELT's plain-text rate limit, 429, fewer than three, or a throw is empty", async () => {
  const many = JSON.stringify({ articles: [1, 2, 3, 4, 5, 6, 7].map((i) => article(i)) });
  assert.equal(parseNews(many).length, 5);
  assert.equal(parseNews(JSON.stringify({ articles: [article(1), article(2, "outlet1.example"), article(3)] })).length, 0); // two outlets only
  assert.deepEqual(parseNews("Please limit requests to one every 5 seconds"), []);
  assert.deepEqual(await fetchNews({ fetcher: status(429) }), []);
  assert.deepEqual(await fetchNews({ fetcher: throwing }), []);
  assert.deepEqual(await fetchNews({ fetcher: async () => new Response("Please limit requests to one every 5 seconds") }), []);
  let url = "";
  const ok = await fetchNews({ fetcher: async (u) => ((url = u), new Response(many)) });
  assert.equal(ok.length, 5);
  assert.match(url, /timespan=24h/);
  assert.match(url, /mode=artlist/);
});

// ---------- personal ----------

test("personal lane from the v2 dossier bullets: teams, hobbies, laughs, places, family (no [FIC] tags)", () => {
  const delia = panel.find((p) => p.slug === "delia-marchetti")!;
  const lane = personalLaneFor(delia);
  assert.deepEqual(lane.teams, ["Chicago Cubs"]);
  assert.match(lane.sports, /Cubs/);
  assert.match(lane.hobbies, /piano/);
  assert.match(lane.laughs, /headline/i);
  assert.match(lane.places, /Door County/);
  assert.equal(lane.family.length, 3);
  assert.ok(lane.family.every((f) => !f.includes("[FIC]")));
  // Every panelist has a structured life section and at least one team the scores feed knows.
  for (const p of panel) assert.ok(personalLaneFor(p).teams.length >= 1, p.slug);
  // "tolerates Delia's Cubs" is not a Cubs fan.
  assert.deepEqual(teamsIn("White Sox, fiercely, and Blackhawks; tolerates Delia's Cubs."), ["Chicago White Sox", "Chicago Blackhawks"]);
});

// ---------- sports ----------

const scoreboard = {
  events: [
    {
      status: { type: { completed: true } },
      competitions: [{ competitors: [{ team: { displayName: "Chicago Cubs" }, score: "3" }, { team: { displayName: "Other Club" }, score: "5" }] }],
    },
    {
      status: { type: { completed: false } },
      competitions: [{ competitors: [{ team: { displayName: "Chicago White Sox" }, score: "1" }, { team: { displayName: "Elsewhere" }, score: "0" }] }],
    },
  ],
};

test("sports lane: only finished games for followed teams; a failing league is empty, never a throw", async () => {
  assert.deepEqual(parseScoreboard(scoreboard, ["Chicago Cubs", "Chicago White Sox"], "mlb"), [
    { team: "Chicago Cubs", opponent: "Other Club", teamScore: 3, opponentScore: 5, result: "L", league: "mlb" },
  ]);
  assert.deepEqual(parseScoreboard({ nope: true }, ["Chicago Cubs"], "mlb"), []);
  assert.equal(lastNight("2026-11-09"), "20261108");
  assert.match(scoreboardUrl({ path: "football/college-football", groups: "80" }, "20261108"), /college-football\/scoreboard\?dates=20261108&groups=80/);
  const r = await fetchSports({ date: "2026-11-09", teamsBySlug: { "delia-marchetti": ["Chicago Cubs"], "hartford-caldwell": ["Seattle Seahawks"] }, fetcher: async (u) => (u.includes("mlb") ? json(scoreboard) : new Response("x", { status: 503 })) });
  assert.equal(r["delia-marchetti"].length, 1);
  assert.deepEqual(r["hartford-caldwell"], []);
  const down = await fetchSports({ date: "2026-11-09", teamsBySlug: { "delia-marchetti": ["Chicago Cubs"] }, fetcher: throwing });
  assert.deepEqual(down, { "delia-marchetti": [] });
});

// ---------- the whole context ----------

test("buildDayContext: every network lane failing gives an empty context, not a throw", async () => {
  const digests = new MemoryDigestStore();
  const ctx = await buildDayContext("2026-11-09", NOW, panel, ["delia-marchetti"], { linearApiKey: "lin_api_x", digests, fetcher: throwing });
  assert.deepEqual(ctx.projects, []);
  assert.deepEqual(ctx.news, []);
  assert.equal(ctx.signal, null);
  assert.deepEqual(ctx.sports, { "delia-marchetti": [] });
  assert.equal(Object.keys(ctx.personal).length, 10);
  const broken = { latest: async () => { throw new Error("db down"); }, upsert: async () => {} };
  const ctx2 = await buildDayContext("2026-11-09", NOW, panel, [], { digests: broken, offline: true });
  assert.equal(ctx2.signal, null);
});
