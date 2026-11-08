// filepath: /home/user/workspace/anchor/server/ontime/plan.ts
// Stage 25 (On Time) — pure cue planner. No DB, no network: given calendar
// events (already travel-matched), config and a time window, returns the
// list of cues that should fire. Unit-tested in test/ontime-plan.test.ts.

import type { OnTimeConfig } from "./config";
import { addDaysKey, inQuietHours, melbDateKey, melbHHMM, melbToUtcMs, melbWeekday } from "./time";

export type CueKind =
  | "get_ready" | "wrap_up" | "leave_now" | "starts_soon" | "routine" | "digest" | "email";

export interface PlanEvent {
  uid: string;
  summary: string;
  location?: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  travelAllowMinutes: number | null; // null/0 = no travel needed
  travelLocationName: string | null;
}

export interface PlannedCue {
  key: string;          // stable dedupe key
  kind: CueKind;
  fireAt: number;       // UTC ms
  title: string;        // short, watch-safe
  body: string;
  priority: 3 | 4 | 5;
  eventUid?: string;
  eventStartMs?: number;
  leaveAtMs?: number;
}

const has = (hay: string, kws: string[]) => {
  const h = hay.toLowerCase();
  return kws.some((k) => k && h.includes(k.toLowerCase()));
};

export function isIgnoredEvent(ev: PlanEvent, cfg: OnTimeConfig): boolean {
  if (ev.allDay) return true;
  if (ev.endMs - ev.startMs <= 0) return true;
  return has(`${ev.summary} ${ev.location ?? ""}`, cfg.ignoreKeywords);
}

/** Watch-safe label for an event. With privacyLabels on, never the title. */
export function eventLabel(ev: PlanEvent, cfg: OnTimeConfig): string {
  if (!cfg.privacyLabels) return ev.summary.replace(/^\[[^\]]+\]\s*/, "").slice(0, 40);
  return ev.travelLocationName ? ev.travelLocationName : "Appointment";
}

export function leaveAtFor(ev: PlanEvent, cfg: OnTimeConfig): number | null {
  if (!ev.travelAllowMinutes || ev.travelAllowMinutes <= 0) return null;
  return ev.startMs - (ev.travelAllowMinutes + cfg.bufferMinutes) * 60_000;
}

/**
 * Stage 25.2 — true when an earlier, non-ignored event at the same travel
 * location ends shortly before this one starts (e.g. Elgin AM 08:00-12:00 then
 * PM 13:00). "Shortly" = less than a return trip plus buffer, so going home
 * in between would not make sense. Such events get no leave-by cues.
 */
export function alreadyThere(ev: PlanEvent, events: PlanEvent[], cfg: OnTimeConfig): boolean {
  if (!ev.travelLocationName || !ev.travelAllowMinutes) return false;
  const maxGap = (2 * ev.travelAllowMinutes + cfg.bufferMinutes) * 60_000;
  return events.some((p) =>
    p !== ev && p.uid !== ev.uid &&
    !isIgnoredEvent(p, cfg) &&
    p.travelLocationName === ev.travelLocationName &&
    p.endMs <= ev.startMs && ev.startMs - p.endMs <= maxGap,
  );
}

