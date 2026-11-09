// Public availability calendar overrides (public_calendar_blocks).
// Split out of the retired family-storage module on 9 Nov 2026. The old
// family_events / family_day_notes / family_week_notes tables are left in
// data.db untouched; nothing reads or writes them any more.

import Database from "better-sqlite3";

function resolveDbPath(): string {
  return process.env.STAGE17_TEST_DB ?? "data.db";
}

let _db: Database.Database | null = null;

export function getCalendarBlocksDb(): Database.Database {
  if (_db) return _db;
  _db = new Database(resolveDbPath());
  bootstrapTables(_db);
  return _db;
}

export function _setCalendarBlocksTestDb(db: Database.Database): void {
  bootstrapTables(db);
  _db = db;
}

export function _resetCalendarBlocksDbForTest(): void {
  _db = null;
}

function bootstrapTables(db: Database.Database): void {
  db.exec(`
-- Public calendar manual overrides
CREATE TABLE IF NOT EXISTS public_calendar_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  kind TEXT NOT NULL,
  start_utc TEXT,
  end_utc TEXT,
  weekday INTEGER,
  source_event_id TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_public_calendar_blocks_kind ON public_calendar_blocks(kind);
CREATE INDEX IF NOT EXISTS idx_public_calendar_blocks_window ON public_calendar_blocks(start_utc, end_utc);
`);
}

export interface PublicCalendarBlock {
  id: number;
  user_id: number | null;
  kind: "force_available" | "force_busy" | "rule_off_day";
  start_utc: string | null;
  end_utc: string | null;
  weekday: number | null;
  source_event_id: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Public calendar blocks CRUD
// ---------------------------------------------------------------------------

export function listPublicCalendarBlocks(): PublicCalendarBlock[] {
  const db = getCalendarBlocksDb();
  return db
    .prepare(`SELECT * FROM public_calendar_blocks ORDER BY created_at`)
    .all() as PublicCalendarBlock[];
}

export function getPublicCalendarBlock(id: number): PublicCalendarBlock | null {
  const db = getCalendarBlocksDb();
  return (
    (db
      .prepare(`SELECT * FROM public_calendar_blocks WHERE id = ?`)
      .get(id) as PublicCalendarBlock | undefined) ?? null
  );
}

export interface CreateBlockArgs {
  kind: "force_available" | "force_busy" | "rule_off_day";
  start_utc?: string | null;
  end_utc?: string | null;
  weekday?: number | null;
  source_event_id?: string | null;
  note?: string | null;
  user_id?: number | null;
}

export function createPublicCalendarBlock(args: CreateBlockArgs): PublicCalendarBlock {
  const db = getCalendarBlocksDb();
  const result = db
    .prepare(
      `INSERT INTO public_calendar_blocks (kind, start_utc, end_utc, weekday, source_event_id, note, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      args.kind,
      args.start_utc ?? null,
      args.end_utc ?? null,
      args.weekday ?? null,
      args.source_event_id ?? null,
      args.note ?? null,
      args.user_id ?? null,
    );
  return getPublicCalendarBlock(result.lastInsertRowid as number)!;
}

export function deletePublicCalendarBlock(id: number): boolean {
  const db = getCalendarBlocksDb();
  const result = db.prepare(`DELETE FROM public_calendar_blocks WHERE id = ?`).run(id);
  return result.changes > 0;
}
