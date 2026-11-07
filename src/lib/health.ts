/** Pure health-report builder (TH-46). Never carries a key, key prefix or URL. */
export interface Health {
  supabase: "ok" | "error";
  supabase_note?: string;
  anthropic_key: "present" | "missing";
  checked_at: string;
}

/** YYYY-MM-DD HH:MM CT (America/Chicago). */
export function ctStamp(d: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} CT`;
}

export function buildHealth(supabaseNote: string | null, anthropicKeySet: boolean, now: Date = new Date()): { status: 200 | 503; body: Health } {
  const body: Health = {
    supabase: supabaseNote === null ? "ok" : "error",
    ...(supabaseNote === null ? {} : { supabase_note: supabaseNote }),
    anthropic_key: anthropicKeySet ? "present" : "missing",
    checked_at: ctStamp(now),
  };
  return { status: body.supabase === "ok" && anthropicKeySet ? 200 : 503, body };
}
