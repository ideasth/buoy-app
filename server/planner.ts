// Planner helpers — OOO/travel detection + XLSX export.
//
// 2026-05-06 restructure: the workbook now mirrors the year-grouped table in
// CalendarPlanner.tsx — 4 super-groups × 7 leaf columns:
//
//   Oliver           : Oliver-All
//   Marieke          : Marieke Art
//   Marieke & Oliver : Couple
//   Family           : Kids with Us | Kids Activities | Kids Term Dates | Public Holidays
//
// Sheets emitted (range = caller's [from, to]):
//   1. Year Overview   — Date | Day | Event count | OOO?
//   2. Year Planner    — wide grouped table (one row per day, 7 leaf columns)
//   3. Monthly sheets  — calendar grid (Mon-first), tinted by 4-group category
//   4. Weekly sheets   — Date | Day | Time | Event | Location, tinted by 4-group
//   5. OOO + Travel    — flagged events
//   6. Notes           — free-text day notes
//   7. Legend          — colour key + range/generated stamp
import ExcelJS from "exceljs";
import type { CalEvent } from "./ics";
import type { PlannerNote } from "@shared/schema";

const OOO_STRONG = [
  "travel —",
  "travel -",
  "annual leave",
  "ooo",
  "out of office",
  "out-of-office",
  "wfh ",
  "work from home",
  "conference",
  "rdo",
  "rec leave",
];
const HOLIDAY_KEYWORDS = ["birthday", "labour day", "anzac day"];
const FLIGHT_RE = /\b[A-Z]{2}\d{2,4}\b.*[→\->]/;

export function detectOoo(summary: string): { flag: boolean; kind: string } {
  const s = (summary || "").toLowerCase();
  if (FLIGHT_RE.test(summary || "")) return { flag: true, kind: "Flight" };
  for (const kw of OOO_STRONG) {
    if (s.includes(kw)) {
      if (s.includes("conference")) return { flag: true, kind: "Conference" };
      if (s.includes("travel")) return { flag: true, kind: "Travel" };
      if (s.includes("leave") || s.includes("rdo")) return { flag: true, kind: "Leave" };
      if (s.includes("wfh") || s.includes("work from home")) return { flag: true, kind: "WFH" };
      return { flag: true, kind: "OOO" };
    }
  }
  if (s.includes("hotel —") || s.includes("hotel -")) return { flag: true, kind: "Hotel" };
  for (const kw of HOLIDAY_KEYWORDS) {
    if (s.includes(kw) && !s.includes("session")) return { flag: true, kind: "Holiday" };
  }
  return { flag: false, kind: "" };
}

// Colour palette (no leading #) — keyed to the 4 super-groups in CalendarPlanner.tsx.
//   oliver  ≈ sky-100      (DAE8FC)
//   marieke ≈ purple-100   (E1D5E7)
//   couple  ≈ pink-100     (F8D7E0)
//   family  ≈ emerald-100  (D5E8D4)
//   ooo overlay (flight/leave/conference) keeps the legacy red tint
const COLOR = {
  oliver:  "DAE8FC",
  marieke: "E1D5E7",
  couple:  "F8D7E0",
  family:  "D5E8D4",
  ooo:     "F8CECC",
  notes:   "FFF2CC",
  header:  "4A5568",
  headerText: "FFFFFF",
  weekend: "F7F7F7",
};

// YYYY-MM-DD in Australia/Melbourne for any Date instant. The server runs in
// UTC, so we must explicitly project into AEST/AEDT for date-bucketing.
function dateKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Melbourne",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

