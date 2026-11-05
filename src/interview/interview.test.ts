import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeEvent, parseEvents } from "../ask/sse";
import { eventsToReply, mergeArtifacts, type InterviewEvent } from "./sse";
import { firstQuestion, interviewArtifactTitle, replyCount, transcriptMarkdown } from "./transcript";
import { loadGuide, parseArc } from "./guide";
import { INTERVIEW_TURN, composeInterviewPrompt, validateTranscript } from "./run";
import { loadCast } from "../cast/loader";
import { estimateTokens } from "../cast/prompt";
import { isGatedPath } from "../lib/access";
import { interviewTags } from "./save";
import { mockReply } from "./mock";
import type { Artifact } from "../retrieval";

const art = (id: string): Artifact => ({ id, title: `T${id}`, publisher: null, url: null, published_at: null, excerpt: "", source: "secondary", origin: "faraday" });

test("interview events round-trip through the shared SSE framing and fold into one reply", () => {
  const events: InterviewEvent[] = [
    { type: "retrieval", artifacts: [art("a")] },
    { type: "reply_delta", text: "Where I " },
    { type: "reply_delta", text: "started was Tacoma." },
    { type: "reply_end" },
    { type: "done", session_id: "11111111-1111-4111-8111-111111111111", saved: true },
  ];
  const wire = events.map(encodeEvent).join("");
  const back = parseEvents<InterviewEvent>(wire);
  assert.equal(back.length, 5);
  const folded = eventsToReply(back);
  assert.equal(folded.text, "Where I started was Tacoma.");
  assert.equal(folded.artifacts.length, 1);
  assert.equal(folded.session_id, "11111111-1111-4111-8111-111111111111");
  assert.equal(folded.error, null);
});

test("mergeArtifacts dedupes by id and keeps first-seen order", () => {
  const out = mergeArtifacts([art("a"), art("b")], [art("b"), art("c")]);
  assert.deepEqual(out.map((a) => a.id), ["a", "b", "c"]);
});

test("validateTranscript enforces shape, alternation and that the interviewer speaks last", () => {
  assert.throws(() => validateTranscript([]), /non-empty/);
  assert.throws(() => validateTranscript([{ role: "assistant", content: "hi" }]), /interviewer/);
  assert.throws(() => validateTranscript([{ role: "user", content: "a" }, { role: "user", content: "b" }]), /alternate/);
  assert.throws(() => validateTranscript([{ role: "user", content: "x".repeat(1201) }]), /over 1200/);
  const ok = validateTranscript([{ role: "user", content: " q1 " }, { role: "assistant", content: "a1" }, { role: "user", content: "q2" }]);
  assert.equal(ok.length, 3);
  assert.equal(ok[0].content, "q1");
});

test("the guide parses nine arc questions and the midterm question is Q6", () => {
  const g = loadGuide();
  assert.equal(g.arc.length, 9);
  assert.match(g.arc[5], /midterms/i);
  assert.match(g.forPanelist, /fad73aa8-bae6-4617-bf44-57d89297cc69/);
  assert.ok(!/consistency tells/i.test(g.forPanelist), "per-panelist tells never reach the prompt");
  assert.deepEqual(parseArc("1. **A.** First?\n2. Second?\nnot a question"), ["First?", "Second?"]);
});

test("every panelist's interview prompt stays under the panelist budget plus the guide's share", () => {
  const limit = 6000 + 2500; // core budget (prompt.test.ts) plus the guide and turn rule
  for (const m of loadCast()) {
    const p = composeInterviewPrompt(m, []);
    assert.ok(p.includes(INTERVIEW_TURN), `${m.slug}: turn rule missing`);
    assert.ok(p.includes("## The interview arc"), `${m.slug}: arc missing`);
    assert.ok(estimateTokens(p) < limit, `${m.slug}: ${estimateTokens(p)} tokens`);
  }
});

test("transcript markdown names both speakers and firstQuestion trims to 80 chars", () => {
  const t = [
    { role: "user" as const, content: "x".repeat(120) },
    { role: "assistant" as const, content: "Answer one." },
    { role: "user" as const, content: "Second?" },
  ];
  const md = transcriptMarkdown({ displayName: "Gilbert Faraday", role: "Chief of Staff", slug: "gilbert-faraday", sessionId: "s", startedAt: "2026-11-05T12:00:00.000Z", transcript: t });
  assert.match(md, /^# Interview: Gilbert Faraday, Chief of Staff/);
  assert.equal((md.match(/\*\*Myke:\*\*/g) ?? []).length, 2);
  assert.equal((md.match(/\*\*Gilbert Faraday:\*\*/g) ?? []).length, 1);
  assert.equal(firstQuestion(t).length, 80);
  assert.equal(replyCount(t), 1);
  assert.equal(interviewArtifactTitle("Gilbert Faraday", "2026-11-05T12:00:00.000Z"), "Interview: Gilbert Faraday, 2026-11-05");
});

test("interview tags carry the panelist and session; the gate covers the interview paths", () => {
  const tags = interviewTags({ session_id: "sid", panelist: "mach-eigen", started_at: "", transcript: [], artifacts: [], model_versions: {} });
  assert.deepEqual(tags, ["interview", "panelist:mach-eigen", "session:sid"]);
  for (const p of ["/interview", "/interview/mach-eigen", "/api/interview", "/ask", "/api/ask/x"]) assert.ok(isGatedPath(p), p);
  for (const p of ["/", "/panel", "/panel/mach-eigen", "/interviews", "/api/email/cron"]) assert.ok(!isGatedPath(p), p);
});

test("the mock reply uses the panelist's own voice brief", () => {
  const m = loadCast().find((x) => x.slug === "constance-wright")!;
  const r = mockReply(m, "What do you get wrong?");
  assert.match(r, /Demo mode/);
  assert.ok(r.includes(m.persona.voice_brief));
});
