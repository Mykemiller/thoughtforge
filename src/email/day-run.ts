/**
 * runPanelDay (TH-66): the 07:00 weekday cron (and 09:00 Saturday) builds the day's plan,
 * builds the context lanes once, composes every slot, sends slot 1 now and hands the rest
 * to Resend with scheduledAt. The whole day is one unit, persisted in tf_email_day_plans.
 *
 * Idempotency: a plan with status "scheduled" makes a re-run do nothing. A "planning" or
 * "partial" plan is resumed: its Message-IDs and composed text are reused, and every email is
 * still guarded by its tf_email_messages row (kind, send_date, panelist_slug, slot).
 */
import { buildDayContext, sliceFor, type DayContext, type DayThreadEntry, type LaneSources, type SignalLane } from "./context";
import { planDay, type PanelDay, type PlannedSlot } from "./day-plan";
import { centralDate } from "./rotation";
import { assembleRoundtable, type RunDeps } from "./run";
import { makeMessageId } from "./send";
import type { DayPlanStatus, DayPlanStore } from "./store";
import type { ComposeContext, DaySlot, EmailKind, EmailPanelist, SignalInput } from "./types";

export interface DayRunDeps extends RunDeps {
  dayPlans: DayPlanStore;
  lanes: LaneSources;
  /** PANEL_MAX_DAILY. */
  maxDaily?: number;
  /** Prebuilt context (preview fixtures, tests); skips buildDayContext. */
  context?: DayContext;
}

export interface DayResult {
  date: string;
  weekday: number;
  skipped?: "sunday" | "already scheduled";
  status?: DayPlanStatus;
  /** Which lanes had something in them (names only). */
  lanes?: Record<string, number>;
  slots: PlannedSlot[];
}

/** Resend accepts scheduledAt up to 30 days out; anything within this margin of now is sent now. */
export const SEND_NOW_MARGIN_MS = 60_000;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Fixed slot kinds; signal-or-news is decided per day. */
export const SLOT_KIND: Partial<Record<DaySlot, EmailKind>> = { "morning-note": "briefing", "cold-open": "cold-open", "thread-reply": "thread-reply", aside: "aside", "weekend-note": "weekend-note" };

/** The Signal lane as compose input: the edition's top items. */
export const laneSignal = (s: SignalLane): SignalInput => ({ subject: s.subject, text: s.items.map((x, i) => `${i + 1}. ${x}`).join("\n"), editionDate: s.editionDate });

/** Carries Message-IDs, kinds and composed text over from an unfinished plan for the same date. */
export function mergePlans(fresh: PanelDay, prior: PanelDay | null): PanelDay {
  if (!prior) return fresh;
  const bySlot = new Map(prior.slots.map((s) => [s.slot, s]));
  return {
    ...fresh,
    slots: fresh.slots.map((s) => {
      const p = bySlot.get(s.slot);
      return p && p.slug === s.slug ? { ...s, ...p, at: s.at, local: s.local } : s;
    }),
  };
}

interface Composed {
  subject: string;
  body: string;
  /** Roundtable only: the ten panelists whose takeaways are inside. */
  takeaways?: { panelist: EmailPanelist; body: string }[];
}

