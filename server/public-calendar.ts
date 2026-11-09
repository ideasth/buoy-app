// Stage 17 — public availability calendar (sanitised free/busy compute + ICS emit).
//
// Computes "Available" blocks from the merged calendar and emits a VCALENDAR
// containing only those blocks.  No event titles, locations, descriptions,
// attendees, or any personal detail is ever emitted.
//
// Source of busy time:
//   1. CalEvent[] passed in (Outlook + synced ICS feeds — already merged by caller)
//   3. public_calendar_blocks with kind = 'force_busy'
//   4. public_calendar_blocks with kind = 'rule_off_day' suppress whole weekday
//
// Overrides:
//   5. public_calendar_blocks with kind = 'force_available' punch holes in busy spans
//
// Parameters:
//   now        — current UTC instant (default Date.now() — injectable for tests)
//   horizonMs  — how far ahead to look (default 12 weeks in ms)

import type { CalEvent } from "./ics";
import type { PublicCalendarBlock } from "./calendar-blocks-storage";

// ---------------------------------------------------------------------------
// Melbourne TZ helpers (copied from ics.ts pattern — no shared dep)
// ---------------------------------------------------------------------------

function melbourneOffsetMinutes(utcMs: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? "0", 10);
  let hh = get("hour");
  if (hh === 24) hh = 0;
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), hh, get("minute"), get("second"));
  return Math.round((asUtc - utcMs) / 60000);
}

// Convert a Melbourne wall-clock day + hour:minute → UTC ms
function melbourneHmToUtc(ymdMelbourne: string, hh: number, mm: number): number {
  const [y, mo, d] = ymdMelbourne.split("-").map(Number);
  let guess = Date.UTC(y, mo - 1, d, hh, mm, 0);
  for (let i = 0; i < 2; i++) {
    const off = melbourneOffsetMinutes(guess);
    guess = Date.UTC(y, mo - 1, d, hh, mm, 0) - off * 60000;
  }
  return guess;
}

// Format a UTC ms as yyyymmddTHHmmssZ
function fmtUtcIcs(utcMs: number): string {
  const d = new Date(utcMs);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

// Melbourne date string "YYYY-MM-DD" from UTC ms
function melbourneDateStr(utcMs: number): string {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return dtf.format(new Date(utcMs));
}

// Day-of-week in Melbourne (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
function melbourneDow(utcMs: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "Australia/Melbourne",
    weekday: "short",
  });
  const s = dtf.format(new Date(utcMs));
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(s);
}

// ---------------------------------------------------------------------------
// Bookable window
// ---------------------------------------------------------------------------

export interface BookableWindow {
  mon?: [string, string] | null;
  tue?: [string, string] | null;
  wed?: [string, string] | null;
  thu?: [string, string] | null;
  fri?: [string, string] | null;
  sat?: [string, string] | null;
  sun?: [string, string] | null;
}

const DOW_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

function parseHm(hhmm: string): { h: number; m: number } {
  const [h, m] = hhmm.split(":").map(Number);
  return { h: h ?? 0, m: m ?? 0 };
}

// Return [startUtcMs, endUtcMs] for the bookable window on a given Melbourne date,
// or null if that day has no bookable window.
function bookableWindowForDate(
  ymdMelbourne: string,
  window: BookableWindow,
  dowMelbourne: number,
): [number, number] | null {
  const key = DOW_KEYS[dowMelbourne];
  const entry = window[key];
  if (!entry) return null;
  const { h: sh, m: sm } = parseHm(entry[0]);
  const { h: eh, m: em } = parseHm(entry[1]);
  const start = melbourneHmToUtc(ymdMelbourne, sh, sm);
  const end = melbourneHmToUtc(ymdMelbourne, eh, em);
  if (end <= start) return null;
  return [start, end];
}

// ---------------------------------------------------------------------------
// Core compute
// ---------------------------------------------------------------------------

const BUFFER_MS = 15 * 60 * 1000; // 15 min padding on each side of a busy event
const MIN_BLOCK_MS = 60 * 60 * 1000; // 60 min minimum publishable block
const TWELVE_WEEKS_MS = 12 * 7 * 24 * 60 * 60 * 1000;

export interface AvailableBlock {
  startUtcMs: number;
  endUtcMs: number;
  durationMin: number;
}

