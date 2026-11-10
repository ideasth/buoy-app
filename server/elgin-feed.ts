// filepath: server/elgin-feed.ts
// Stage 33 — private Elgin House (Xestro) appointment feed.
//
// Before Stage 33 the 05:26 Xestro import published ElginHouse.ics (patient
// names) to a public GitHub repo and a public feeds site. Now the import
// POSTs the ICS here (sync secret) and Buoy keeps it in app_settings:
//   - merged into the planner as info-only events (no leave-by cues; the
//     AM/PM Elgin block from the master feed still drives those, and
//     info-only events never reach availability or private.ics),
//   - served to Oliver's own calendar apps at
//     GET /api/calendar/elgin.ics?t=<token>  (token-only; wrong/missing → 404).
// The ICS and token are never logged or returned by any other route.

import { randomBytes, timingSafeEqual } from "node:crypto";
import type { CalEvent } from "./ics";
import { parseIcs } from "./ics";

export const ELGIN_KEY = {
  ICS: "elgin_feed_ics",
  UPDATED_AT: "elgin_feed_updated_at",
  TOKEN: "elgin_feed_token",
} as const;

export const MAX_ELGIN_ICS_BYTES = 2 * 1024 * 1024;
export const ELGIN_SUMMARY_PREFIX = "[Elgin House]";

