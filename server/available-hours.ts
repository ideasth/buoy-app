// Available-hours calculator for the current week (Mon-Sun, Australia/Melbourne).
//
// Inputs: merged calendar events from getMergedPlannerEvents().
// Output: a structured breakdown of waking/paid/family/committed/free hours,
// plus a list of "deep work blocks" (contiguous free windows of >= MIN_DEEP_WORK_MINUTES).
//
// Definitions:
//   - The week runs Monday 00:00 to Sunday 23:59:59.999 in Australia/Melbourne.
//   - Sleep: 23:00 - 07:00 (configurable later via Settings if needed).
//   - Paid work: events whose summary does NOT start with "[Personal]".
//     Rationale: AUPFHS Outlook publish events arrive prefixed; the master
//     calendar carries Oliver's clinical work events without prefix.
//     This is the same convention used in routes.ts:266.
//   - Family: events tagged via summary keyword match (kids names, school,
//     marieke, family). Falls back to "other_committed" if no tag fires.
//   - Other committed: anything else that's an event in calendar (medical
//     appts, personal appts, etc).
//   - Free: waking minutes minus all of the above (clamped to >= 0).
//   - Deep work block: a contiguous run of free minutes >= MIN_DEEP_WORK_MINUTES,
//     bounded to waking hours, not crossing day boundaries.
//
// The calculator deals only in MELBOURNE wall-clock minutes-since-midnight
// per-day, then sums.

import type { CalEvent } from "./ics";

const MIN_DEEP_WORK_MINUTES = 30;
const SLEEP_START_HOUR = 23; // 23:00
const SLEEP_END_HOUR = 7; // 07:00

// Keyword-based event classifier. Order matters: family beats work.
function classifyEvent(summary: string): "paid_work" | "family" | "other_committed" {
  const s = (summary || "").toLowerCase();

  // Family signals (loosely overlapping with morning-helpers.inferDomain).
  if (/(hilde|axel|tilly|matilda|poppy|penelope|marieke|kids|school|family|childcare|alia)/i.test(s)) {
    return "family";
  }

  // Personal-prefixed events from AUPFHS feed. These ARE paid clinical work
  // (Oliver's AUPFHS Outlook calendar), even though prefixed [Personal].
  if (s.startsWith("[personal]")) {
    return "paid_work";
  }

  // Work signals: clinical sites, hospitals, clinical activity.
  if (/(sandy|sandringham|peninsula|elgin|aupfhs|bayside|epworth|monash|patient|clinic|surgery|theatre|on.?call|roster|consult|gyn|gynae|obstetric|ranzcog|iuga|ugsa|medicolegal|safer.?care|ward.?round)/i.test(s)) {
    return "paid_work";
  }

  return "other_committed";
}

// Format a Date instant into Melbourne YYYY-MM-DD plus hour/minute parts.
function melbourneParts(d: Date): { ymd: string; hours: number; minutes: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const ymd = `${get("year")}-${get("month")}-${get("day")}`;
  const hh = Number(get("hour"));
  const mm = Number(get("minute"));
  return { ymd, hours: hh, minutes: mm };
}

