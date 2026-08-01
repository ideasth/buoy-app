// Buoy adhoc events — user-added events layered into the Oliver-Work,
// Oliver-Personal and Family calendar bundles via build_calendars.py.
//
// Design (2026-08-01 spec):
//   * Three categories: 'oliver_work' | 'oliver_personal' | 'family'
//   * Full CRUD from the CalendarPlanner header
//   * Soft-delete (deleted_at nullable) so we keep audit trail
//   * Merged into the existing subscribed ICS bundles by build_calendars.py
//     fetching /api/adhoc-events/<category>.ics, so no new client subscriptions.
//
// This file follows the same lightweight pattern as server/family-storage.ts:
// CREATE TABLE IF NOT EXISTS on first getBuoyEventsDb() call, no separate
// migration runner. Reuses the same data.db so it lives alongside other Buoy
// tables and is included in the existing backup path.

import Database from "better-sqlite3";

function resolveDbPath(): string {
  return process.env.STAGE17_TEST_DB ?? "data.db";
}

let _db: Database.Database | null = null;

export function getBuoyEventsDb(): Database.Database {
  if (_db) return _db;
  _db = new Database(resolveDbPath());
  bootstrapTables(_db);
  return _db;
}

export function _setBuoyEventsTestDb(db: Database.Database): void {
  bootstrapTables(db);
  _db = db;
}

export function _resetBuoyEventsDbForTest(): void {
  _db = null;
}

function bootstrapTables(db: Database.Database): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS buoy_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL CHECK (category IN ('oliver_work','oliver_personal','family')),
  title TEXT NOT NULL,
  start_utc TEXT NOT NULL,
  end_utc TEXT NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0,
  location TEXT,
  notes TEXT,
  added_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_buoy_events_category ON buoy_events(category, deleted_at);
CREATE INDEX IF NOT EXISTS idx_buoy_events_window ON buoy_events(start_utc, end_utc);

-- Dirty flag for the calendar sync cron. When any CRUD write happens we set
-- dirty_since to the write time. build_calendars.py reads this on each cheap
-- tick to decide whether to do a full rebuild. On successful rebuild the cron
-- clears the row (dirty_since = NULL).
CREATE TABLE IF NOT EXISTS buoy_calendar_dirty (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  dirty_since TEXT
);
INSERT OR IGNORE INTO buoy_calendar_dirty (id, dirty_since) VALUES (1, NULL);
`);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BuoyEventCategory = "oliver_work" | "oliver_personal" | "family";

export const BUOY_EVENT_CATEGORIES: BuoyEventCategory[] = [
  "oliver_work",
  "oliver_personal",
  "family",
];

export function isBuoyEventCategory(x: unknown): x is BuoyEventCategory {
  return (
    typeof x === "string" &&
    (BUOY_EVENT_CATEGORIES as string[]).includes(x)
  );
}

export interface BuoyEvent {
  id: number;
  category: BuoyEventCategory;
  title: string;
  start_utc: string;
  end_utc: string;
  all_day: number;
  location: string | null;
  notes: string | null;
  added_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

function markDirty(db: Database.Database): void {
  db.prepare(
    `UPDATE buoy_calendar_dirty SET dirty_since = datetime('now') WHERE id = 1`,
  ).run();
}

export function getCalendarDirtySince(): string | null {
  const db = getBuoyEventsDb();
  const row = db
    .prepare(`SELECT dirty_since FROM buoy_calendar_dirty WHERE id = 1`)
    .get() as { dirty_since: string | null } | undefined;
  return row?.dirty_since ?? null;
}

export function clearCalendarDirty(): void {
  const db = getBuoyEventsDb();
  db.prepare(
    `UPDATE buoy_calendar_dirty SET dirty_since = NULL WHERE id = 1`,
  ).run();
}

export interface ListBuoyEventsArgs {
  fromUtc?: string;
  toUtc?: string;
  category?: BuoyEventCategory;
  includeDeleted?: boolean;
}

export function listBuoyEvents(args: ListBuoyEventsArgs = {}): BuoyEvent[] {
  const db = getBuoyEventsDb();
  const clauses: string[] = [];
  const params: any[] = [];
  if (!args.includeDeleted) clauses.push("deleted_at IS NULL");
  if (args.category) {
    clauses.push("category = ?");
    params.push(args.category);
  }
  if (args.fromUtc && args.toUtc) {
    // Overlap: event ends after `from` AND starts before `to`
    clauses.push("end_utc > ? AND start_utc < ?");
    params.push(args.fromUtc, args.toUtc);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db
    .prepare(
      `SELECT * FROM buoy_events ${where} ORDER BY start_utc, id`,
    )
    .all(...params) as BuoyEvent[];
}

export function getBuoyEvent(id: number): BuoyEvent | null {
  const db = getBuoyEventsDb();
  return (
    (db.prepare(`SELECT * FROM buoy_events WHERE id = ?`).get(id) as BuoyEvent | undefined) ??
    null
  );
}

export interface CreateBuoyEventArgs {
  category: BuoyEventCategory;
  title: string;
  start_utc: string;
  end_utc: string;
  all_day?: number;
  location?: string | null;
  notes?: string | null;
  added_by?: string | null;
}

export function createBuoyEvent(args: CreateBuoyEventArgs): BuoyEvent {
  validate(args);
  const db = getBuoyEventsDb();
  const result = db
    .prepare(
      `INSERT INTO buoy_events
         (category, title, start_utc, end_utc, all_day, location, notes, added_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      args.category,
      args.title.trim(),
      args.start_utc,
      args.end_utc,
      args.all_day ?? 0,
      args.location ?? null,
      args.notes ?? null,
      args.added_by ?? null,
    );
  markDirty(db);
  return getBuoyEvent(result.lastInsertRowid as number)!;
}