export interface ComputeAvailabilityArgs {
  calEvents: CalEvent[];
  blocks: PublicCalendarBlock[];
  bookableWindow: BookableWindow;
  now?: number;
  horizonMs?: number;
}

export function computeAvailability(args: ComputeAvailabilityArgs): AvailableBlock[] {
  const now = args.now ?? Date.now();
  const horizon = now + (args.horizonMs ?? TWELVE_WEEKS_MS);

  // Step 1: collect off-days from rule_off_day blocks
  const offDays = new Set<number>(); // 0..6 (Melbourne DoW)
  for (const b of args.blocks) {
    if (b.kind === "rule_off_day" && b.weekday !== null && b.weekday !== undefined) {
      offDays.add(b.weekday);
    }
  }

  // Step 2: build list of busy intervals from cal events
  // Each interval is [startMs, endMs] after applying BUFFER_MS
  type Interval = [number, number];
  const busyIntervals: Interval[] = [];

  for (const ev of args.calEvents) {
    if (!ev.start || !ev.end) continue;
    // All-day events on the upstream feeds are info-only markers (school terms,
    // "Kids with us", roster week labels). They span 24+ hours and would
    // otherwise blanket every bookable window in the 12-week horizon. The
    // public availability feed only treats timed events as busy. force_busy
    // blocks below remain the way to mark an all-day span busy intentionally.
    if (ev.allDay) continue;
    const s = new Date(ev.start).getTime();
    const e = new Date(ev.end).getTime();
    if (isNaN(s) || isNaN(e)) continue;
    busyIntervals.push([s - BUFFER_MS, e + BUFFER_MS]);
  }

  // force_busy blocks
  for (const b of args.blocks) {
    if (b.kind !== "force_busy" || !b.start_utc || !b.end_utc) continue;
    const s = new Date(b.start_utc).getTime();
    const e = new Date(b.end_utc).getTime();
    if (!isNaN(s) && !isNaN(e)) busyIntervals.push([s - BUFFER_MS, e + BUFFER_MS]);
  }

  // Step 3: collect force_available overrides
  const forceAvailable: Interval[] = [];
  for (const b of args.blocks) {
    if (b.kind !== "force_available" || !b.start_utc || !b.end_utc) continue;
    const s = new Date(b.start_utc).getTime();
    const e = new Date(b.end_utc).getTime();
    if (!isNaN(s) && !isNaN(e)) forceAvailable.push([s, e]);
  }

  // Step 4: merge+sort busy intervals
  busyIntervals.sort((a, b) => a[0] - b[0]);
  const mergedBusy: Interval[] = [];
  for (const iv of busyIntervals) {
    if (mergedBusy.length === 0) {
      mergedBusy.push([...iv]);
    } else {
      const last = mergedBusy[mergedBusy.length - 1];
      if (iv[0] <= last[1]) {
        last[1] = Math.max(last[1], iv[1]);
      } else {
        mergedBusy.push([...iv]);
      }
    }
  }

  // Step 5: subtract force_available spans from busy
  function subtractForceAvailable(busy: Interval[]): Interval[] {
    let result = [...busy];
    for (const [as, ae] of forceAvailable) {
      const next: Interval[] = [];
      for (const [bs, be] of result) {
        if (ae <= bs || as >= be) {
          next.push([bs, be]);
        } else {
          if (bs < as) next.push([bs, as]);
          if (be > ae) next.push([ae, be]);
        }
      }
      result = next;
    }
    return result;
  }

  const effectiveBusy = subtractForceAvailable(mergedBusy);

  // Step 6: iterate over days in the rolling 12-week window and compute gaps
  const result: AvailableBlock[] = [];

  // Start at beginning of today in Melbourne
  const todayMelbYmd = melbourneDateStr(now);
  const [ty, tm, td] = todayMelbYmd.split("-").map(Number);
  let dayCursor = Date.UTC(ty, tm - 1, td); // midnight UTC of the Melbourne day start (approximate — will be resolved per TZ)

  while (true) {
    const ymd = melbourneDateStr(dayCursor);
    const dow = melbourneDow(dayCursor);

    const bookable = bookableWindowForDate(ymd, args.bookableWindow, dow);
    if (bookable && bookable[0] >= horizon) break;
    if (!bookable || bookable[1] > horizon) {
      // Advance day
      dayCursor += 24 * 60 * 60 * 1000;
      if (dayCursor - 24 * 60 * 60 * 1000 >= horizon) break;
      continue;
    }

    // Skip if off-day
    if (offDays.has(dow)) {
      dayCursor += 24 * 60 * 60 * 1000;
      continue;
    }

    const [dayStart, dayEnd] = bookable;

    // Clip to "now" — don't publish slots in the past
    const windowStart = Math.max(dayStart, now);
    const windowEnd = dayEnd;

    if (windowStart >= windowEnd) {
      dayCursor += 24 * 60 * 60 * 1000;
      continue;
    }

    // Find busy intervals that overlap [windowStart, windowEnd]
    const dayBusy = effectiveBusy.filter((iv) => iv[0] < windowEnd && iv[1] > windowStart);

    // Build free spans within the bookable window
    let cursor = windowStart;
    for (const [bs, be] of dayBusy) {
      const gapStart = cursor;
      const gapEnd = Math.min(bs, windowEnd);
      if (gapEnd - gapStart >= MIN_BLOCK_MS) {
        result.push({
          startUtcMs: gapStart,
          endUtcMs: gapEnd,
          durationMin: Math.floor((gapEnd - gapStart) / 60000),
        });
      }
      cursor = Math.max(cursor, be);
    }
    // Trailing gap after last busy span
    const trailStart = cursor;
    const trailEnd = windowEnd;
    if (trailEnd - trailStart >= MIN_BLOCK_MS) {
      result.push({
        startUtcMs: trailStart,
        endUtcMs: trailEnd,
        durationMin: Math.floor((trailEnd - trailStart) / 60000),
      });
    }

    dayCursor += 24 * 60 * 60 * 1000;
  }

  return result;
}