// ISO week label "YYYY-Www" computed in Melbourne time.
function isoWeekLabelMelbourne(d: Date): string {
  // ISO weeks start Monday. We want the week label for the Monday of the
  // current Melbourne week. Cheap approach: take Melbourne-Monday's date
  // and let the standard ISO week algorithm do its thing.
  const { ymd } = melbourneParts(d);
  const [yr, mo, dy] = ymd.split("-").map(Number);
  const localMidnightUtc = Date.UTC(yr, mo - 1, dy);
  const dt = new Date(localMidnightUtc);
  const day = (dt.getUTCDay() + 6) % 7; // 0 = Mon
  dt.setUTCDate(dt.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((dt.getTime() - firstThursday.getTime()) / 86400000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7,
    );
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// Returns Monday 00:00 and Sunday 23:59:59.999 of the current Melbourne week,
// expressed as UTC-anchored Date instants. Bounds are inclusive on the start,
// exclusive on the end ("Monday next").
function melbourneWeekBounds(now: Date = new Date()): {
  start: Date;
  endExclusive: Date;
  mondayYmd: string;
  sundayYmd: string;
} {
  const { ymd } = melbourneParts(now);
  const [yr, mo, dy] = ymd.split("-").map(Number);
  // What day of week is the Melbourne "today"?
  const probeUtc = new Date(Date.UTC(yr, mo - 1, dy, 12, 0, 0));
  // Re-render that date in Melbourne to get its weekday name.
  const wfmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Australia/Melbourne",
    weekday: "short",
  });
  const dayName = wfmt.format(probeUtc);
  const dayMap: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  const dayIdx = dayMap[dayName] ?? 0;

  // Build the Monday Y-M-D by subtracting dayIdx days from today.
  const mondayDt = new Date(Date.UTC(yr, mo - 1, dy));
  mondayDt.setUTCDate(mondayDt.getUTCDate() - dayIdx);
  const sundayDt = new Date(mondayDt);
  sundayDt.setUTCDate(sundayDt.getUTCDate() + 6);

  const fmtDate = (d: Date) => {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  const mondayYmd = fmtDate(mondayDt);
  const sundayYmd = fmtDate(sundayDt);

  // Convert Monday 00:00 Melbourne and Monday-after 00:00 Melbourne to UTC instants.
  // Use the same trick as ics.ts: build a probe and walk the offset.
  const startUtc = melbourneWallToUtc(mondayYmd, 0, 0);
  const nextMonday = new Date(mondayDt);
  nextMonday.setUTCDate(nextMonday.getUTCDate() + 7);
  const nextMondayYmd = fmtDate(nextMonday);
  const endExclusiveUtc = melbourneWallToUtc(nextMondayYmd, 0, 0);

  return { start: startUtc, endExclusive: endExclusiveUtc, mondayYmd, sundayYmd };
}

// Convert a Melbourne wall-clock (YYYY-MM-DD + HH + MM) to a UTC Date.
function melbourneWallToUtc(ymd: string, hh: number, mm: number): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  // First, build a tentative UTC instant assuming Melbourne == UTC.
  let tentative = new Date(Date.UTC(y, m - 1, d, hh, mm, 0));
  // Render that instant in Melbourne — the difference tells us the offset.
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const p = fmt.formatToParts(tentative);
  const got = (t: string) => Number(p.find((x) => x.type === t)?.value ?? "0");
  const renderedY = got("year");
  const renderedMo = got("month");
  const renderedD = got("day");
  const renderedH = got("hour");
  const renderedMin = got("minute");
  // delta minutes between rendered Melbourne wall-clock and intended wall-clock.
  const intendedMs = Date.UTC(y, m - 1, d, hh, mm, 0);
  const renderedMs = Date.UTC(renderedY, renderedMo - 1, renderedD, renderedH, renderedMin, 0);
  const offsetMs = intendedMs - renderedMs;
  return new Date(tentative.getTime() + offsetMs);
}

interface DayBucket {
  ymd: string;
  // For each minute-of-day [0..1440), is it covered by an event?
  occupied: boolean[];
  // Per-classification minutes count (only over waking minutes).
  paidMinutes: number;
  familyMinutes: number;
  otherCommittedMinutes: number;
}

function isWakingMinute(minuteOfDay: number): boolean {
  // Waking = NOT [SLEEP_START_HOUR*60, SLEEP_END_HOUR*60+1440?) — but here we
  // treat the day as 0..1440, with sleep being [0..7*60) U [23*60..1440).
  const sleepStartMin = SLEEP_START_HOUR * 60;
  const sleepEndMin = SLEEP_END_HOUR * 60;
  if (minuteOfDay < sleepEndMin) return false;
  if (minuteOfDay >= sleepStartMin) return false;
  return true;
}

export interface DeepWorkBlock {
  ymd: string;
  startMin: number; // minute-of-day (Melbourne)
  endMin: number; // exclusive
  minutes: number;
}

export interface AvailableHoursThisWeek {
  weekLabel: string;
  mondayYmd: string;
  sundayYmd: string;
  // All values are MINUTES. The client formats to hours.
  totalWeekMinutes: number;
  sleepMinutes: number;
  totalWakingMinutes: number;
  paidWorkMinutes: number;
  familyMinutes: number;
  otherCommittedMinutes: number;
  freeMinutes: number;
  deepWorkBlocks: DeepWorkBlock[];
  deepWorkTotalMinutes: number;
  fragmentedMinutes: number; // free minutes not part of any deep-work block
  generatedAt: string; // ISO
}

// ---------------------------------------------------------------------------
// Today variant — single Melbourne day. Used by the Morning page (2026-05-09).
//
// Differences from this-week:
//   - Window is the current Melbourne day [00:00 .. next-day 00:00).
//   - Adds a `transitMinutes` total: sum of `allowMinutes` from per-event
//     travel calculations (passed in from routes via `eventTransitMinutes`).
//     This is the same number the Today's-events Leave-by labels use.
//   - `freeMinutes = wakingMinutes - paid - family - other_committed - transit`.
//     Transit is subtracted from waking; it is NOT double-counted with the
//     event's own classification, because transit happens BEFORE the event
//     starts (it's outside the event's wall-clock minutes).
// ---------------------------------------------------------------------------

