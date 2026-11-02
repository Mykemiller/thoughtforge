"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import type { PanelMember } from "@/src/data/panel";
import { eventsToSession, parseEvents, type AskEvent, type PanelSession } from "@/src/ask/sse";
import { splitRuling } from "@/src/ask/render";
import { ReplyText } from "./ReplyText";

type Phase = "idle" | "retrieving" | "panel" | "factcheck" | "ruling" | "done";

export interface AskPanelProps {
  panelists: PanelMember[]; // the eight, in manifest order
  factChecker: PanelMember;
  chiefOfStaff: PanelMember;
  roster: PanelMember[]; // all ten
  maxChars: number;
  mock: boolean;
}

export function AskPanel({ panelists, factChecker, chiefOfStaff, roster, maxChars, mock }: AskPanelProps) {
  const [question, setQuestion] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [asked, setAsked] = useState("");
  const [events, setEvents] = useState<AskEvent[]>([]);
  const session: PanelSession = useMemo(() => eventsToSession(events, { question: asked }), [events, asked]);
  const [finished, setFinished] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const busy = phase !== "idle" && phase !== "done";

  const ask = useCallback(async () => {
    const q = question.trim();
    if (!q || busy) return;
    if (q.length > maxChars) {
      setError(`Keep the question under ${maxChars} characters.`);
      return;
    }
    setError(null);
    setEvents([]);
    setFinished(new Set());
    setAsked(q);
    setPhase("retrieving");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, retrieval: true }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        let msg = `The panel could not be reached (${res.status}).`;
        try {
          const j = (await res.json()) as { error?: string };
          if (j.error) msg = j.error;
        } catch {
          /* non-JSON error body */
        }
        setError(msg);
        setPhase("idle");
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const cut = buffer.lastIndexOf("\n\n");
        if (cut < 0) continue;
        const frames = buffer.slice(0, cut + 2);
        buffer = buffer.slice(cut + 2);
        const evs = parseEvents(frames);
        if (!evs.length) continue;
        setEvents((prev) => [...prev, ...evs]);
        for (const ev of evs) {
          if (ev.type === "panelist_start") setPhase("panel");
          else if (ev.type === "panelist_end") setFinished((prev) => new Set(prev).add(ev.slug));
          else if (ev.type === "factcheck") setPhase("ruling");
          else if (ev.type === "error") setError(ev.message);
          else if (ev.type === "done") setPhase("done");
        }
      }
      setPhase((p) => (p === "done" ? p : "done"));
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError("The connection to the panel dropped before it finished.");
      setPhase("idle");
    }
  }, [question, busy, maxChars]);

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void ask();
    }
  };

  const started = phase !== "idle";
  const allPanelDone = panelists.every((p) => finished.has(p.slug));
  const ruling = splitRuling(session.ruling);
  const contestedFor = (slug: string) => session.factcheck?.items.filter((i) => i.panelist === slug) ?? [];

  return (
    <div className="flex flex-col gap-10">
      {/* Roster */}
      <ul className="flex flex-wrap gap-2" aria-label="The panel" role="list">
        {roster.map((m) => (
          <li key={m.slug}>
            <Link href={`/panel/${m.slug}`} className="group flex items-center gap-2 rounded-card border border-line bg-surface py-1 pl-1 pr-3 text-xs hover:border-accent">
              <Image src={m.thumb} alt={`${m.name}, ${m.role}`} width={28} height={28} className="h-7 w-7 rounded-full object-cover ring-1 ring-line" />
              <span className="font-medium text-ink group-hover:text-primary">{m.name}</span>
            </Link>
          </li>
        ))}
      </ul>

      {/* Question */}
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
      >
        <label htmlFor="question" className="font-mono text-xs tracking-[0.08em] text-ink-muted">
          YOUR QUESTION
        </label>
        <textarea
          id="question"
          ref={textareaRef}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={onKey}
          rows={4}
          maxLength={maxChars + 50}
          disabled={busy}
          placeholder="Ask a datacenter question. The eight domain panelists answer, the Fact-Checker grades them, the Chief of Staff rules."
          className="w-full resize-y rounded-card border border-line bg-surface p-4 text-base leading-relaxed text-ink placeholder:text-ink-muted/70 focus:border-accent disabled:opacity-70"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className={`font-mono text-xs ${question.length > maxChars ? "text-accent" : "text-ink-muted"}`}>
            {question.length} / {maxChars}
            {mock ? " · demo mode: canned session, no model calls" : ""}
          </span>
          <div className="flex gap-2">
            {busy ? (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="inline-flex min-h-11 items-center rounded-card border border-line px-4 text-sm font-semibold text-primary hover:bg-muted"
              >
                Stop
              </button>
            ) : null}
            <button
              type="submit"
              disabled={busy || !question.trim()}
              className="inline-flex min-h-11 items-center rounded-card bg-primary px-5 text-sm font-semibold text-surface hover:bg-primary/90 disabled:opacity-50"
            >
              {busy ? "The panel is convening…" : "Ask the panel"}
            </button>
          </div>
        </div>
        <p className="text-xs text-ink-muted">Cmd/Ctrl + Enter to submit.</p>
      </form>

      {error ? (
        <div role="alert" className="rounded-card border border-accent bg-accent/10 p-4 text-sm text-ink">
          {error}
        </div>
      ) : null}

      {started ? (
        <>
          {/* Sources */}
          <details className="rounded-card border border-line bg-muted p-4" open={false}>
            <summary className="cursor-pointer text-sm font-semibold text-primary">
              Sources the panel saw ({session.artifacts.length})
            </summary>
            {session.artifacts.length ? (
              <ul className="mt-3 flex flex-col gap-2" role="list">
                {session.artifacts.map((a) => (
                  <li key={a.id} className="text-sm">
                    {a.url ? (
                      <a href={a.url} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline-offset-4 hover:underline">
                        {a.title}
                      </a>
                    ) : (
                      <span className="font-medium text-ink">{a.title}</span>
                    )}
                    <span className="text-ink-muted">
                      {" "}
                      · {a.publisher ?? "unknown publisher"}
                      {a.published_at ? ` · ${a.published_at}` : ""}
                      {" · "}
                      <span className="font-mono text-[11px] uppercase">{a.source}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-ink-muted">
                {phase === "retrieving" ? "Searching the artifact library…" : "No artifacts were retrieved for this question; the panel tagged accordingly."}
              </p>
            )}
          </details>

          {/* Eight panelist cards */}
          <section aria-labelledby="replies-heading">
            <h2 id="replies-heading" className="font-mono text-xs tracking-[0.08em] text-ink-muted">
              THE PANEL ANSWERS
            </h2>
            <ul className="mt-4 grid gap-4 md:grid-cols-2" role="list">
              {panelists.map((m) => {
                const text = session.replies[m.slug];
                const done = finished.has(m.slug);
                const verdict = session.factcheck?.verdicts[m.slug];
                return (
                  <li key={m.slug} className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5">
                    <div className="flex items-center gap-3">
                      <Image src={m.thumb} alt={`${m.name}, ${m.role}`} width={48} height={48} className="h-12 w-12 rounded-full object-cover ring-2 ring-line" />
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-ink">{m.name}</p>
                        <p className="truncate font-mono text-[11px] uppercase tracking-[0.08em] text-accent">{m.role}</p>
                      </div>
                      {!done && started ? (
                        <span className="ml-auto inline-flex h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" aria-label="replying" />
                      ) : null}
                    </div>
                    {text ? (
                      <ReplyText text={text} contested={contestedFor(m.slug)} />
                    ) : (
                      <div className="flex flex-col gap-2" aria-hidden="true">
                        <span className="h-3 w-11/12 animate-pulse rounded bg-muted" />
                        <span className="h-3 w-full animate-pulse rounded bg-muted" />
                        <span className="h-3 w-4/5 animate-pulse rounded bg-muted" />
                      </div>
                    )}
                    {verdict ? (
                      <p className="mt-1 border-t border-line pt-3 text-sm text-ink-muted">
                        <span className="font-semibold text-ink">{factChecker.name}:</span> {verdict}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Fact-Checker status */}
          {allPanelDone && !session.factcheck ? (
            <p className="flex items-center gap-3 text-sm text-ink-muted">
              <Image src={factChecker.thumb} alt={`${factChecker.name}, ${factChecker.role}`} width={28} height={28} className="h-7 w-7 rounded-full object-cover ring-1 ring-line" />
              {factChecker.name} is grading every claim…
            </p>
          ) : null}

          {/* Ruling */}
          {session.factcheck ? (
            <section aria-labelledby="ruling-heading" className="rounded-card border-2 border-primary bg-muted p-5 sm:p-6">
              <div className="flex items-center gap-4">
                <Image src={chiefOfStaff.thumb} alt={`${chiefOfStaff.name}, ${chiefOfStaff.role}`} width={64} height={64} className="h-16 w-16 rounded-full object-cover ring-2 ring-primary" />
                <div>
                  <h2 id="ruling-heading" className="text-xl font-bold tracking-tight text-ink">
                    Ruling
                  </h2>
                  <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-accent">
                    {chiefOfStaff.name} · {chiefOfStaff.role}
                  </p>
                </div>
              </div>
              {ruling.body ? (
                <div className="mt-4">
                  <ReplyText text={ruling.body} contested={[]} />
                </div>
              ) : (
                <p className="mt-4 text-sm text-ink-muted">{phase === "done" ? "No ruling was returned." : "Writing the ruling…"}</p>
              )}
              {ruling.dissent ? (
                <p className="mt-4 border-t border-line pt-3 text-sm text-ink">
                  <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">Dissent on the record</span>
                  <br />
                  {ruling.dissent}
                </p>
              ) : null}
              {ruling.wouldChange ? (
                <p className="mt-3 text-sm text-ink">
                  <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">What would change my mind</span>
                  <br />
                  <ReplyText text={ruling.wouldChange} contested={[]} />
                </p>
              ) : null}
              {phase === "done" && session.session_id ? (
                <p className="mt-4 font-mono text-[11px] text-ink-muted">Session {session.session_id} saved as a panel artifact.</p>
              ) : null}
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