// dateKey for a Date constructed from local-floating wall-clock components
// (e.g. parseDateOnly). These have no timezone meaning so we read the UTC
// fields directly to avoid double-shifting.
function dateKeyFloating(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function parseDateOnly(s: string): Date {
  // Construct as UTC midnight so getUTC* fields match the wall-clock date
  // regardless of the host timezone.
  return new Date(s + "T00:00:00Z");
}

function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  const d = parseDateOnly(from);
  const end = parseDateOnly(to);
  while (d <= end) {
    out.push(dateKeyFloating(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function eventsForDay(events: CalEvent[], day: string): CalEvent[] {
  return events
    .filter((e) => {
      // All-day events have local-floating midnights (no TZ semantics) so
      // their UTC fields hold the wall-clock date. Timed events are true UTC
      // instants and must be projected into Melbourne for bucketing.
      const s = new Date(e.start);
      const en = new Date(e.end);
      const startKey = e.allDay ? dateKeyFloating(s) : dateKey(s);
      const endKey = e.allDay
        ? dateKeyFloating(new Date(en.getTime() - 86400000))
        : dateKey(en);
      return startKey <= day && endKey >= day;
    })
    .sort((a, b) => +new Date(a.start) - +new Date(b.start));
}

// --- Column classifier (mirrors client/src/pages/CalendarPlanner.tsx) -----

type ColKey =
  | "oliver_all"
  | "m_art"
  | "couple"
  | "kids_with_us"
  | "kids_activities"
  | "kids_terms"
  | "ph";
type GroupKey = "oliver" | "marieke" | "couple" | "family";

interface ColDef {
  key: ColKey;
  label: string;
  group: GroupKey;
}

const COL_DEFS: ColDef[] = [
  { key: "oliver_all",      label: "Oliver-All",       group: "oliver" },
  { key: "m_art",           label: "Marieke Art",      group: "marieke" },
  { key: "couple",          label: "Marieke & Oliver", group: "couple" },
  { key: "kids_with_us",    label: "Kids with Us",     group: "family" },
  { key: "kids_activities", label: "Kids Activities",  group: "family" },
  { key: "kids_terms",      label: "Kids Term Dates",  group: "family" },
  { key: "ph",              label: "Public Holidays",  group: "family" },
];

const GROUP_COLOR: Record<GroupKey, string> = {
  oliver:  COLOR.oliver,
  marieke: COLOR.marieke,
  couple:  COLOR.couple,
  family:  COLOR.family,
};
const GROUP_LABEL: Record<GroupKey, string> = {
  oliver:  "Oliver",
  marieke: "Marieke",
  couple:  "Marieke & Oliver",
  family:  "Family",
};

function columnFor(summary: string): ColKey | null {
  const raw = (summary || "").trim();
  const s = raw.toLowerCase();

  // 1. Couple (matched first so "Marieke physio" doesn't fall through to Marieke)
  if (
    s.includes("couple time") ||
    s.includes("cup of tea") ||
    s.includes("marieke physio") ||
    s.includes("date night")
  ) {
    return "couple";
  }

  // 2. Marieke Art
  if (
    s.includes("marieke art") ||
    s.includes("marieke \u2014 art") ||
    s.includes("marieke - art") ||
    s.includes("marieke \u2014 art class") ||
    s.includes("art class")
  ) {
    return "m_art";
  }

  // 3. Family — kids buckets, terms, public holidays
  if (s.includes("kids with us")) return "kids_with_us";
  if (s.includes("kids head off") || s.includes("kids back") || s.includes("handover")) {
    return "kids_with_us";
  }

  if (
    s.includes("school term") ||
    s.includes("term ") ||
    s.includes(" term") ||
    s.includes("school holidays") ||
    s.includes("first day of school") ||
    s.includes("last day of school") ||
    (s.includes("school") && (s.includes("nmps") || s.includes("uhs")))
  ) {
    return "kids_terms";
  }

  if (
    s.includes("public holiday") ||
    s.includes("anzac") ||
    s.includes("labour day") ||
    s.includes("kings birthday") ||
    s.includes("king's birthday") ||
    s.includes("queens birthday") ||
    s.includes("queen's birthday") ||
    s.includes("christmas") ||
    s.includes("boxing day") ||
    s.includes("new year") ||
    s.includes("good friday") ||
    s.includes("easter") ||
    s.includes("melbourne cup") ||
    s.includes("afl grand final") ||
    s.includes("australia day")
  ) {
    return "ph";
  }

  if (
    raw.startsWith("Hilde:") ||
    raw.startsWith("Axel:") ||
    raw.startsWith("Hilde \u2014") ||
    raw.startsWith("Axel \u2014") ||
    raw.startsWith("Hilde -") ||
    raw.startsWith("Axel -") ||
    s.startsWith("hilde ") ||
    s.startsWith("axel ")
  ) {
    return "kids_activities";
  }

  // 4. Oliver-All — [Category] prefixes from build_calendars.py + legacy keywords
  if (
    raw.startsWith("[Elgin House]") ||
    raw.startsWith("[Sandringham]") ||
    raw.startsWith("[Peninsula Health]") ||
    raw.startsWith("[On-call]") ||
    raw.startsWith("[Travel]") ||
    raw.startsWith("[Medicolegal]") ||
    raw.startsWith("[Personal]")
  ) {
    return "oliver_all";
  }
  const oliverKeys = [
    "elgin", "braybrook", "carlton",
    "sandringham", "sandy ", "anc (", "gynae ot",
    "peninsula", "pen wk", "urogyn", "medical student teaching",
    "on-call", "on call", "alfred (24h)",
    "travel \u2014", "travel -", "conference", "flight",
    "hotel \u2014", "hotel -",
    "annual leave", "rec leave", "rdo",
    "medicolegal",
    "gp \u2014", "gp -", "dental", "dentist", "haircut", "gym",
    "podiatry", "optometr", "oliver \u2014 personal", "personal medical",
    "ot \u2013 main", "ot \u2014 main", "ot - main", "caesar",
    "gyn clinic", "anc ", "theatre", "ward round", "handover round",
    "audit", "mdt", "teaching (am)", "teaching (pm)", "clinic",
    "timesheet", "roster",
  ];
  if (oliverKeys.some((k) => s.includes(k))) return "oliver_all";

  return null;
}

function groupFor(summary: string): GroupKey | null {
  const col = columnFor(summary);
  if (!col) return null;
  return COL_DEFS.find((c) => c.key === col)!.group;
}

function summariseEventForCell(e: CalEvent): string {
  const sum = (e.summary || "").trim();
  const time = e.allDay ? "" : `${fmtTime(e.start)} `;
  const stripped = sum
    .replace(/^\[(Elgin House|Sandringham|Peninsula Health|On-call|Travel|Medicolegal|Personal)\]\s*/, "")
    .replace(/^Hilde:\s*/i, "")
    .replace(/^Axel:\s*/i, "")
    .replace(/^Hilde\s*[\u2013\u2014-]\s*/i, "")
    .replace(/^Axel\s*[\u2013\u2014-]\s*/i, "")
    .replace(/^Marieke\s*[\u2013\u2014-]\s*/i, "")
    .replace(/^On-call\s*[\u2013\u2014-]\s*/i, "")
    .replace(/^Travel\s*[\u2013\u2014-]\s*/i, "")
    .replace(/^Medicolegal\s*[\u2013\u2014-]\s*/i, "");
  return `${time}${stripped}`.trim();
}

function fmtTime(iso: string): string {
  // Render in Australia/Melbourne (server is UTC, so we cannot use getHours).
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Australia/Melbourne",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(iso));
  const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
  const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hh.padStart(2, "0")}:${mm}`;
}

function _fmtTimeOldImpl_unused(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function isoWeek(date: Date): { year: number; week: number } {
  // ISO 8601: week 1 is the week containing the first Thursday.
  // `date` is a parseDateOnly(...) result (UTC midnight) so its UTC fields
  // are the wall-clock date.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((+d - +yearStart) / 86400000 + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

function startOfIsoWeek(date: Date): Date {
  // Operate on UTC fields so we don't depend on the host timezone.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - dow);
  return d;
}

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export async function buildPlannerXlsx(
  from: string,
  to: string,
  events: CalEvent[],
  notes: PlannerNote[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Anchor Planner";
  wb.created = new Date();

  const days = eachDay(from, to);
  const noteByDate = new Map(notes.map((n) => [n.date, n.note]));

  // ----- Year Overview sheet -----
  const overview = wb.addWorksheet("Year Overview");
  overview.getRow(1).values = ["Date", "Day", "Event count", "OOO?"];
  overview.getRow(1).font = { bold: true, color: { argb: COLOR.headerText } };
  overview.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: COLOR.header },
  };
  overview.columns = [
    { width: 14 },
    { width: 10 },
    { width: 14 },
    { width: 8 },
  ];
  let rowIdx = 2;
  for (const day of days) {
    const dayEvents = eventsForDay(events, day);
    const ooo = dayEvents.some((e) => detectOoo(e.summary).flag);
    const dt = parseDateOnly(day);
    const row = overview.getRow(rowIdx++);
    row.values = [
      day,
      dt.toLocaleDateString("en-AU", { weekday: "short" }),
      dayEvents.length,
      ooo ? "Y" : "",
    ];
    const intensity = Math.min(1, dayEvents.length / 6);
    if (intensity > 0) {
      const grey = Math.round(255 - intensity * 90);
      const hex = grey.toString(16).padStart(2, "0").toUpperCase();
      row.getCell(3).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: hex + hex + "FF" },
      };
    }
    if (ooo) {
      row.getCell(4).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: COLOR.ooo },
      };
    }
  }

  // ----- Year Planner sheet (wide grouped table) -----
  // Mirrors the YearGroupedTable in CalendarPlanner.tsx: 4 super-groups, 7 leaf
  // columns, plus Date + Day + Notes columns at the start.
  const planner = wb.addWorksheet("Year Planner");
  planner.views = [{ state: "frozen", xSplit: 2, ySplit: 2 }];
  planner.columns = [
    { width: 16 }, // Date
    { width: 10 }, // Day
    ...COL_DEFS.map(() => ({ width: 28 })),
    { width: 36 }, // Notes
  ];

  // Super-header (groups). We span across leaf columns 3..(3+COL_DEFS.length-1).
  const superRow = planner.getRow(1);
  superRow.getCell(1).value = `${from} \u2192 ${to}`;
  superRow.getCell(1).alignment = { horizontal: "left", vertical: "middle" };
  superRow.getCell(1).font = { bold: true, color: { argb: COLOR.headerText } };
  superRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.header } };
  planner.mergeCells(1, 1, 1, 2);

  // Group spans
  let cursorCol = 3; // first leaf column index (1-based), after Date+Day
  const groupRanges: Array<{ group: GroupKey; from: number; to: number }> = [];
  let lastGroup: GroupKey | null = null;
  for (const def of COL_DEFS) {
    if (def.group !== lastGroup) {
      groupRanges.push({ group: def.group, from: cursorCol, to: cursorCol });
      lastGroup = def.group;
    } else {
      groupRanges[groupRanges.length - 1].to = cursorCol;
    }
    cursorCol++;
  }
  for (const gr of groupRanges) {
    planner.mergeCells(1, gr.from, 1, gr.to);
    const cell = planner.getCell(1, gr.from);
    cell.value = GROUP_LABEL[gr.group];
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GROUP_COLOR[gr.group] } };
  }
  // Notes super-header cell
  const notesSuperCol = 2 + COL_DEFS.length + 1;
  const notesSuperCell = planner.getCell(1, notesSuperCol);
  notesSuperCell.value = "Notes";
  notesSuperCell.alignment = { horizontal: "center", vertical: "middle" };
  notesSuperCell.font = { bold: true, color: { argb: COLOR.headerText } };
  notesSuperCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.header } };

  // Sub-header row
  const subRow = planner.getRow(2);
  subRow.values = [
    "Date",
    "Day",
    ...COL_DEFS.map((c) => c.label),
    "Note",
  ];
  subRow.eachCell((cell, colNumber) => {
    cell.font = { bold: true };
    if (colNumber <= 2 || colNumber === notesSuperCol) {
      cell.font = { bold: true, color: { argb: COLOR.headerText } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.header } };
    } else {
      const def = COL_DEFS[colNumber - 3];
      if (def) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GROUP_COLOR[def.group] } };
      }
    }
    cell.alignment = { horizontal: "center" };
  });

  // Build per-day cell content keyed on column
  for (const day of days) {
    const dt = parseDateOnly(day);
    const dayEvents = eventsForDay(events, day);
    const cellLines: Record<ColKey, string[]> = Object.fromEntries(
      COL_DEFS.map((c) => [c.key, [] as string[]]),
    ) as Record<ColKey, string[]>;
    for (const e of dayEvents) {
      const col = columnFor(e.summary);
      if (!col) continue;
      const lines = cellLines[col];
      if (lines.length < 5) {
        lines.push(summariseEventForCell(e));
      } else if (lines.length === 5) {
        lines.push(`+${dayEvents.filter((x) => columnFor(x.summary) === col).length - 5} more`);
      }
    }
    const row = planner.addRow([
      dt.toLocaleDateString("en-AU", { weekday: "short", day: "2-digit", month: "short", year: "numeric" }),
      dt.toLocaleDateString("en-AU", { weekday: "long" }),
      ...COL_DEFS.map((c) => cellLines[c.key].join("\n")),
      noteByDate.get(day) ?? "",
    ]);
    const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
    row.eachCell((cell, colNumber) => {
      cell.alignment = { vertical: "top", wrapText: true };
      cell.font = { size: 9 };
      if (colNumber <= 2) {
        if (isWeekend) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.weekend } };
        }
      } else if (colNumber === notesSuperCol) {
        if ((noteByDate.get(day) ?? "").trim()) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.notes } };
        }
      } else {
        const def = COL_DEFS[colNumber - 3];
        if (def) {
          const lines = cellLines[def.key];
          if (lines.length > 0) {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GROUP_COLOR[def.group] } };
          }
        }
      }
      cell.border = {
        top: { style: "thin", color: { argb: "DDDDDD" } },
        bottom: { style: "thin", color: { argb: "DDDDDD" } },
        left: { style: "thin", color: { argb: "DDDDDD" } },
        right: { style: "thin", color: { argb: "DDDDDD" } },
      };
    });
    // Auto-size row height by line count
    const maxLines = Math.max(
      1,
      ...COL_DEFS.map((c) => cellLines[c.key].length),
      Math.ceil(((noteByDate.get(day) ?? "").length || 0) / 40),
    );
    row.height = Math.min(150, Math.max(18, 14 + maxLines * 12));
  }

  // ----- Monthly sheets -----
  const monthsInRange = new Set<string>();
  for (const day of days) {
    const dt = parseDateOnly(day);
    monthsInRange.add(`${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  for (const ym of Array.from(monthsInRange).sort()) {
    const [yStr, mStr] = ym.split("-");
    const year = Number(yStr);
    const month = Number(mStr) - 1;
    const sheetName = `${MONTH_NAMES[month]} ${year}`;
    const ws = wb.addWorksheet(sheetName);
    ws.columns = [
      { width: 18 },
      { width: 18 },
      { width: 18 },
      { width: 18 },
      { width: 18 },
      { width: 18 },
      { width: 18 },
    ];
    const headerRow = ws.addRow(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    headerRow.font = { bold: true, color: { argb: COLOR.headerText } };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLOR.header },
    };
    headerRow.alignment = { horizontal: "center" };

    const firstOfMonth = new Date(Date.UTC(year, month, 1));
    const monStart = startOfIsoWeek(firstOfMonth);
    const lastOfMonth = new Date(Date.UTC(year, month + 1, 0));
    let cursor = new Date(monStart);
    while (cursor <= lastOfMonth) {
      const cells: string[] = [];
      const dayKeys: string[] = [];
      for (let i = 0; i < 7; i++) {
        const k = dateKeyFloating(cursor);
        dayKeys.push(k);
        const inMonth = cursor.getUTCMonth() === month;
        const dayEvents = eventsForDay(events, k);
        const lines: string[] = [];
        lines.push(inMonth ? `${cursor.getUTCDate()}` : ` (${cursor.getUTCDate()})`);
        for (const e of dayEvents.slice(0, 5)) {
          lines.push(summariseEventForCell(e));
        }
        if (dayEvents.length > 5) lines.push(`+${dayEvents.length - 5} more`);
        const note = noteByDate.get(k);
        if (note && note.trim()) lines.push(`📝 ${note.trim().slice(0, 100)}`);
        cells.push(lines.join("\n"));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      const row = ws.addRow(cells);
      row.height = 90;
      row.eachCell((cell, col) => {
        const k = dayKeys[col - 1];
        const dt = parseDateOnly(k);
        const inMonth = dt.getUTCMonth() === month;
        cell.alignment = { vertical: "top", wrapText: true };
        cell.font = { size: 9, color: { argb: inMonth ? "000000" : "999999" } };
        const dayEvents = eventsForDay(events, k);
        if (dayEvents.length > 0) {
          // Pick a colour from the most "important" group present.
          // Resolution order: oliver > couple > marieke > family.
          const groups = dayEvents.map((e) => groupFor(e.summary)).filter(Boolean) as GroupKey[];
          let color: string | null = null;
          if (groups.includes("oliver")) color = COLOR.oliver;
          else if (groups.includes("couple")) color = COLOR.couple;
          else if (groups.includes("marieke")) color = COLOR.marieke;
          else if (groups.includes("family")) color = COLOR.family;
          // Override with OOO red if anything is flagged out-of-office
          if (dayEvents.some((e) => detectOoo(e.summary).flag)) color = COLOR.ooo;
          if (color) {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
          }
        }
        cell.border = {
          top: { style: "thin", color: { argb: "CCCCCC" } },
          bottom: { style: "thin", color: { argb: "CCCCCC" } },
          left: { style: "thin", color: { argb: "CCCCCC" } },
          right: { style: "thin", color: { argb: "CCCCCC" } },
        };
      });
    }
  }

  // ----- Weekly sheets (one per ISO week in range) -----
  const weeksSeen = new Set<string>();
  for (const day of days) {
    const dt = parseDateOnly(day);
    const { year, week } = isoWeek(dt);
    const key = `${year}-${String(week).padStart(2, "0")}`;
    if (weeksSeen.has(key)) continue;
    weeksSeen.add(key);
    const sheetName = `Wk-${year}-${String(week).padStart(2, "0")}`;
    const ws = wb.addWorksheet(sheetName);
    ws.columns = [
      { width: 14 },
      { width: 10 },
      { width: 18 },
      { width: 12 },
      { width: 50 },
      { width: 30 },
    ];
    const header = ws.addRow(["Date", "Day", "Group", "Time", "Event", "Location"]);
    header.font = { bold: true, color: { argb: COLOR.headerText } };
    header.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLOR.header },
    };
    const monStart = startOfIsoWeek(dt);
    for (let i = 0; i < 7; i++) {
      const cur = new Date(monStart);
      cur.setUTCDate(cur.getUTCDate() + i);
      const k = dateKeyFloating(cur);
      const weekday = new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", weekday: "short" }).format(cur);
      const dayEvents = eventsForDay(events, k);
      if (dayEvents.length === 0) {
        const row = ws.addRow([
          k,
          weekday,
          "",
          "",
          "—",
          "",
        ]);
        row.font = { color: { argb: "999999" } };
      } else {
        for (const e of dayEvents) {
          const grp = groupFor(e.summary);
          const ooo = detectOoo(e.summary).flag;
          const color = ooo
            ? COLOR.ooo
            : grp
              ? GROUP_COLOR[grp]
              : null;
          const row = ws.addRow([
            k,
            weekday,
            grp ? GROUP_LABEL[grp] : "",
            e.allDay ? "all-day" : `${fmtTime(e.start)}–${fmtTime(e.end)}`,
            e.summary,
            e.location ?? "",
          ]);
          if (color) {
            row.eachCell((cell) => {
              cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
            });
          }
        }
      }
    }
  }

  // ----- OOO + Travel sheet -----
  const oooSheet = wb.addWorksheet("OOO + Travel");
  oooSheet.columns = [
    { width: 14 },
    { width: 14 },
    { width: 12 },
    { width: 50 },
    { width: 30 },
  ];
  const oooHeader = oooSheet.addRow(["Date", "End", "Kind", "Summary", "Location"]);
  oooHeader.font = { bold: true, color: { argb: COLOR.headerText } };
  oooHeader.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: COLOR.header },
  };
  for (const e of events) {
    const det = detectOoo(e.summary);
    if (!det.flag) continue;
    const s = new Date(e.start);
    const en = new Date(e.end);
    const startKey = e.allDay ? dateKeyFloating(s) : dateKey(s);
    const endKey = e.allDay
      ? dateKeyFloating(new Date(en.getTime() - 86400000))
      : dateKey(en);
    if (startKey > to || endKey < from) continue;
    const row = oooSheet.addRow([startKey, endKey, det.kind, e.summary, e.location ?? ""]);
    row.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.ooo } };
    });
  }

  // ----- Notes sheet -----
  const notesSheet = wb.addWorksheet("Notes");
  notesSheet.columns = [{ width: 14 }, { width: 80 }];
  const nh = notesSheet.addRow(["Date", "Note"]);
  nh.font = { bold: true, color: { argb: COLOR.headerText } };
  nh.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: COLOR.header },
  };
  const sortedNotes = [...notes].sort((a, b) => a.date.localeCompare(b.date));
  for (const n of sortedNotes) {
    if (!n.note.trim()) continue;
    const row = notesSheet.addRow([n.date, n.note]);
    row.getCell(2).alignment = { wrapText: true, vertical: "top" };
    row.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.notes } };
    });
  }

  // ----- Legend sheet -----
  const legend = wb.addWorksheet("Legend");
  legend.columns = [{ width: 22 }, { width: 28 }, { width: 50 }];
  const lh = legend.addRow(["Super-group", "Leaf columns", "Colour"]);
  lh.font = { bold: true, color: { argb: COLOR.headerText } };
  lh.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.header } };

  for (const grp of ["oliver", "marieke", "couple", "family"] as GroupKey[]) {
    const leaves = COL_DEFS.filter((c) => c.group === grp).map((c) => c.label).join(", ");
    const row = legend.addRow([GROUP_LABEL[grp], leaves, ""]);
    row.getCell(3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: GROUP_COLOR[grp] } };
  }
  const oooRow = legend.addRow(["OOO / Travel overlay", "(Flight / Conference / Leave / Hotel)", ""]);
  oooRow.getCell(3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.ooo } };
  const notesLegend = legend.addRow(["Notes column", "Free-text per-day notes", ""]);
  notesLegend.getCell(3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.notes } };

  legend.addRow([]);
  legend.addRow(["Range", `${from} → ${to}`]);
  legend.addRow(["Generated", new Date().toLocaleString("en-AU", { timeZone: "Australia/Melbourne" })]);
  legend.addRow([
    "Layout",
    "Year Planner sheet mirrors CalendarPlanner.tsx — 4 super-groups × 7 leaf columns.",
  ]);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