export interface AvailableHoursToday {
  todayYmd: string;
  totalDayMinutes: number; // 1440
  sleepMinutes: number; // 480 (00:00-07:00 + 23:00-24:00 = 7h+1h = 8h)
  totalWakingMinutes: number; // 960 (16h)
  paidWorkMinutes: number;
  familyMinutes: number;
  otherCommittedMinutes: number;
  transitMinutes: number;
  freeMinutes: number;
  generatedAt: string;
}

export function computeAvailableHoursToday(
  events: CalEvent[],
  eventTransitMinutes: Map<string, number>,
  now: Date = new Date(),
): AvailableHoursToday {
  const { ymd: todayYmd } = melbourneParts(now);
  const dayStart = melbourneWallToUtc(todayYmd, 0, 0);
  // Compute next-day YMD by walking forward 24h then re-rendering in Melbourne.
  const nextDayProbe = new Date(dayStart.getTime() + 26 * 60 * 60 * 1000); // safe past DST
  const nextDayYmd = melbourneParts(nextDayProbe).ymd;
  const dayEnd = melbourneWallToUtc(nextDayYmd, 0, 0);

  // Single-day occupancy bitmap.
  const occupied: boolean[] = new Array(1440).fill(false);
  let paidMinutes = 0;
  let familyMinutes = 0;
  let otherCommittedMinutes = 0;
  let transitMinutes = 0;

  for (const ev of events) {
    if (ev.allDay) continue;
    const evStart = new Date(ev.start);
    const evEnd = new Date(ev.end);
    if (!(evEnd > dayStart && evStart < dayEnd)) continue;

    const klass = classifyEvent(ev.summary);
    const clipStart = evStart < dayStart ? dayStart : evStart;
    const clipEnd = evEnd > dayEnd ? dayEnd : evEnd;
    if (clipEnd <= clipStart) continue;

    const totalMin = Math.min(
      Math.ceil((clipEnd.getTime() - clipStart.getTime()) / 60000),
      1440,
    );
    for (let m = 0; m < totalMin; m++) {
      const inst = new Date(clipStart.getTime() + m * 60000);
      const { ymd, hours, minutes } = melbourneParts(inst);
      if (ymd !== todayYmd) continue;
      const minOfDay = hours * 60 + minutes;
      if (minOfDay < 0 || minOfDay >= 1440) continue;
      if (occupied[minOfDay]) continue;
      occupied[minOfDay] = true;
      if (!isWakingMinute(minOfDay)) continue;
      if (klass === "paid_work") paidMinutes += 1;
      else if (klass === "family") familyMinutes += 1;
      else otherCommittedMinutes += 1;
    }

    // Transit (allowMinutes) is keyed by event uid. Sum all of today's events.
    const t = eventTransitMinutes.get(ev.uid);
    if (typeof t === "number" && Number.isFinite(t) && t > 0) {
      transitMinutes += Math.round(t);
    }
  }

  const totalDayMinutes = 1440;
  const wakingPerDay = (SLEEP_START_HOUR - SLEEP_END_HOUR) * 60; // 960
  const totalWakingMinutes = wakingPerDay;
  const sleepMinutes = totalDayMinutes - totalWakingMinutes;

  const freeMinutes = Math.max(
    0,
    totalWakingMinutes - paidMinutes - familyMinutes - otherCommittedMinutes - transitMinutes,
  );

  return {
    todayYmd,
    totalDayMinutes,
    sleepMinutes,
    totalWakingMinutes,
    paidWorkMinutes: paidMinutes,
    familyMinutes,
    otherCommittedMinutes,
    transitMinutes,
    freeMinutes,
    generatedAt: new Date().toISOString(),
  };
}