export interface PatchBuoyEventArgs {
  category?: BuoyEventCategory;
  title?: string;
  start_utc?: string;
  end_utc?: string;
  all_day?: number;
  location?: string | null;
  notes?: string | null;
}

export function patchBuoyEvent(id: number, patch: PatchBuoyEventArgs): BuoyEvent | null {
  const existing = getBuoyEvent(id);
  if (!existing || existing.deleted_at) return null;
  const merged: CreateBuoyEventArgs = {
    category: patch.category ?? existing.category,
    title: patch.title ?? existing.title,
    start_utc: patch.start_utc ?? existing.start_utc,
    end_utc: patch.end_utc ?? existing.end_utc,
    all_day: patch.all_day ?? existing.all_day,
    location: "location" in patch ? patch.location : existing.location,
    notes: "notes" in patch ? patch.notes : existing.notes,
  };
  validate(merged);
  const db = getBuoyEventsDb();
  db.prepare(
    `UPDATE buoy_events
       SET category=?, title=?, start_utc=?, end_utc=?, all_day=?, location=?, notes=?,
           updated_at=datetime('now')
     WHERE id=?`,
  ).run(
    merged.category,
    merged.title.trim(),
    merged.start_utc,
    merged.end_utc,
    merged.all_day ?? 0,
    merged.location ?? null,
    merged.notes ?? null,
    id,
  );
  markDirty(db);
  return getBuoyEvent(id);
}

/** Soft-delete: sets deleted_at but keeps the row for audit + restore. */
export function deleteBuoyEvent(id: number): boolean {
  const existing = getBuoyEvent(id);
  if (!existing || existing.deleted_at) return false;
  const db = getBuoyEventsDb();
  const result = db
    .prepare(
      `UPDATE buoy_events SET deleted_at=datetime('now'), updated_at=datetime('now') WHERE id=?`,
    )
    .run(id);
  if (result.changes > 0) markDirty(db);
  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validate(args: {
  category: BuoyEventCategory;
  title: string;
  start_utc: string;
  end_utc: string;
  notes?: string | null;
  location?: string | null;
}) {
  if (!isBuoyEventCategory(args.category)) throw new Error("invalid category");
  if (!args.title || args.title.trim().length === 0) throw new Error("title required");
  if (args.title.length > 200) throw new Error("title max 200 chars");
  if (!args.start_utc || !args.end_utc) throw new Error("start_utc and end_utc required");
  if (isNaN(Date.parse(args.start_utc))) throw new Error("start_utc invalid ISO");
  if (isNaN(Date.parse(args.end_utc))) throw new Error("end_utc invalid ISO");
  if (args.start_utc >= args.end_utc) throw new Error("start_utc must be before end_utc");
  const durationMs = new Date(args.end_utc).getTime() - new Date(args.start_utc).getTime();
  if (durationMs > 30 * 24 * 60 * 60 * 1000) throw new Error("event window max 30 days");
  if (args.notes && args.notes.length > 2000) throw new Error("notes max 2000 chars");
  if (args.location && args.location.length > 300) throw new Error("location max 300 chars");
}
