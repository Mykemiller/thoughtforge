"use client";

/**
 * Client-side voice for the 1:1 room (TH-50).
 *
 * useSpeaker: an ordered queue of phrases; each is fetched from /api/interview/voice
 * as MP3 and played through ONE reused <audio> element (unlocked on the user's first
 * Send gesture so later phrases are not blocked by autoplay rules). stop() is
 * barge-in: it clears the queue, aborts fetches in flight and halts playback.
 *
 * useMic: Web Speech API dictation into the composer with a plain-text fallback
 * when the browser has no recognizer.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

export interface VoiceStatus {
  available: boolean;
  voice_name: string | null;
  reason: string | null;
}

export function useVoiceStatus(slug: string): VoiceStatus | null {
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/interview/voice?slug=${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? r.json() : { available: false, voice_name: null, reason: `Voice check failed (${r.status}).` }))
      .then((j: VoiceStatus) => alive && setStatus(j))
      .catch(() => alive && setStatus({ available: false, voice_name: null, reason: "Voice check failed." }));
    return () => {
      alive = false;
    };
  }, [slug]);
  return status;
}

export function useSpeaker(slug: string, enabled: boolean) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queue = useRef<string[]>([]);
  const playing = useRef(false);
  const generation = useRef(0); // bumped on stop(); stale fetches/plays check it
  const controllers = useRef<Set<AbortController>>(new Set());
  const [speaking, setSpeaking] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  /** Call from a user gesture (Send click) so the element is allowed to play later. */
  const unlock = useCallback(() => {
    if (audioRef.current) return;
    const a = new Audio();
    a.preload = "auto";
    audioRef.current = a;
    // A silent play() inside the gesture satisfies autoplay policies; errors are expected and ignored.
    a.src = "data:audio/mp3;base64,//uQxAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAACcQCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA";
    a.play().catch(() => undefined);
  }, []);

  const stop = useCallback(() => {
    generation.current += 1;
    queue.current = [];
    for (const c of controllers.current) c.abort();
    controllers.current.clear();
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.removeAttribute("src");
      a.load();
    }
    playing.current = false;
    setSpeaking(false);
  }, []);

  const pump = useCallback(async () => {
    if (playing.current) return;
    const a = audioRef.current;
    if (!a) return;
    playing.current = true;
    setSpeaking(true);
    const gen = generation.current;
    try {
      while (queue.current.length && gen === generation.current) {
        const text = queue.current.shift()!;
        const controller = new AbortController();
        controllers.current.add(controller);
        let url: string | null = null;
        try {
          const res = await fetch("/api/interview/voice", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ slug, text }),
            signal: controller.signal,
          });
          if (!res.ok) {
            let msg = `voice ${res.status}`;
            try {
              msg = ((await res.json()) as { error?: string }).error ?? msg;
            } catch {
              /* non-JSON */
            }
            setLastError(msg);
            continue;
          }
          const blob = await res.blob();
          if (gen !== generation.current) return;
          url = URL.createObjectURL(blob);
          await new Promise<void>((resolve) => {
            const done = () => {
              a.removeEventListener("ended", done);
              a.removeEventListener("error", done);
              resolve();
            };
            a.addEventListener("ended", done);
            a.addEventListener("error", done);
            a.src = url!;
            a.play().catch(() => done());
          });
        } catch (err) {
          if ((err as Error).name !== "AbortError") setLastError("Audio could not be played.");
        } finally {
          controllers.current.delete(controller);
          if (url) URL.revokeObjectURL(url);
        }
      }
    } finally {
      playing.current = false;
      if (gen === generation.current) setSpeaking(false);
    }
  }, [slug]);

  const speak = useCallback(
    (phrase: string) => {
      if (!enabled || !phrase.trim()) return;
      queue.current.push(phrase);
      void pump();
    },
    [enabled, pump],
  );

  useEffect(() => stop, [stop]);

  return { unlock, speak, stop, speaking, lastError, clearError: () => setLastError(null) };
}

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
};

function recognizer(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Dictation: `interim` is what is being heard, `onFinal` gets each finished phrase. */
export function useMic(onFinal: (text: string) => void, onStart?: () => void) {
  const supported = useSyncExternalStore(
    () => () => undefined,
    () => recognizer() !== null,
    () => false,
  );
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [micError, setMicError] = useState<string | null>(null);
  const recRef = useRef<Recognition | null>(null);

  const stopMic = useCallback(() => {
    recRef.current?.stop();
    recRef.current = null;
    setListening(false);
    setInterim("");
  }, []);

  const startMic = useCallback(() => {
    const Rec = recognizer();
    if (!Rec || recRef.current) return;
    const r = new Rec();
    r.lang = "en-US";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let heard = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const t = res[0]?.transcript ?? "";
        if (res.isFinal) onFinal(t.trim());
        else heard += t;
      }
      setInterim(heard.trim());
    };
    r.onerror = (e) => {
      setMicError(e.error === "not-allowed" ? "Microphone access was blocked; type instead." : `Microphone error: ${e.error}`);
      stopMic();
    };
    r.onend = () => {
      recRef.current = null;
      setListening(false);
      setInterim("");
    };
    recRef.current = r;
    setMicError(null);
    onStart?.();
    r.start();
    setListening(true);
  }, [onFinal, onStart, stopMic]);

  useEffect(() => stopMic, [stopMic]);

  return { supported, listening, interim, micError, startMic, stopMic };
}