export function computeAvailableHoursThisWeek(
  events: CalEvent[],
  now: Date = new Date(),
): AvailableHoursThisWeek {
  const { start: weekStart, endExclusive: weekEnd, mondayYmd, sundayYmd } =
    melbourneWeekBounds(now);
  const weekLabel = isoWeekLabelMelbourne(now);

  // Build 7 day buckets.
  const days: DayBucket[] = [];
  {
    let cursor = new Date(weekStart);
    for (let i = 0; i < 7; i++) {
      const { ymd } = melbourneParts(cursor);
      days.push({
        ymd,
        occupied: new Array(1440).fill(false),
        paidMinutes: 0,
        familyMinutes: 0,
        otherCommittedMinutes: 0,
      });
      cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    }
  }
  const ymdToIndex = new Map(days.map((d, i) => [d.ymd, i] as const));

  // Walk events, paint minutes.
  for (const ev of events) {
    if (ev.allDay) continue; // all-day events don't block hours; they're informational
    const evStart = new Date(ev.start);
    const evEnd = new Date(ev.end);
    if (!(evEnd > weekStart && evStart < weekEnd)) continue;

    const klass = classifyEvent(ev.summary);

    // Clip to week.
    const clipStart = evStart < weekStart ? weekStart : evStart;
    const clipEnd = evEnd > weekEnd ? weekEnd : evEnd;
    if (clipEnd <= clipStart) continue;

    // Walk minute by minute. Cap at 1 week == 10080 minutes for safety.
    const totalMin = Math.min(
      Math.ceil((clipEnd.getTime() - clipStart.getTime()) / 60000),
      10080,
    );
    for (let m = 0; m < totalMin; m++) {
      const inst = new Date(clipStart.getTime() + m * 60000);
      const { ymd, hours, minutes } = melbourneParts(inst);
      const dayIdx = ymdToIndex.get(ymd);
      if (dayIdx === undefined) continue;
      const minOfDay = hours * 60 + minutes;
      if (minOfDay < 0 || minOfDay >= 1440) continue;
      const day = days[dayIdx];
      if (day.occupied[minOfDay]) continue; // already counted; first-event-wins
      day.occupied[minOfDay] = true;
      // Only count toward category totals if this minute is a waking minute.
      if (!isWakingMinute(minOfDay)) continue;
      if (klass === "paid_work") day.paidMinutes += 1;
      else if (klass === "family") day.familyMinutes += 1;
      else day.otherCommittedMinutes += 1;
    }
  }

  // Aggregate.
  let paidWorkMinutes = 0;
  let familyMinutes = 0;
  let otherCommittedMinutes = 0;
  for (const d of days) {
    paidWorkMinutes += d.paidMinutes;
    familyMinutes += d.familyMinutes;
    otherCommittedMinutes += d.otherCommittedMinutes;
  }

  const totalWeekMinutes = 7 * 1440;
  // Sleep minutes per day = 1440 - (waking minutes per day).
  // Waking minutes per day = (SLEEP_START_HOUR - SLEEP_END_HOUR) * 60.
  const wakingPerDay = (SLEEP_START_HOUR - SLEEP_END_HOUR) * 60; // 16h * 60 = 960
  const totalWakingMinutes = wakingPerDay * 7; // 6720
  const sleepMinutes = totalWeekMinutes - totalWakingMinutes;

  const committedMinutes = paidWorkMinutes + familyMinutes + otherCommittedMinutes;
  const freeMinutes = Math.max(0, totalWakingMinutes - committedMinutes);

  // Compute deep-work blocks per day. A "block" = run of waking, unoccupied
  // minutes, of length >= MIN_DEEP_WORK_MINUTES, not crossing day boundary.
  const deepWorkBlocks: DeepWorkBlock[] = [];
  for (const d of days) {
    let runStart: number | null = null;
    for (let m = 0; m < 1440; m++) {
      const free = isWakingMinute(m) && !d.occupied[m];
      if (free) {
        if (runStart === null) runStart = m;
      } else {
        if (runStart !== null) {
          const len = m - runStart;
          if (len >= MIN_DEEP_WORK_MINUTES) {
            deepWorkBlocks.push({ ymd: d.ymd, startMin: runStart, endMin: m, minutes: len });
          }
          runStart = null;
        }
      }
    }
    // Tail run.
    if (runStart !== null) {
      const len = 1440 - runStart;
      if (len >= MIN_DEEP_WORK_MINUTES) {
        deepWorkBlocks.push({ ymd: d.ymd, startMin: runStart, endMin: 1440, minutes: len });
      }
    }
  }
  const deepWorkTotalMinutes = deepWorkBlocks.reduce((a, b) => a + b.minutes, 0);
  const fragmentedMinutes = Math.max(0, freeMinutes - deepWorkTotalMinutes);

  return {
    weekLabel,
    mondayYmd,
    sundayYmd,
    totalWeekMinutes,
    sleepMinutes,
    totalWakingMinutes,
    paidWorkMinutes,
    familyMinutes,
    otherCommittedMinutes,
    freeMinutes,
    deepWorkBlocks,
    deepWorkTotalMinutes,
    fragmentedMinutes,
    generatedAt: new Date().toISOString(),
  };
}
