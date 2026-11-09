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