export async function runPanelDay(now: Date, deps: DayRunDeps): Promise<DayResult> {
  const date = centralDate(now);
  const order = deps.panelists.map((p) => p.slug);
  const fresh = planDay(date, order, { maxDaily: deps.maxDaily });
  if (!fresh.slots.length) return { date, weekday: fresh.weekday, skipped: "sunday", slots: [] };

  const existing = await deps.dayPlans.get(date);
  if (existing?.status === "scheduled") return { date, weekday: fresh.weekday, skipped: "already scheduled", status: "scheduled", slots: (existing.plan as PanelDay).slots ?? [] };
  const plan = mergePlans(fresh, (existing?.plan as PanelDay | undefined) ?? null);
  for (const s of plan.slots) s.messageId ??= makeMessageId();

  const ctx = deps.context ?? (await buildDayContext(date, now, deps.panelists, plan.slots.map((s) => s.slug), { log: deps.log, ...deps.lanes, digests: deps.lanes.digests ?? deps.digests }));
  const lanes = { projects: ctx.projects.length, signal: ctx.signal ? ctx.signal.items.length : 0, news: ctx.news.length, sports: Object.values(ctx.sports).flat().length };

  // signal-or-news: a fresh edition whose takeaways have not gone out becomes the roundtable; otherwise a news-take.
  for (const s of plan.slots) {
    if (s.kind) continue;
    if (s.slot === "signal-or-news") {
      let roundtable = false;
      if (ctx.signal?.fresh) {
        const sent = await Promise.all(order.map((slug) => deps.store.has({ kind: "signal-takeaway", send_date: ctx.signal!.editionDate, panelist_slug: slug }).catch(() => true)));
        roundtable = !sent.some(Boolean);
      }
      s.kind = roundtable ? "signal-takeaway" : "news-take";
    } else s.kind = SLOT_KIND[s.slot];
  }
  await deps.dayPlans.save({ send_date: date, plan, status: "planning" });

  const bySlug = (slug: string) => {
    const p = deps.panelists.find((x) => x.slug === slug);
    if (!p) throw new Error(`email: ${slug} is not in the panel`);
    return p;
  };
  const entry = (s: PlannedSlot): DayThreadEntry => {
    const p = bySlug(s.slug);
    return { author: p.name, firstName: p.firstName, slot: s.slot, subject: s.subject ?? "", body: s.body ?? "", messageId: s.messageId! };
  };
  const composed = new Map<string, Composed>();
  const failures = new Map<string, string>();

  const composeSlot = async (s: PlannedSlot, thread: DayThreadEntry[]): Promise<void> => {
    if (s.status === "sent" || s.status === "scheduled") return;
    if (s.subject && s.body && s.kind !== "signal-takeaway") {
      composed.set(s.slot, { subject: s.subject, body: s.body });
      return;
    }
    const panelist = bySlug(s.slug);
    try {
      if (s.kind === "signal-takeaway") {
        const signal = laneSignal(ctx.signal!);
        const parts = await Promise.all(
          deps.panelists.map(async (p) => ({ panelist: p, body: (await deps.compose({ panelist: p, kind: "signal-takeaway", context: { date, signal, readerName: deps.readerName } })).body })),
        );
        const opener = await deps.compose({ panelist, kind: "roundtable-opener", context: { date, signal, readerName: deps.readerName } });
        composed.set(s.slot, { subject: opener.subject, body: assembleRoundtable(opener.body, parts, panelist), takeaways: parts });
        return;
      }
      const morning = plan.slots.find((x) => x.slot === s.replyToSlot);
      const answering = s.kind === "thread-reply" && morning ? thread.find((t) => t.slot === morning.slot) : undefined;
      if (s.kind === "thread-reply" && !answering?.body) throw new Error("thread-reply: the morning note was not composed");
      const context: ComposeContext = {
        date,
        readerName: deps.readerName,
        day: sliceFor(ctx, s.slug, thread, answering),
        ...(s.kind === "briefing" && ctx.signal ? { signal: laneSignal(ctx.signal) } : {}),
        ...(answering ? { replySubject: answering.subject } : {}),
      };
      const c = await deps.compose({ panelist, kind: s.kind!, context });
      composed.set(s.slot, c);
      s.subject = c.subject;
      s.body = c.body;
    } catch (e) {
      failures.set(s.slot, errMsg(e));
    }
  };

  // Morning note first so every later slot (and the thread-reply) has it in front of them.
  const first = plan.slots.filter((s) => s.slot === "morning-note");
  for (const s of first) await composeSlot(s, []);
  const thread = first.filter((s) => composed.has(s.slot)).map((s) => ({ ...entry(s), subject: composed.get(s.slot)!.subject, body: composed.get(s.slot)!.body }));
  await Promise.all(plan.slots.filter((s) => s.slot !== "morning-note").map((s) => composeSlot(s, thread)));

  // Deliver in time order. Slot times already past (or within a minute) go now.
  const morningSlot = plan.slots.find((s) => s.slot === "morning-note");
  for (const s of plan.slots) {
    if (s.status === "sent" || s.status === "scheduled") continue;
    const failed = failures.get(s.slot);
    const c = composed.get(s.slot);
    if (failed || !c) {
      s.status = "failed";
      s.reason = failed ?? "not composed";
      continue;
    }
    const panelist = bySlug(s.slug);
    const scheduledAt = Date.parse(s.at) - now.getTime() > SEND_NOW_MARGIN_MS ? s.at : undefined;
    const isReply = s.kind === "thread-reply" && morningSlot?.messageId;
    const threadKey = s.slot === "morning-note" ? s.messageId! : isReply ? morningSlot!.messageId! : s.kind === "signal-takeaway" ? c.subject : null;

    if (s.kind === "signal-takeaway") {
      await deliverRoundtable(s, c, panelist, scheduledAt, deps, ctx.signal?.editionDate ?? date);
      continue;
    }
    let reservation: { id: string } | null;
    try {
      reservation = await deps.store.reserve({
        kind: s.kind!,
        send_date: date,
        panelist_slug: s.slug,
        slot: s.slot,
        subject: c.subject,
        body: c.body,
        resend_id: null,
        message_id: s.messageId!,
        in_reply_to: isReply ? morningSlot!.messageId! : null,
        thread_key: threadKey,
      });
    } catch (e) {
      s.status = "failed";
      s.reason = errMsg(e);
      continue;
    }
    if (!reservation) {
      s.status = "skipped";
      s.reason = "already sent";
      continue;
    }
    try {
      const res = await deps.sender.send({
        from: panelist.from,
        to: deps.recipient,
        replyTo: panelist.replyTo || deps.replyTo, // TF-DEC-83
        subject: c.subject,
        text: c.body,
        messageId: s.messageId!,
        ...(isReply ? { inReplyTo: morningSlot!.messageId!, references: [morningSlot!.messageId!] } : {}),
        ...(scheduledAt ? { scheduledAt } : {}),
        idempotencyKey: `${s.kind}/${date}/${s.slug}/${s.slot}`,
      });
      await deps.store.markSent(reservation.id, { resend_id: res.resendId, message_id: res.messageId }).catch((e) => deps.log?.(`[email] ${s.slot} ${s.slug}: sent but the row was not updated: ${errMsg(e)}`));
      s.status = scheduledAt ? "scheduled" : "sent";
      s.resendId = res.resendId;
      deps.log?.(`[email] day ${date} ${s.slot} ${s.slug}: ${s.status}${scheduledAt ? ` for ${s.local} CT` : ""} (${res.resendId})`);
    } catch (e) {
      await deps.store.release(reservation.id).catch(() => undefined);
      s.status = "failed";
      s.reason = errMsg(e);
    }
  }

  const status: DayPlanStatus = plan.slots.every((s) => s.status && s.status !== "failed") ? "scheduled" : "partial";
  try {
    await deps.dayPlans.save({ send_date: date, plan, status });
  } catch (e) {
    deps.log?.(`[email] day ${date}: plan not saved: ${errMsg(e)}`);
  }
  return { date, weekday: plan.weekday, status, lanes, slots: plan.slots };
}

