// Shape of the JSON emitted by scripts/build-master-template.cjs from
// client/public/MasterTemplateCalendar.xlsx. Regenerated on every build.
// Keep this in sync with the parser script.

export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export interface RotationDay {
  /** Roster entry for the given day (e.g. "Elgin House", "PH: ANC (AM) / OT - MAIN (PM)"). */
  roster: string;
  /** Kids row for the given day (e.g. "Kids with us", "Kids handover 0900"). */
  kids: string;
}

export interface RotationWeek {
  /** 1-based week index within the rotation cycle (matches the "Week N" label in the sheet). */
  index: number;
  /** First Monday of the example block in the sheet (ISO yyyy-mm-dd). */
  weekStartIso: string | null;
  shWeek: number | null;
  ehWeek: number | null;
  phWeek: number | null;
  kidsWeek: number | null;
  days: Record<DayKey, RotationDay>;
}

export interface WorkLink {
  /** Section heading from the sheet (e.g. "Peninsula Health", "Sandy", "Other"). */
  section: string;
  /** Display text from the cell (may contain a colon-separated label and target name). */
  label: string;
  /** External URL — null only for plain-text rows that fell into the workLinks bucket. */
  url: string | null;
}

export interface MasterTemplate {
  sourceFilename: string;
  sheetName: string;
  title: string;
  keyDescription: string;
  /** Monday that the rotation cycle is anchored to (Week 1 begins on this date). */
  anchorDateIso: string | null;
  lastRevisionIso: string | null;
  fileMtimeIso: string;
  fileSizeBytes: number;
  fileSha256: string;
  weeks: RotationWeek[];
  workLinks: WorkLink[];
  notes: string[];
  generatedAtIso: string;
}

/**
 * Compute the cycle position (0-based, 0..N-1 where N = weeks.length) for any
 * date, given the anchor Monday for week index 1. Days before the anchor wrap
 * backwards through the cycle (modulo arithmetic). Returns null if the anchor
 * is missing.
 */
export function cyclePositionFor(
  date: Date,
  anchorDateIso: string | null,
  cycleLength: number,
): number | null {
  if (!anchorDateIso || cycleLength <= 0) return null;
  const anchor = new Date(anchorDateIso + "T00:00:00");
  // Snap both dates to the Monday of their ISO week so the cycle position is
  // stable across all 7 days of a given week.
  const dMon = mondayOf(date);
  const aMon = mondayOf(anchor);
  const diffDays = Math.round(
    (dMon.getTime() - aMon.getTime()) / (24 * 60 * 60 * 1000),
  );
  const weeksOffset = Math.floor(diffDays / 7);
  const pos = ((weeksOffset % cycleLength) + cycleLength) % cycleLength;
  return pos;
}

function mondayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  // getDay: 0=Sun..6=Sat. Convert so Monday = 0.
  const dow = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dow);
  return x;
}
