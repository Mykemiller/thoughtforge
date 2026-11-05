"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PanelMember } from "@/src/data/panel";
import type { Artifact } from "@/src/retrieval";
import { parseEvents } from "@/src/ask/sse";
import { mergeArtifacts, type InterviewEvent, type InterviewMessage } from "@/src/interview/sse";
import { replyCount, transcriptMarkdown } from "@/src/interview/transcript";
import { ReplyText } from "@/src/components/ask/ReplyText";

export interface InterviewRoomProps {
  member: PanelMember;
  voiceBrief: string;
  arc: string[];
  maxChars: number;
  mock: boolean;
}

type Phase = "idle" | "retrieving" | "replying";

export function InterviewRoom({ member, voiceBrief, arc, maxChars, mock }: InterviewRoomProps) {
  const [transcript, setTranscript] = useState<InterviewMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [live, setLive] = useState(""); // the reply being streamed
  const [phase, setPhase] = useState<Phase>("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [lastSaved, setLastSaved] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const busy = phase !== "idle";

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [transcript, live]);

  const send = useCallback(async () => {
    const q = draft.trim();
    if (!q || busy) return;
    if (q.length > maxChars) {
      setError(`Keep each message under ${maxChars} characters.`);
      return;
    }
    setError(null);
    const next: InterviewMessage[] = [...transcript, { role: "user", content: q }];
    const started = startedAt ?? new Date().toISOString();
    setStartedAt(started);
    setTranscript(next);
    setDraft("");
    setLive("");
    setPhase("retrieving");
    const controller = new AbortController();
    abortRef.current = controller;
    let reply = "";
    try {
      const res = await fetch("/api/interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: member.slug, transcript: next, session_id: sessionId ?? undefined, started_at: started, prior_artifacts: artifacts, retrieval: true }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        let msg = `The room could not be reached (${res.status}).`;
        try {
          const j = (await res.json()) as { error?: string };
          if (j.error) msg = j.error;
        } catch {
          /* non-JSON error body */
        }
        setError(msg);
        return; // finally() puts the question back
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
        for (const ev of parseEvents<InterviewEvent>(frames)) {
          if (ev.type === "retrieval") {
            setArtifacts((prev) => mergeArtifacts(prev, ev.artifacts));
            setPhase("replying");
          } else if (ev.type === "reply_delta") {
            reply += ev.text;
            setLive(reply);
            setPhase("replying");
          } else if (ev.type === "error") {
            setError(ev.message);
          } else if (ev.type === "done") {
            setSessionId(ev.session_id);
            setLastSaved(ev.saved);
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError("The connection dropped before the reply finished.");
    } finally {
      if (reply) {
        setTranscript((prev) => [...prev, { role: "assistant", content: reply }]);
      } else {
        // No reply arrived (stopped early or failed): put the question back so turns keep alternating.
        setTranscript((prev) => (prev.length && prev[prev.length - 1].role === "user" ? prev.slice(0, -1) : prev));
        setDraft(q);
      }
      setLive("");
      setPhase("idle");
    }
  }, [draft, busy, maxChars, transcript, startedAt, sessionId, artifacts, member.slug]);

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send();
    }
  };

  const exportTranscript = () => {
    const md = transcriptMarkdown({
      displayName: member.name,
      role: member.role,
      slug: member.slug,
      sessionId: sessionId ?? "unsaved",
      startedAt: startedAt ?? new Date().toISOString(),
      transcript,
    });
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `interview-${member.slug}-${(startedAt ?? new Date().toISOString()).slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const turns = replyCount(transcript);
  const nextArcIndex = Math.min(turns, arc.length - 1);

  return (
    <div className="flex flex-col gap-8">
      {/* Who */}
      <header className="flex items-start gap-4">
        <Image src={member.image} alt={`${member.name}, ${member.role}`} width={96} height={96} className="h-20 w-20 rounded-full object-cover ring-2 ring-primary sm:h-24 sm:w-24" priority />
        <div className="min-w-0">
          <p className="font-mono text-xs tracking-[0.08em] text-ink-muted">1:1 INTERVIEW</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{member.name}</h1>
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-accent">{member.role}</p>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-muted">{voiceBrief}</p>
          <p className="mt-2 text-xs text-ink-muted">
            <Link href={`/panel/${member.slug}`} className="font-semibold text-primary underline-offset-4 hover:underline">
              Read the bio
            </Link>
            {" · "}
            <Link href="/interview" className="font-semibold text-primary underline-offset-4 hover:underline">
              Pick someone else
            </Link>
          </p>
        </div>
      </header>

      {/* The arc */}
      <details className="rounded-card border border-line bg-muted p-4">
        <summary className="cursor-pointer text-sm font-semibold text-primary">The interview arc ({arc.length} questions; tap one to use it)</summary>
        <ol className="mt-3 flex flex-col gap-2" role="list">
          {arc.map((q, i) => (
            <li key={i}>
              <button
                type="button"
                disabled={busy}
                onClick={() => setDraft(q)}
                className={`w-full rounded-card border px-3 py-2 text-left text-sm hover:border-accent disabled:opacity-60 ${i === nextArcIndex && turns < arc.length ? "border-accent bg-surface" : "border-line bg-surface"}`}
              >
                <span className="font-mono text-[11px] text-ink-muted">Q{i + 1}</span> <span className="text-ink">{q}</span>
              </button>
            </li>
          ))}
        </ol>
      </details>

      {/* Transcript */}
      <section aria-labelledby="transcript-heading" className="flex flex-col gap-4">
        <h2 id="transcript-heading" className="font-mono text-xs tracking-[0.08em] text-ink-muted">
          TRANSCRIPT{turns ? ` · ${turns} ${turns === 1 ? "REPLY" : "REPLIES"}` : ""}
        </h2>
        {transcript.length === 0 && !live ? (
          <p className="text-sm text-ink-muted">Nothing yet. Ask the first question; the arc above is the usual place to start.</p>
        ) : null}
        <ol className="flex flex-col gap-4" role="list">
          {transcript.map((m, i) =>
            m.role === "user" ? (
              <li key={i} className="ml-auto max-w-[85%] rounded-card border border-line bg-surface px-4 py-3">
                <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">You</p>
                <p className="mt-1 whitespace-pre-wrap leading-relaxed text-ink">{m.content}</p>
              </li>
            ) : (
              <li key={i} className="mr-auto flex max-w-[92%] gap-3">
                <Image src={member.thumb} alt="" width={36} height={36} className="mt-1 h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-line" />
                <div className="rounded-card border border-line bg-muted px-4 py-3">
                  <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-accent">{member.name}</p>
                  <div className="mt-1">
                    <ReplyText text={m.content} contested={[]} />
                  </div>
                </div>
              </li>
            ),
          )}
          {busy ? (
            <li className="mr-auto flex max-w-[92%] gap-3" aria-live="polite">
              <Image src={member.thumb} alt="" width={36} height={36} className="mt-1 h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-line" />
              <div className="rounded-card border border-line bg-muted px-4 py-3">
                <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-accent">
                  {member.name}
                  <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-accent" aria-label="replying" />
                </p>
                <div className="mt-1">
                  {live ? <ReplyText text={live} contested={[]} /> : <p className="text-sm text-ink-muted">{phase === "retrieving" ? "Checking the library…" : "Thinking…"}</p>}
                </div>
              </div>
            </li>
          ) : null}
        </ol>
        <div ref={endRef} />
      </section>

      {error ? (
        <div role="alert" className="rounded-card border border-accent bg-accent/10 p-4 text-sm text-ink">
          {error}
        </div>
      ) : null}

      {/* Composer */}
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label htmlFor="message" className="font-mono text-xs tracking-[0.08em] text-ink-muted">
          YOUR QUESTION
        </label>
        <textarea
          id="message"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          rows={3}
          maxLength={maxChars + 50}
          disabled={busy}
          placeholder={`Ask ${member.name.split(" ")[0]} something, or tap a question from the arc.`}
          className="w-full resize-y rounded-card border border-line bg-surface p-4 text-base leading-relaxed text-ink placeholder:text-ink-muted/70 focus:border-accent disabled:opacity-70"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className={`font-mono text-xs ${draft.length > maxChars ? "text-accent" : "text-ink-muted"}`}>
            {draft.length} / {maxChars}
            {mock ? " · demo mode: canned replies, nothing saved" : ""}
          </span>
          <div className="flex gap-2">
            {transcript.length ? (
              <button type="button" onClick={exportTranscript} disabled={busy} className="inline-flex min-h-11 items-center rounded-card border border-line px-4 text-sm font-semibold text-primary hover:bg-muted disabled:opacity-50">
                Export transcript
              </button>
            ) : null}
            {busy ? (
              <button type="button" onClick={() => abortRef.current?.abort()} className="inline-flex min-h-11 items-center rounded-card border border-line px-4 text-sm font-semibold text-primary hover:bg-muted">
                Stop
              </button>
            ) : null}
            <button type="submit" disabled={busy || !draft.trim()} className="inline-flex min-h-11 items-center rounded-card bg-primary px-5 text-sm font-semibold text-surface hover:bg-primary/90 disabled:opacity-50">
              {busy ? "Answering…" : "Send"}
            </button>
          </div>
        </div>
        <p className="text-xs text-ink-muted">
          Cmd/Ctrl + Enter to send.
          {sessionId ? ` Session ${sessionId}${lastSaved === false ? " (last turn not saved)" : lastSaved ? ", saved after every reply" : ""}.` : ""}
          {artifacts.length ? ` ${artifacts.length} source${artifacts.length === 1 ? "" : "s"} seen so far.` : ""}
        </p>
      </form>
    </div>
  );
}