export function planEventCues(ev: PlanEvent, cfg: OnTimeConfig, events: PlanEvent[] = []): PlannedCue[] {
  if (isIgnoredEvent(ev, cfg)) return [];
  const label = eventLabel(ev, cfg);
  const startHH = melbHHMM(ev.startMs);
  const base = `ev:${ev.uid}:${ev.startMs}`;
  const leaveAt = alreadyThere(ev, events, cfg) ? null : leaveAtFor(ev, cfg);
  if (leaveAt == null) {
    if (cfg.noTravelLeadMinutes <= 0) return [];
    return [{
      key: `${base}:starts_soon`,
      kind: "starts_soon",
      fireAt: ev.startMs - cfg.noTravelLeadMinutes * 60_000,
      title: `${label} at ${startHH}`,
      body: `Starts in ${cfg.noTravelLeadMinutes} min. Wrap up what you're doing now.`,
      priority: 4,
      eventUid: ev.uid,
      eventStartMs: ev.startMs,
    }];
  }
  const leaveHH = melbHHMM(leaveAt);
  const why = `${ev.travelAllowMinutes} min travel + ${cfg.bufferMinutes} min buffer`;
  const common = { eventUid: ev.uid, eventStartMs: ev.startMs, leaveAtMs: leaveAt };
  return [
    {
      key: `${base}:get_ready`, kind: "get_ready",
      fireAt: leaveAt - cfg.getReadyLeadMinutes * 60_000,
      title: `Get ready - ${label}`,
      body: `Leave at ${leaveHH} for ${startHH}. Start getting ready now (${why}).`,
      priority: 3, ...common,
    },
    {
      key: `${base}:wrap_up`, kind: "wrap_up",
      fireAt: leaveAt - cfg.wrapUpLeadMinutes * 60_000,
      title: `Wrap up - leave ${leaveHH}`,
      body: `${cfg.wrapUpLeadMinutes} min to leave for ${label} (${startHH}). Save, stand up, keys, bag.`,
      priority: 4, ...common,
    },
    {
      key: `${base}:leave_now`, kind: "leave_now",
      fireAt: leaveAt,
      title: `Leave now - ${label}`,
      body: `Leave now to arrive for ${startHH}.`,
      priority: 5, ...common,
    },
  ];
}

/** True if any timed, non-ignored event covers the instant. */
function busyAt(t: number, events: PlanEvent[], cfg: OnTimeConfig): boolean {
  return events.some((e) => !isIgnoredEvent(e, cfg) && e.startMs <= t && t < e.endMs);
}

export function planRoutineCues(
  dateKey: string, events: PlanEvent[], cfg: OnTimeConfig,
): PlannedCue[] {
  const out: PlannedCue[] = [];
  const noon = melbToUtcMs(dateKey, "12:00");
  const wd = melbWeekday(noon);
  for (const r of cfg.routine) {
    if (!r.enabled || !r.days.includes(wd)) continue;
    const t = melbToUtcMs(dateKey, r.time);
    if (inQuietHours(t, cfg.quietStart, cfg.quietEnd)) continue;
    if (busyAt(t, events, cfg)) continue; // e.g. clinic day replaces deep work
    out.push({
      key: `rt:${r.id}:${dateKey}`,
      kind: "routine",
      fireAt: t,
      title: r.title,
      body: r.firstStep ? `First step: ${r.firstStep}` : "Starting now.",
      priority: 3,
    });
  }
  return out;
}

export function planDigestCue(dateKey: string, cfg: OnTimeConfig): PlannedCue | null {
  if (!cfg.digestEnabled) return null;
  return {
    key: `digest:${dateKey}`,
    kind: "digest",
    fireAt: melbToUtcMs(dateKey, cfg.digestTime),
    title: "Today",
    body: "", // composed at fire time from live data
    priority: 3,
  };
}

/**
 * Plan all cues whose fireAt falls inside [fromMs, toMs). Covers every
 * Melbourne date that intersects the window.
 */
export function planCues(
  events: PlanEvent[], cfg: OnTimeConfig, fromMs: number, toMs: number,
): PlannedCue[] {
  const cues: PlannedCue[] = [];
  for (const ev of events) {
    if (ev.endMs < fromMs - 86_400_000 || ev.startMs > toMs + 86_400_000) continue;
    cues.push(...planEventCues(ev, cfg, events));
  }
  let day = melbDateKey(fromMs);
  const lastDay = melbDateKey(toMs);
  for (let i = 0; i < 4; i++) {
    cues.push(...planRoutineCues(day, events, cfg));
    const d = planDigestCue(day, cfg);
    if (d) cues.push(d);
    if (day === lastDay) break;
    day = addDaysKey(day, 1);
  }
  return cues
    .filter((c) => c.fireAt >= fromMs && c.fireAt < toMs)
    .sort((a, b) => a.fireAt - b.fireAt);
}

/** Build the pre-filled "Running late" SMS link (user sends it themselves). */
export function runningLateSmsUrl(cfg: OnTimeConfig, mins: number): string {
  const text = cfg.lateMessage.replace(/\{mins\}/g, String(mins));
  return `sms:&body=${encodeURIComponent(text)}`;
}
