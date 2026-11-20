// Helpers used by the Morning routine routes.
//
// inferDomain: maps a free-text braindump line to one of Anchor's five domains.
// melbourneDateStr: returns YYYY-MM-DD in Australia/Melbourne for "now".

export type Domain = "family" | "work" | "medicolegal" | "personal" | "health";

export function inferDomain(line: string): Domain {
  const l = line.toLowerCase();
  // Family
  if (/(hilde|axel|marieke|kids|school|family|home|grocer|cook|laundry|childcare)/i.test(l))
    return "family";
  // Health
  if (
    /(gp|doctor|dentist|physio|gym|cycle|ride|run|sleep|meditation|appointment)/i.test(l) &&
    !/medicolegal/i.test(l)
  )
    return "health";
  // Medicolegal
  if (/(medicolegal|legal|report|expert|case|court|opinion|affidavit|witness)/i.test(l))
    return "medicolegal";
  // Work
  if (/^(call|email|draft|review|sign|approve|book|prep|finish|send|reply|fix|update|write)\b/i.test(l))
    return "work";
  if (
    /(sandy|peninsula|elgin|aupfhs|bayside|epworth|patient|clinic|surgery|teams|outlook|sharepoint|powerapp|on.?call|roster|theatre)/i.test(l)
  )
    return "work";
  return "personal";
}

// Get the YYYY-MM-DD date for "now" interpreted in Australia/Melbourne.
// Uses Intl.DateTimeFormat which is built-in to Node 18+.
export function melbourneDateStr(d: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // en-CA gives "YYYY-MM-DD" directly.
  return fmt.format(d);
}

// Returns the current time-of-day in Melbourne as { hours, minutes }.
export function melbourneNowParts(d: Date = new Date()): { hours: number; minutes: number } {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Australia/Melbourne",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return { hours: hh, minutes: mm };
}

// Return the YYYY-MM-DD string offset by `n` days (negative for past).
export function shiftDate(date: string, n: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

// Parse a JSON-encoded array of numbers, tolerantly.
export function parseIdArray(v: string | null | undefined): number[] {
  if (!v) return [];
  try {
    const arr = JSON.parse(v);
    if (Array.isArray(arr)) return arr.filter((x) => typeof x === "number");
  } catch {
    // ignore
  }
  return [];
}

// Stage 38 — clean slate. A task is "open" only when todo/doing; "parked"
// (Backlog) tasks are hidden from Morning, Today and coach context until
// restored. Morning shows only: overdue by up to 7 days, due in the next
// 7 days, created in the last 24 h (incl. today's brain dump), and
// yesterday's unfinished Top 3.
export const MORNING_DUE_WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;

export interface EligibleTaskLike {
  id: number; status: string; dueAt: number | null; createdAt: number; tag?: string | null;
}

export function isOpenStatus(s: string): boolean {
  return s === "todo" || s === "doing";
}

export function selectMorningEligible<T extends EligibleTaskLike>(
  tasks: T[], opts: { dayStartTs: number; nowMs: number; yesterdayTopIds: Set<number>; limit?: number },
): T[] {
  const win = MORNING_DUE_WINDOW_DAYS * DAY_MS;
  const windowEnd = opts.dayStartTs + (MORNING_DUE_WINDOW_DAYS + 1) * DAY_MS - 1;
  const out: Array<{ t: T; b: number }> = [];
  for (const t of tasks) {
    if (!isOpenStatus(t.status)) continue;
    let b = -1;
    if (t.dueAt && t.dueAt < opts.dayStartTs && t.dueAt >= opts.dayStartTs - win) b = 0;
    else if (t.dueAt && t.dueAt >= opts.dayStartTs && t.dueAt <= windowEnd) b = 1;
    else if (t.createdAt >= opts.nowMs - DAY_MS) b = 2;
    else if (opts.yesterdayTopIds.has(t.id)) b = 3;
    if (b >= 0) out.push({ t, b });
  }
  out.sort((a, z) => a.b - z.b || (a.t.dueAt ?? Infinity) - (z.t.dueAt ?? Infinity) || a.t.id - z.t.id);
  return out.slice(0, opts.limit ?? 30).map((x) => x.t);
}

/** Stage 38 — which open tasks a "park everything before X" reset moves. */
export function planPark<T extends EligibleTaskLike>(
  tasks: T[], opts: { before: number; nowMs: number; keepDueDays?: number },
): { park: T[]; keep: T[] } {
  const keepMs = (opts.keepDueDays ?? MORNING_DUE_WINDOW_DAYS) * DAY_MS;
  const park: T[] = []; const keep: T[] = [];
  for (const t of tasks) {
    if (!isOpenStatus(t.status) || t.createdAt >= opts.before) continue;
    const dueSoon = !!t.dueAt && t.dueAt >= opts.nowMs - keepMs && t.dueAt <= opts.nowMs + keepMs;
    (dueSoon ? keep : park).push(t);
  }
  return { park, keep };
}