/** The 16:30 roundtable: ten takeaway rows keyed on the edition date (so the inbound path sees them), one email from the slot's panelist. */
async function deliverRoundtable(s: PlannedSlot, c: Composed, host: EmailPanelist, scheduledAt: string | undefined, deps: DayRunDeps, sendDate: string): Promise<void> {
  const reserved: string[] = [];
  for (const t of c.takeaways ?? []) {
    try {
      const r = await deps.store.reserve({
        kind: "signal-takeaway",
        send_date: sendDate,
        panelist_slug: t.panelist.slug,
        subject: c.subject,
        body: t.body,
        resend_id: null,
        message_id: s.messageId!,
        in_reply_to: null,
        thread_key: c.subject,
      });
      if (r) reserved.push(r.id);
    } catch (e) {
      deps.log?.(`[email] roundtable ${t.panelist.slug}: ${errMsg(e)}`);
    }
  }
  if (!reserved.length) {
    s.status = "skipped";
    s.reason = "takeaways already sent";
    return;
  }
  try {
    const res = await deps.sender.send({
      from: host.from,
      to: deps.recipient,
      replyTo: deps.replyTo, // panel@: the host writes for the panel (TF-DEC-83)
      subject: c.subject,
      text: c.body,
      messageId: s.messageId!,
      ...(scheduledAt ? { scheduledAt } : {}),
      idempotencyKey: `roundtable/${sendDate}`,
    });
    for (const id of reserved) await deps.store.markSent(id, { resend_id: res.resendId, message_id: res.messageId }).catch(() => undefined);
    s.subject = c.subject;
    s.status = scheduledAt ? "scheduled" : "sent";
    s.resendId = res.resendId;
  } catch (e) {
    for (const id of reserved) await deps.store.release(id).catch(() => undefined);
    s.status = "failed";
    s.reason = errMsg(e);
  }
}