// ---------------------------------------------------------------------------
// ICS emit
// ---------------------------------------------------------------------------

export function emitPublicIcs(
  blocks: AvailableBlock[],
  label = "Author Available (sanitised)",
): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Buoy//Public Availability//EN",
    `X-WR-CALNAME:${label}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];

  for (const blk of blocks) {
    const durationMin = Math.floor(blk.durationMin / 15) * 15; // round down to nearest 15
    const dtstart = fmtUtcIcs(blk.startUtcMs);
    const dtend = fmtUtcIcs(blk.endUtcMs);
    const ymd = melbourneDateStr(blk.startUtcMs).replace(/-/g, "");
    const hhmm = new Date(blk.startUtcMs)
      .toISOString()
      .slice(11, 16)
      .replace(":", "");
    const uid = `buoy-public-${ymd}-${hhmm}-${durationMin}@buoy`;
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${uid}`);
    lines.push(`DTSTART:${dtstart}`);
    lines.push(`DTEND:${dtend}`);
    lines.push(`SUMMARY:Available (${durationMin} min)`);
    lines.push("STATUS:CONFIRMED");
    lines.push("CLASS:PUBLIC");
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// Private ICS emit (apex /cal/private.ics — Outlook + synced ICS events)
// ---------------------------------------------------------------------------

export function emitPrivateIcs(calEvents: CalEvent[]): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Buoy//Private Calendar//EN",
    "X-WR-CALNAME:Buoy private",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];

  // Existing cal events (Outlook + synced ICS)
  for (const ev of calEvents) {
    const start = new Date(ev.start).getTime();
    const end = new Date(ev.end).getTime();
    if (isNaN(start) || isNaN(end)) continue;
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${icsEscape(ev.uid)}`);
    if (ev.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${ev.start.replace(/-/g, "").slice(0, 8)}`);
      lines.push(`DTEND;VALUE=DATE:${ev.end.replace(/-/g, "").slice(0, 8)}`);
    } else {
      lines.push(`DTSTART:${fmtUtcIcs(start)}`);
      lines.push(`DTEND:${fmtUtcIcs(end)}`);
    }
    lines.push(`SUMMARY:${icsEscape(ev.summary)}`);
    if (ev.location) lines.push(`LOCATION:${icsEscape(ev.location)}`);
    if (ev.description) lines.push(`DESCRIPTION:${icsEscape(ev.description)}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

function icsEscape(s: string): string {
  return (s || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

