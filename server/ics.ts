// Lightweight ICS parser modeled after upstream_feeds.py.
// Parses VEVENTs into a normalised JSON shape for the frontend.

export interface CalEvent {
  uid: string;
  summary: string;
  start: string; // ISO string (local floating)
  end: string;
  allDay: boolean;
  description?: string;
  location?: string;
}

function unfold(text: string): string {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out.join("\n");
}

function unescape(s: string): string {
  return s
    .replace(/\\n/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function parseProperty(line: string): { name: string; params: Record<string, string>; value: string } {
  if (!line.includes(":")) return { name: line, params: {}, value: "" };
  const idx = line.indexOf(":");
  const head = line.slice(0, idx);
  const value = line.slice(idx + 1);
  const parts = head.split(";");
  const name = parts[0].toUpperCase();
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf("=");
    if (eq >= 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
  }
  return { name, params, value };
}

// Returns the offset, in minutes, of Australia/Melbourne from UTC at the
// given UTC instant. AEST = +600, AEDT = +660. Works regardless of the
// host's system timezone (Perplexity sandboxes run UTC).
function melbourneOffsetMinutes(utcMs: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "Australia/Melbourne",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? "0", 10);
  let hh = get("hour");
  if (hh === 24) hh = 0; // Intl quirk for midnight in some locales
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), hh, get("minute"), get("second"));
  return Math.round((asUtc - utcMs) / 60000);
}

// Convert a wall-clock time (assumed to be in Australia/Melbourne) to the
// true UTC instant. Iterates twice to settle correctly across DST cutovers.
function melbourneWallClockToUtc(y: number, m: number, d: number, hh: number, mm: number, ss: number): Date {
  let guess = Date.UTC(y, m - 1, d, hh, mm, ss);
  for (let i = 0; i < 2; i++) {
    const offset = melbourneOffsetMinutes(guess);
    guess = Date.UTC(y, m - 1, d, hh, mm, ss) - offset * 60000;
  }
  return new Date(guess);
}

function parseDt(value: string, params: Record<string, string>): { dt: Date; allDay: boolean } {
  const isDate = params.VALUE === "DATE" || (value.length === 8 && !value.includes("T"));
  if (isDate) {
    const y = parseInt(value.slice(0, 4), 10);
    const m = parseInt(value.slice(4, 6), 10);
    const d = parseInt(value.slice(6, 8), 10);
    // All-day: keep as local-floating midnight (date-only — no TZ semantics).
    return { dt: new Date(y, m - 1, d, 0, 0, 0, 0), allDay: true };
  }
  const raw = value.endsWith("Z") ? value.slice(0, -1) : value;
  const y = parseInt(raw.slice(0, 4), 10);
  const m = parseInt(raw.slice(4, 6), 10);
  const d = parseInt(raw.slice(6, 8), 10);
  const hh = parseInt(raw.slice(9, 11), 10);
  const mm = parseInt(raw.slice(11, 13), 10);
  const ss = raw.length >= 15 ? parseInt(raw.slice(13, 15), 10) : 0;
  // Z-suffixed values are already true UTC instants (foreign-timezone travel legs
  // emitted by build_calendars.py). Anything else from our upstream feed is a
  // wall-clock time in Australia/Melbourne (DTSTART;TZID=Australia/Melbourne:...).
  // Convert it to the actual UTC instant so the frontend's `new Date(iso).getHours()`
  // (which renders in the browser's local zone) shows the original AEST/AEDT wall-clock.
  const dt = value.endsWith("Z")
    ? new Date(Date.UTC(y, m - 1, d, hh, mm, ss))
    : melbourneWallClockToUtc(y, m, d, hh, mm, ss);
  return { dt, allDay: false };
}

export function parseIcs(text: string): CalEvent[] {
  const unfolded = unfold(text);
  const events: CalEvent[] = [];
  let cur: Partial<CalEvent> | null = null;

  for (const raw of unfolded.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line === "BEGIN:VEVENT") {
      cur = {};
    } else if (line === "END:VEVENT") {
      if (cur && cur.summary && cur.start && cur.end) {
        events.push({
          uid: cur.uid ?? cryptoRandom(),
          summary: cur.summary,
          start: cur.start,
          end: cur.end,
          allDay: cur.allDay ?? false,
          description: cur.description,
          location: cur.location,
        });
      }
      cur = null;
    } else if (cur) {
      const { name, params, value } = parseProperty(line);
      if (name === "UID") cur.uid = value;
      else if (name === "SUMMARY") cur.summary = unescape(value);
      else if (name === "DESCRIPTION") cur.description = unescape(value);
      else if (name === "LOCATION") cur.location = unescape(value);
      else if (name === "DTSTART") {
        const { dt, allDay } = parseDt(value, params);
        cur.start = dt.toISOString();
        cur.allDay = allDay;
      } else if (name === "DTEND") {
        const { dt } = parseDt(value, params);
        cur.end = dt.toISOString();
      }
    }
  }
  return events;
}

