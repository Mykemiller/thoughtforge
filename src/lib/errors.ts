/**
 * Readable error text (TH-46). Supabase's PostgrestError is a plain object, not
 * an Error, so `String(err)` gives "[object Object]" and the real message
 * ("Invalid API key") is lost. Never throws, never returns "[object Object]".
 */
const CAP = 300;

const clip = (s: string): string => (s.length > CAP ? `${s.slice(0, CAP - 1)}…` : s);

function safeJson(v: unknown): string {
  const seen = new WeakSet<object>();
  try {
    const out = JSON.stringify(v, (_k, val) => {
      if (typeof val === "object" && val !== null) {
        if (seen.has(val)) return "[circular]";
        seen.add(val);
      }
      if (typeof val === "bigint") return val.toString();
      return val;
    });
    return out === undefined ? String(v) : out;
  } catch {
    return "unreadable error";
  }
}

const part = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export function describeError(err: unknown): string {
  try {
    if (err instanceof Error) return clip(err.message || err.name || "Error");
    if (typeof err === "string") return clip(err.trim() || "unknown error");
    if (err === null || err === undefined) return "unknown error";
    if (typeof err === "object") {
      const o = err as Record<string, unknown>;
      const message = part(o.message);
      if (message) {
        const extras = [part(o.code) && `code ${part(o.code)}`, part(o.details), part(o.hint) && `hint: ${part(o.hint)}`].filter(Boolean);
        return clip(extras.length ? `${message} (${extras.join("; ")})` : message);
      }
      const j = safeJson(err);
      return clip(j === "{}" || j === "[object Object]" ? "unknown error" : j);
    }
    return clip(String(err));
  } catch {
    return "unreadable error";
  }
}
