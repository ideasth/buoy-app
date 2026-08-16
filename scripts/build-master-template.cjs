#!/usr/bin/env node
/*
 * build-master-template.cjs
 *
 * Parses client/public/MasterTemplateCalendar.xlsx into a typed JSON module
 * consumed by the Templates page and the yearly-planner Week column.
 *
 * Runs as a `prebuild` step. Emits client/src/generated/master-template.json
 * (gitignored — regenerated on every `npm run build`).
 *
 * Schema (see client/src/types/master-template.ts):
 *   {
 *     sourceFilename: "MasterTemplateCalendar.xlsx",
 *     sheetName: "Current-EH-PH-SH-Kids-26062026",
 *     title: "Master Rotation Template - ...",
 *     keyDescription: "EH = Elgin House, ...",
 *     anchorDateIso: "2026-06-29",       // Mon = SH wk 1 / EH wk 1 / PH wk 4 / Kids wk 1
 *     lastRevisionIso: "2026-06-26",
 *     fileMtimeIso: "2026-06-25T23:24:00Z",
 *     fileSizeBytes: 13456,
 *     fileSha256: "...",
 *     weeks: [
 *       {
 *         index: 1,                       // 1-based, matches "Week 1" label
 *         weekStartIso: "2026-06-29",
 *         shWeek: 1, ehWeek: 1, phWeek: 4, kidsWeek: 1,
 *         days: { mon: { roster: "Elgin House", kids: "Kids with us" }, ... }
 *       },
 *       ...
 *     ],
 *     workLinks: [
 *       { section: "Peninsula Health", label: "Remote access: Peninsula Health remote access", url: "https://..." },
 *       ...
 *     ],
 *     notes: ["Timesheet: Mark 1 in General Oncall column if birth suite oncall"],
 *   }
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const ExcelJS = require("exceljs");

const REPO_ROOT = path.resolve(__dirname, "..");
const SRC_XLSX = path.join(REPO_ROOT, "client/public/MasterTemplateCalendar.xlsx");
const OUT_DIR = path.join(REPO_ROOT, "client/src/generated");
const OUT_JSON = path.join(OUT_DIR, "master-template.json");

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const COL_LETTERS = ["A","B","C","D","E","F","G","H","I","J","K","L","M","N"];

// Detect the header row + column layout. Historically the sheet had a 12-column
// layout with a "Kids week" column (E) between PH-week (D) and the day columns
// (F..L). The 2026-08-17 revision drops the Kids column entirely, so the day
// columns move left by one (E..K) and the per-week roster row is no longer
// followed by a Kids row.
//
// Returns { headerRow, hasKidsColumn, dayColLetters, weekRows, kidsWeekCol }.
// weekRows are the rows carrying roster data (Week-N label in B). kidsRowFor(rr)
// returns rr+1 when hasKidsColumn is true, else null (no separate kids row).
function detectLayout(ws) {
  let headerRow = null;
  const maxScan = Math.min(ws.rowCount, 40);
  for (let r = 1; r <= maxScan; r++) {
    const aText = cellText(ws.getCell(`A${r}`)).toLowerCase();
    if (aText.startsWith("week-date alignment")) {
      headerRow = r;
      break;
    }
  }

  // Fallback: use the row above the first roster row.
  const rosterCandidates = [];
  for (let r = 1; r <= maxScan; r++) {
    const bText = cellText(ws.getCell(`B${r}`));
    const aDate = asDate(ws.getCell(`A${r}`).value);
    if (/^Week\s+\d+/i.test(bText) && aDate instanceof Date) {
      rosterCandidates.push(r);
      if (rosterCandidates.length === 4) break;
    }
  }
  if (!headerRow && rosterCandidates.length > 0) headerRow = rosterCandidates[0] - 1;
  if (!headerRow) headerRow = 6; // last-resort default matching historical layout.

  // Kids-column detection: header text at E{headerRow}.
  const eHeader = cellText(ws.getCell(`E${headerRow}`)).toLowerCase();
  const hasKidsColumn = eHeader.startsWith("kids");

  const dayStartColIdx = hasKidsColumn ? 5 /* F */ : 4 /* E */;
  const dayColLetters = COL_LETTERS.slice(dayStartColIdx, dayStartColIdx + 7);
  const kidsWeekCol = hasKidsColumn ? "E" : null;

  // Roster rows are the 4 rows with Week-N label. When the Kids column exists,
  // each roster row is followed by a Kids row (rr+1). Otherwise there's no
  // per-week Kids row.
  const weekRows = rosterCandidates.length === 4 ? rosterCandidates : [7, 9, 11, 13];

  return { headerRow, hasKidsColumn, dayColLetters, kidsWeekCol, weekRows };
}