function cryptoRandom() {
  return Math.random().toString(36).slice(2);
}

// ---- Cache ----
// Per-URL cache so multiple feeds (e.g. master ICS + AUPFHS) can coexist.
const cacheByUrl = new Map<string, { fetchedAt: number; events: CalEvent[] }>();
const TTL_MS = 15 * 60 * 1000;

export async function getCachedEvents(url: string, force = false): Promise<CalEvent[]> {
  const now = Date.now();
  const cached = cacheByUrl.get(url);
  if (!force && cached && now - cached.fetchedAt < TTL_MS) {
    return cached.events;
  }
  try {
    // Strip embedded credentials from the URL (Node's fetch rejects them) and
    // forward them as a Basic Auth header instead.
    const headers: Record<string, string> = { "User-Agent": "Anchor/1.0 (oliver-daly)" };
    let cleanUrl = url;
    try {
      const parsed = new URL(url);
      if (parsed.username || parsed.password) {
        const user = decodeURIComponent(parsed.username);
        const pass = decodeURIComponent(parsed.password);
        // For raw.githubusercontent.com, fine-grained PATs work as either a
        // bearer token OR Basic auth with the PAT as the password (any user).
        // Basic auth is the most universally compatible form, so use that.
        if (user && !pass) {
          headers["Authorization"] =
            "Basic " + Buffer.from(`x-access-token:${user}`).toString("base64");
        } else {
          headers["Authorization"] =
            "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
        }
        parsed.username = "";
        parsed.password = "";
        cleanUrl = parsed.toString();
      }
    } catch {}
    const res = await fetch(cleanUrl, { headers });
    if (!res.ok) {
      throw new Error(`ICS fetch ${res.status}`);
    }
    const text = await res.text();
    const events = parseIcs(text);
    cacheByUrl.set(url, { fetchedAt: now, events });
    return events;
  } catch (err) {
    if (cached) {
      console.warn("[ics] fetch failed, using cache:", (err as Error).message);
      return cached.events;
    }
    console.warn("[ics] fetch failed, no cache:", (err as Error).message);
    return [];
  }
}

// Fetch and merge multiple ICS feeds. Per-feed prefixes can be supplied so
// downstream column classifiers (e.g. "[Personal] \u2026" \u2192 Oliver-All) work.
// Events with no summary or that can't be fetched are skipped silently.
export async function getCachedEventsForFeeds(
  feeds: Array<{ url: string; summaryPrefix?: string }>,
  force = false,
): Promise<CalEvent[]> {
  const all: CalEvent[] = [];
  for (const feed of feeds) {
    if (!feed.url) continue;
    const events = await getCachedEvents(feed.url, force);
    if (feed.summaryPrefix) {
      for (const e of events) {
        const sum = (e.summary || "").trim();
        // Skip re-prefixing if it already starts with the same tag
        if (sum.startsWith(feed.summaryPrefix)) {
          all.push(e);
        } else {
          all.push({ ...e, summary: `${feed.summaryPrefix} ${sum}`.trim() });
        }
      }
    } else {
      all.push(...events);
    }
  }
  return all;
}

// YYYY-MM-DD in Australia/Melbourne for the given Date instant. The server
// runs in UTC, so we cannot rely on `getFullYear()` etc. directly — events are
// now stored as true UTC instants and must be projected back into AEST/AEDT
// for date-bucketing.
export function melbourneDateKey(d: Date): string {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Melbourne",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  // en-CA gives YYYY-MM-DD directly.
  return dtf.format(d);
}

export function eventsForDate(events: CalEvent[], date: Date): CalEvent[] {
  const target = melbourneDateKey(date);
  return events
    .filter((e) => {
      const s = new Date(e.start);
      const en = new Date(e.end);
      // All-day events are stored as local-floating midnights in UTC fields
      // (no real timezone). Read their wall-clock components from UTC fields
      // so we don't double-shift them.
      const startKey = e.allDay
        ? `${s.getUTCFullYear()}-${String(s.getUTCMonth() + 1).padStart(2, "0")}-${String(s.getUTCDate()).padStart(2, "0")}`
        : melbourneDateKey(s);
      const endKey = e.allDay
        ? `${en.getUTCFullYear()}-${String(en.getUTCMonth() + 1).padStart(2, "0")}-${String(en.getUTCDate()).padStart(2, "0")}`
        : melbourneDateKey(en);
      return startKey <= target && endKey >= target;
    })
    .sort((a, b) => +new Date(a.start) - +new Date(b.start));
}
