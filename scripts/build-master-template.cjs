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
// xlsx column letters for Mon-Sun roster columns (header row 6, F..L).
const DAY_COL_LETTERS = ["F", "G", "H", "I", "J", "K", "L"];

// Auto-detect the rotation start row by locating the row whose A/B cells hold the
// anchor date (A is a `=B4+N*7` formula) and B is the Week-N label. Falls back to
// the historical row positions if detection fails. The table is 4 cycles × 2 rows.
function detectWeekRows(ws) {
  const candidates = [];
  for (let r = 1; r <= Math.min(ws.rowCount, 40); r++) {
    const bText = cellText(ws.getCell(`B${r}`));
    const aDate = asDate(ws.getCell(`A${r}`).value);
    if (/^Week\s+\d+/i.test(bText) && aDate instanceof Date) {
      candidates.push(r);
      if (candidates.length === 4) break;
    }
  }
  if (candidates.length === 4) return candidates;
  // Fallback: old layout (header row 5 → data starts row 6) or current (header row 6 → row 7).
  return [7, 9, 11, 13];
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
  const weekRows = detectWeekRows(ws);
  for (const rosterRow of weekRows) {
    const kidsRow = rosterRow + 1;
    const weekStartIso = toIsoDateOnly(asDate(ws.getCell(`A${rosterRow}`).value));

    const shWeek = parseWeekLabel(cellText(ws.getCell(`B${rosterRow}`)));
    const ehWeek = parseWeekLabel(cellText(ws.getCell(`C${rosterRow}`)));
    const phWeek = parseWeekLabel(cellText(ws.getCell(`D${rosterRow}`)));
    const kidsWeek = parseWeekLabel(cellText(ws.getCell(`E${rosterRow}`)));

    const days = {};
    for (let i = 0; i < DAY_KEYS.length; i++) {
      const col = DAY_COL_LETTERS[i];
      const roster = cellText(ws.getCell(`${col}${rosterRow}`));
      const kids = cellText(ws.getCell(`${col}${kidsRow}`));
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
  // Start scanning two rows below the last rotation row (kidsRow + 1 + 1 blank).
  const linksStartRow = weekRows[weekRows.length - 1] + 2;
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