export interface SettingsKv {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export function validateElginIcs(body: unknown): { ok: true; ics: string; count: number } | { ok: false; error: string } {
  const ics = (body as any)?.ics;
  if (typeof ics !== "string" || !ics.trim()) return { ok: false, error: "ics (string) required" };
  if (Buffer.byteLength(ics, "utf8") > MAX_ELGIN_ICS_BYTES) return { ok: false, error: "ics too large" };
  const t = ics.trimStart();
  if (!t.startsWith("BEGIN:VCALENDAR") || !/END:VCALENDAR\s*$/.test(ics)) return { ok: false, error: "not an ICS calendar" };
  const count = (ics.match(/BEGIN:VEVENT/g) || []).length;
  return { ok: true, ics, count };
}

export function storeElginIcs(kv: SettingsKv, ics: string, now = Date.now()): void {
  kv.set(ELGIN_KEY.ICS, ics);
  kv.set(ELGIN_KEY.UPDATED_AT, String(now));
  cache = null;
}

let cache: { src: string; events: CalEvent[] } | null = null;

/** Parsed events, tagged for the planner. Info-only: never busy, never cues. */
export function elginEvents(kv: SettingsKv): CalEvent[] {
  const src = kv.get(ELGIN_KEY.ICS);
  if (!src) return [];
  if (!cache || cache.src !== src) {
    let parsed: CalEvent[] = [];
    try { parsed = parseIcs(src); } catch { parsed = []; }
    cache = { src, events: parsed };
  }
  return cache.events.map((e) => {
    const s = (e.summary || "").trim();
    return {
      ...e,
      summary: s.startsWith(ELGIN_SUMMARY_PREFIX) ? s : `${ELGIN_SUMMARY_PREFIX} ${s}`.trim(),
      source: "external" as const,
      infoOnly: true,
    };
  });
}

export function elginStatus(kv: SettingsKv): { present: boolean; updatedAt: number | null; eventCount: number; tokenSet: boolean } {
  const src = kv.get(ELGIN_KEY.ICS);
  const u = kv.get(ELGIN_KEY.UPDATED_AT);
  return {
    present: !!src,
    updatedAt: u ? Number(u) : null,
    eventCount: src ? (src.match(/BEGIN:VEVENT/g) || []).length : 0,
    tokenSet: !!kv.get(ELGIN_KEY.TOKEN),
  };
}

export function rotateElginToken(kv: SettingsKv): string {
  const t = randomBytes(24).toString("base64url");
  kv.set(ELGIN_KEY.TOKEN, t);
  return t;
}

export function checkElginToken(kv: SettingsKv, provided: unknown): boolean {
  const want = kv.get(ELGIN_KEY.TOKEN);
  if (!want || typeof provided !== "string" || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---- Stage 33b / 34b — Elgin session times ----
//
// Stage 34b (Oliver, 2026-11-11): sessions use standard times —
// AM 08:00–13:00, PM 13:00–17:00 (Melbourne). Appointments starting before
// 13:00 belong to AM, the rest to PM. If a half's appointments run outside
// its standard window, the block is widened to cover them (so the leave-by
// cue is never after the first patient). No patient detail is copied.
//
// 1. fitElginBlocks: master-feed "Elgin House … (AM|PM)" blocks are set to
//    the standard window (widened by that half's appointments, if any).
// 2. synthElginSessions: Xestro sessions with no roster block (e.g. an
//    operating list at St Vincent's) get a busy block carrying the location
//    so travel matching and leave-by cues work: consulting → standard AM/PM
//    (extended for after-hours appointments); operating lists (SURG) → one
//    block per day + location at actual first-start → last-end times.

const BLOCK_RE = /^Elgin House\b.*\((AM|PM)\)\s*$/i;
export const SESSION_WINDOWS = { am: ["08:00", "13:00"], pm: ["13:00", "17:00"] } as const;
type Half = keyof typeof SESSION_WINDOWS;

function melbDay(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(iso));
}

function melbHM(ms: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Australia/Melbourne", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(ms));
}

function tzOffsetMs(utcMs: number): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Australia/Melbourne", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - utcMs;
}

/** Melbourne local date + HH:MM → UTC ms (DST-safe). */
function melbMs(day: string, hhmm: string): number {
  const [y, m, d] = day.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let t = guess - tzOffsetMs(guess);
  t = guess - tzOffsetMs(t);
  return t;
}

function halfOf(startIso: string): Half {
  return melbHM(Date.parse(startIso)) < SESSION_WINDOWS.am[1] ? "am" : "pm";
}

function windowFor(day: string, half: Half, appts: CalEvent[]): { s: number; e: number; widened: boolean } {
  const [ws, we] = SESSION_WINDOWS[half];
  let s = melbMs(day, ws), e = melbMs(day, we);
  const s0 = s, e0 = e;
  for (const a of appts) { s = Math.min(s, Date.parse(a.start)); e = Math.max(e, Date.parse(a.end)); }
  return { s, e, widened: s !== s0 || e !== e0 };
}

export function isElginBlock(e: CalEvent): boolean {
  const s = (e.summary || "").trim();
  return !e.allDay && !s.startsWith(ELGIN_SUMMARY_PREFIX) && BLOCK_RE.test(s);
}

function groupAppts(appointments: CalEvent[]): Map<string, CalEvent[]> {
  const m = new Map<string, CalEvent[]>();
  for (const a of appointments) {
    if (a.allDay || !a.start || !a.end) continue;
    const k = melbDay(a.start);
    (m.get(k) ?? m.set(k, []).get(k)!).push(a);
  }
  return m;
}

export function fitElginBlocks(events: CalEvent[], appointments: CalEvent[]): CalEvent[] {
  const byDay = groupAppts(appointments);
  return events.map((b) => {
    if (!isElginBlock(b)) return b;
    const day = melbDay(b.start);
    const half: Half = BLOCK_RE.exec(b.summary.trim())![1].toLowerCase() as Half;
    const mine = (byDay.get(day) ?? []).filter((a) => halfOf(a.start) === half && (!a.location || /elgin house/i.test(a.location)));
    const { s, e, widened } = windowFor(day, half, mine);
    const was = `${melbHM(Date.parse(b.start))}–${melbHM(Date.parse(b.end))}`;
    const note = mine.length
      ? `Standard ${half.toUpperCase()} session ${melbHM(s)}–${melbHM(e)}${widened ? " (widened to cover appointments)" : ""}; ${mine.length} appointment${mine.length === 1 ? "" : "s"} (roster ${was}).`
      : `Standard ${half.toUpperCase()} session ${melbHM(s)}–${melbHM(e)} (roster ${was}).`;
    return {
      ...b,
      start: new Date(s).toISOString(),
      end: new Date(e).toISOString(),
      description: b.description ? `${note}\n${b.description}` : note,
    };
  });
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "session";
}

export function synthElginSessions(events: CalEvent[], appointments: CalEvent[]): CalEvent[] {
  // Halves already carried by a roster block (Elgin rooms only).
  const covered = new Set<string>();
  for (const b of events) {
    if (!isElginBlock(b)) continue;
    covered.add(`${melbDay(b.start)}|${BLOCK_RE.exec(b.summary.trim())![1].toLowerCase()}`);
  }
  const groups = new Map<string, { day: string; half: Half | "list"; loc: string; appts: CalEvent[] }>();
  for (const a of appointments) {
    if (a.allDay || !a.start || !a.end) continue;
    const day = melbDay(a.start);
    const loc = (a.location || "").trim();
    const surgCase = /\(SURG\)\s*$/i.test(a.summary || "");
    // Operating lists: one block per day + location at actual times.
    const half: Half | "list" = surgCase ? "list" : halfOf(a.start);
    if (half !== "list" && covered.has(`${day}|${half}`) && (!loc || /elgin house/i.test(loc))) continue;
    const k = `${day}|${half}|${loc.toLowerCase()}`;
    const g = groups.get(k) ?? groups.set(k, { day, half, loc, appts: [] }).get(k)!;
    g.appts.push(a);
  }
  const have = new Set(events.map((e) => e.uid));
  const out: CalEvent[] = [];
  for (const { day, half, loc, appts } of groups.values()) {
    const uid = `elgin-session-${day}-${half}-${slug(loc)}@buoy`;
    if (have.has(uid)) continue;
    const n = appts.length;
    let s: number, e: number, desc: string, what: string;
    if (half === "list") {
      s = Math.min(...appts.map((a) => Date.parse(a.start)));
      e = Math.max(...appts.map((a) => Date.parse(a.end)));
      what = `Operating list · ${n} case${n === 1 ? "" : "s"}`;
      desc = `Operating list ${melbHM(s)}–${melbHM(e)} (actual case times), from the Xestro list.`;
    } else {
      const w = windowFor(day, half, appts);
      s = w.s; e = w.e;
      const H = half.toUpperCase();
      what = `Elgin House session ${H} · ${n} appointment${n === 1 ? "" : "s"}`;
      desc = `Standard ${H} session ${melbHM(s)}–${melbHM(e)}${w.widened ? " (extended for after-hours appointments)" : ""}, from the Xestro list.`;
    }
    out.push({
      uid,
      summary: loc ? `${what} · ${loc}` : what,
      start: new Date(s).toISOString(),
      end: new Date(e).toISOString(),
      allDay: false,
      location: loc || undefined,
      description: desc,
      source: "external" as const,
    } as CalEvent);
  }
  return out;
}
