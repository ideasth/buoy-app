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

// ---- Stage 33b — fit the Elgin AM/PM blocks to the day's appointments ----
//
// The master feed carries fixed "Elgin House … (AM)" 08:00–12:00 and
// "(PM)" 13:00–17:00 blocks. When the Xestro feed has appointments for that
// Melbourne date, each block is reshaped to span its own appointments
// (first start → last end), so leave-by cues follow the real first patient.
// Split: appointments starting before the AM block's original end belong to
// AM, the rest to PM (single-block days take all of that day's appointments).
// A block with no appointments of its own keeps its template times.
// No patient detail is copied onto the block.

const BLOCK_RE = /^Elgin House\b.*\((AM|PM)\)\s*$/i;

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

export function isElginBlock(e: CalEvent): boolean {
  const s = (e.summary || "").trim();
  return !e.allDay && !s.startsWith(ELGIN_SUMMARY_PREFIX) && BLOCK_RE.test(s);
}

export function fitElginBlocks(events: CalEvent[], appointments: CalEvent[]): CalEvent[] {
  const apptsByDay = new Map<string, CalEvent[]>();
  for (const a of appointments) {
    if (a.allDay || !a.start || !a.end) continue;
    const k = melbDay(a.start);
    (apptsByDay.get(k) ?? apptsByDay.set(k, []).get(k)!).push(a);
  }
  if (!apptsByDay.size) return events;

  const blocksByDay = new Map<string, { am?: number; pm?: number }>();
  events.forEach((e, i) => {
    if (!isElginBlock(e)) return;
    const k = melbDay(e.start);
    if (!apptsByDay.has(k)) return;
    const half = BLOCK_RE.exec(e.summary.trim())![1].toUpperCase() === "AM" ? "am" : "pm";
    const slot = blocksByDay.get(k) ?? {};
    if (slot[half] === undefined) slot[half] = i;
    blocksByDay.set(k, slot);
  });

  const out = events.slice();
  for (const [day, { am, pm }] of blocksByDay) {
    const appts = apptsByDay.get(day)!;
    const split = am !== undefined ? Date.parse(events[am].end) : Number.POSITIVE_INFINITY;
    const groups: Array<[number | undefined, CalEvent[]]> = [
      [am, am !== undefined && pm !== undefined ? appts.filter((a) => Date.parse(a.start) < split) : am !== undefined ? appts : []],
      [pm, am !== undefined && pm !== undefined ? appts.filter((a) => Date.parse(a.start) >= split) : pm !== undefined ? appts : []],
    ];
    for (const [idx, group] of groups) {
      if (idx === undefined || !group.length) continue;
      const b = events[idx];
      const s = Math.min(...group.map((a) => Date.parse(a.start)));
      const en = Math.max(...group.map((a) => Date.parse(a.end)));
      const was = `${melbHM(Date.parse(b.start))}–${melbHM(Date.parse(b.end))}`;
      const note = `Times set from ${group.length} Elgin House appointment${group.length === 1 ? "" : "s"} (template ${was}).`;
      out[idx] = {
        ...b,
        start: new Date(s).toISOString(),
        end: new Date(en).toISOString(),
        description: b.description ? `${note}\n${b.description}` : note,
      };
    }
  }
  return out;
}