function toIsoDateOnly(d) {
  if (!d) return null;
  // ExcelJS may return a formula cell as { formula, result } where result
  // is a Date. Normalise to a plain Date.
  if (typeof d === "object" && !(d instanceof Date) && d.result instanceof Date) {
    d = d.result;
  }
  if (d instanceof Date) {
    // Treat as wall-clock — the xlsx stores naive dates with no timezone.
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  return null;
}

function asDate(v) {
  if (v instanceof Date) return v;
  if (v && typeof v === "object" && v.result instanceof Date) return v.result;
  return null;
}

function cellText(cell) {
  if (cell == null || cell.value == null) return "";
  const v = cell.value;
  // ExcelJS represents rich text and hyperlink cells as objects.
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (v instanceof Date) return toIsoDateOnly(v) || "";
  if (typeof v === "object") {
    if (typeof v.text === "string") return v.text.trim();
    if (Array.isArray(v.richText)) {
      return v.richText.map((r) => r.text || "").join("").trim();
    }
    if (typeof v.result !== "undefined") return cellText({ value: v.result });
    if (typeof v.hyperlink === "string" && typeof v.text === "string") {
      return v.text.trim();
    }
  }
  return String(v).trim();
}

function cellHyperlink(cell) {
  if (cell == null || cell.value == null) return null;
  const v = cell.value;
  if (typeof v === "object" && typeof v.hyperlink === "string") return v.hyperlink;
  return null;
}

function parseWeekLabel(s) {
  if (!s) return null;
  const m = /Week\s+(\d+)/i.exec(String(s));
  return m ? Number(m[1]) : null;
}

async function main() {
  if (!fs.existsSync(SRC_XLSX)) {
    console.error(`[build-master-template] source xlsx not found: ${SRC_XLSX}`);
    process.exit(1);
  }

  const stat = fs.statSync(SRC_XLSX);
  const buf = fs.readFileSync(SRC_XLSX);
  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) {
    console.error("[build-master-template] no worksheets in xlsx");
    process.exit(1);
  }

  const title = cellText(ws.getCell("A1"));
  const lastRevisionIso = toIsoDateOnly(asDate(ws.getCell("B2").value));
  const keyDescription = cellText(ws.getCell("B3"));
  const anchorDateIso = toIsoDateOnly(asDate(ws.getCell("B4").value));

  // Rotation table — 4 weeks, each occupies 2 rows (roster row + kids row).
  // Row positions are detected dynamically so xlsx edits that shift the header
  // (e.g. inserting metadata rows) don't break parsing.
  const weeks = [];
  const layout = detectLayout(ws);
  const { hasKidsColumn, dayColLetters, kidsWeekCol, weekRows } = layout;
  for (const rosterRow of weekRows) {
    const kidsRow = hasKidsColumn ? rosterRow + 1 : null;
    const weekStartIso = toIsoDateOnly(asDate(ws.getCell(`A${rosterRow}`).value));

    const shWeek = parseWeekLabel(cellText(ws.getCell(`B${rosterRow}`)));
    const ehWeek = parseWeekLabel(cellText(ws.getCell(`C${rosterRow}`)));
    const phWeek = parseWeekLabel(cellText(ws.getCell(`D${rosterRow}`)));
    const kidsWeek = kidsWeekCol
      ? parseWeekLabel(cellText(ws.getCell(`${kidsWeekCol}${rosterRow}`)))
      : null;

    const days = {};
    for (let i = 0; i < DAY_KEYS.length; i++) {
      const col = dayColLetters[i];
      const roster = cellText(ws.getCell(`${col}${rosterRow}`));
      const kids = kidsRow ? cellText(ws.getCell(`${col}${kidsRow}`)) : "";
      days[DAY_KEYS[i]] = { roster, kids };
    }

    weeks.push({
      index: weeks.length + 1,
      weekStartIso,
      shWeek,
      ehWeek,
      phWeek,
      kidsWeek,
      days,
    });
  }

  // Work Links + Notes — scan rows 15 onward; section headers are plain
  // labels (no link, no leading "tab"), entries have a hyperlink, the
  // "Notes:" section is a free-text label followed by note rows.
  const workLinks = [];
  const notes = [];
  let currentSection = "";
  let inNotes = false;
  // Start scanning below the rotation block. When the Kids row is present the
  // rotation block spans 2 rows per week (roster + kids), so leave a blank row
  // after the final kids row. Without the Kids column, the roster row is the
  // last table row so leave one blank row after it.
  const linksStartRow = weekRows[weekRows.length - 1] + (hasKidsColumn ? 3 : 2);
  for (let r = linksStartRow; r <= ws.rowCount; r++) {
    const cell = ws.getCell(`A${r}`);
    const text = cellText(cell);
    const url = cellHyperlink(cell);
    if (!text && !url) continue;

    const isSectionHeader =
      !url &&
      (text === "Work Links" ||
        text === "Peninsula Health" ||
        text === "Sandy:" ||
        text === "Alfred:" ||
        text === "Monash:" ||
        text === "Notes:" ||
        /^Previous:?$/i.test(text));

    if (text === "Notes:") {
      inNotes = true;
      currentSection = "Notes";
      continue;
    }

    if (text === "Work Links") {
      // Skip the table title row.
      continue;
    }

    if (isSectionHeader) {
      inNotes = false;
      currentSection = text.replace(/:$/, "");
      continue;
    }

    if (inNotes) {
      // Note rows in this xlsx live under A22+; they're free text, no URL.
      if (text) notes.push(text.replace(/\u00a0/g, " "));
      continue;
    }

    if (url) {
      workLinks.push({
        section: currentSection || "Other",
        label: text.replace(/\u00a0/g, " "),
        url,
      });
    } else if (text) {
      // Plain text under a section that's not Notes — treat as a sub-header
      // / standalone entry (no link). Currently nothing in the sheet hits
      // this branch, but it's defensive for future edits.
      workLinks.push({
        section: currentSection || "Other",
        label: text.replace(/\u00a0/g, " "),
        url: null,
      });
    }
  }

  const out = {
    sourceFilename: path.basename(SRC_XLSX),
    sheetName: ws.name,
    title,
    keyDescription,
    anchorDateIso,
    lastRevisionIso,
    fileMtimeIso: stat.mtime.toISOString(),
    fileSizeBytes: stat.size,
    fileSha256: sha256,
    weeks,
    workLinks,
    notes,
    generatedAtIso: new Date().toISOString(),
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2) + "\n", "utf8");

  console.log(
    `[build-master-template] wrote ${path.relative(REPO_ROOT, OUT_JSON)} ` +
      `(weeks=${out.weeks.length}, links=${out.workLinks.length}, ` +
      `notes=${out.notes.length}, sha256=${sha256.slice(0, 12)}…)`,
  );
}

main().catch((err) => {
  console.error("[build-master-template] failed:", err);
  process.exit(1);
});
