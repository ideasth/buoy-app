// filepath: /home/user/workspace/anchor/server/ontime/time.ts
// Stage 25 (On Time) — Australia/Melbourne wall-clock helpers.
// The server runs in UTC; every user-facing time in On Time is Melbourne
// wall-clock, so we convert explicitly rather than trusting process TZ.

export const TZ = "Australia/Melbourne";

/** Offset (ms) of Melbourne from UTC at the given instant. */
export function tzOffsetMs(instantMs: number, tz = TZ): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(instantMs))) parts[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second),
  );
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/** UTC ms for a Melbourne wall-clock date (YYYY-MM-DD) and time (HH:MM). */
export function melbToUtcMs(dateKey: string, hhmm: string, tz = TZ): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm, 0);
  // Two passes handle DST boundaries correctly.
  let t = guess - tzOffsetMs(guess, tz);
  t = guess - tzOffsetMs(t, tz);
  return t;
}

/** YYYY-MM-DD in Melbourne for an instant. */
export function melbDateKey(instantMs: number, tz = TZ): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(instantMs));
}

/** HH:MM (24h) in Melbourne for an instant. */
export function melbHHMM(instantMs: number, tz = TZ): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(instantMs));
}

/** ISO weekday 1=Mon..7=Sun in Melbourne. */
export function melbWeekday(instantMs: number, tz = TZ): number {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" })
    .format(new Date(instantMs));
  return ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 } as Record<string, number>)[wd] ?? 1;
}

/** Add n days to a YYYY-MM-DD key. */
export function addDaysKey(dateKey: string, n: number): string {
  const d = new Date(dateKey + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Minutes since midnight for HH:MM. */
export function hhmmToMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Is the Melbourne wall-clock time of `instantMs` inside quiet hours? */
export function inQuietHours(instantMs: number, startHHMM: string, endHHMM: string): boolean {
  const cur = hhmmToMin(melbHHMM(instantMs));
  const s = hhmmToMin(startHHMM);
  const e = hhmmToMin(endHHMM);
  if (s === e) return false;
  return s < e ? cur >= s && cur < e : cur >= s || cur < e;
}
