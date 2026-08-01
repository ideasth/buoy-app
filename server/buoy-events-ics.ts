// Per-category ICS emitter for Buoy adhoc events.
//
// build_calendars.py fetches these three endpoints and merges them into the
// existing subscribed ICS bundles (Oliver-Work.ics, Oliver-Personal.ics,
// Family-Events.ics) before writing them out. This means the user's Apple
// Calendar / Outlook subscriptions do not need to change.
//
// UID convention: buoy-adhoc-<category>-<id>@buoy so the events are stable
// across rebuilds and de-duplicable if they ever leak into multiple bundles.

import { BuoyEvent, BuoyEventCategory } from "./buoy-events-storage";

const CAL_NAMES: Record<BuoyEventCategory, string> = {
  oliver_work: "Buoy Adhoc — Oliver Work",
  oliver_personal: "Buoy Adhoc — Oliver Personal",
  family: "Buoy Adhoc — Family",
};

function pad(n: number, w = 2): string {
  return String(n).padStart(w, "0");
}

function fmtUtcIcs(utcMs: number): string {
  const d = new Date(utcMs);
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

function melbourneDateStr(utcMs: number): string {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return dtf.format(new Date(utcMs));
}

function icsEscape(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// Fold long lines to 75 octets per RFC 5545. Not strict octet counting — a
// character-based approximation is fine for the small titles/locations we
// emit here (no CJK content), and folding wrong just makes long lines less
// pretty, not invalid, for the downstream Python parser.
function fold(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  let i = 0;
  chunks.push(line.slice(0, 75));
  i = 75;
  while (i < line.length) {
    chunks.push(" " + line.slice(i, i + 74));
    i += 74;
  }
  return chunks.join("\r\n");
}

export function emitAdhocCategoryIcs(
  category: BuoyEventCategory,
  events: BuoyEvent[],
): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Buoy//Adhoc Events//EN",
    `X-WR-CALNAME:${CAL_NAMES[category]}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];

  for (const ev of events) {
    if (ev.deleted_at) continue;
    if (ev.category !== category) continue;

    const startMs = new Date(ev.start_utc).getTime();
    const endMs = new Date(ev.end_utc).getTime();
    if (isNaN(startMs) || isNaN(endMs)) continue;

    lines.push("BEGIN:VEVENT");
    lines.push(fold(`UID:buoy-adhoc-${ev.category}-${ev.id}@buoy`));
    if (ev.all_day) {
      // Date-only: Melbourne wall-clock start date; end date is exclusive per iCal.
      const startYmd = melbourneDateStr(startMs).replace(/-/g, "");
      const endYmd = melbourneDateStr(endMs).replace(/-/g, "");
      lines.push(`DTSTART;VALUE=DATE:${startYmd}`);
      lines.push(`DTEND;VALUE=DATE:${endYmd}`);
    } else {
      lines.push(`DTSTART:${fmtUtcIcs(startMs)}`);
      lines.push(`DTEND:${fmtUtcIcs(endMs)}`);
    }
    lines.push(fold(`SUMMARY:${icsEscape(ev.title)}`));
    if (ev.location) lines.push(fold(`LOCATION:${icsEscape(ev.location)}`));
    if (ev.notes) lines.push(fold(`DESCRIPTION:${icsEscape(ev.notes)}`));
    // SQLite datetime('now') returns 'YYYY-MM-DD HH:MM:SS' (UTC, no Z).
    // Parse defensively and fall back to the event start if updated_at
    // isn't a recognisable timestamp.
    const dtstampMs = (() => {
      const raw = ev.updated_at || "";
      const iso = /T|Z$/.test(raw) ? raw : raw.replace(" ", "T") + "Z";
      const t = Date.parse(iso);
      return isNaN(t) ? startMs : t;
    })();
    lines.push(`DTSTAMP:${fmtUtcIcs(dtstampMs)}`);
    lines.push("STATUS:CONFIRMED");
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
