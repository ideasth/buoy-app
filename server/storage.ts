import {
  tasks,
  topThree,
  habits,
  habitLogs,
  timeBlocks,
  reflections,
  goals,
  settings,
  msTodoLists,
  syncLog,
  morningRoutines,
  inboxScanQueue,
  plannerNotes,
  emailStatus,
  projects,
  projectPhases,
  projectComponents,
  projectTasks,
} from "@shared/schema";
import type {
  Task,
  InsertTask,
  TopThree,
  InsertTopThree,
  Habit,
  InsertHabit,
  HabitLog,
  InsertHabitLog,
  TimeBlock,
  InsertTimeBlock,
  Reflection,
  InsertReflection,
  Goal,
  InsertGoal,
  SettingsBlob,
  MsTodoList,
  InsertMsTodoList,
  SyncLog,
  InsertSyncLog,
  MorningRoutine,
  InsertMorningRoutine,
  InboxScanItem,
  InsertInboxScan,
  PlannerNote,
  EmailStatusRow,
  InsertEmailStatus,
  Project,
  InsertProject,
  ProjectPhase,
  InsertProjectPhase,
  ProjectComponent,
  InsertProjectComponent,
  ProjectTask,
  InsertProjectTask,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, and, desc, gte, lte, isNull, sql } from "drizzle-orm";

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite);

// Run schema migrations inline (no drizzle-kit at runtime)
sqlite.exec(`
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo',
  priority TEXT NOT NULL DEFAULT 'iftime',
  domain TEXT NOT NULL DEFAULT 'work',
  estimate_minutes INTEGER NOT NULL DEFAULT 30,
  actual_minutes INTEGER,
  due_at INTEGER,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  notes TEXT,
  ms_todo_id TEXT,
  ms_todo_list_id TEXT,
  ms_todo_etag TEXT,
  last_synced_at INTEGER,
  sync_dirty INTEGER NOT NULL DEFAULT 0,
  tag TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS tasks_ms_todo_id_unique ON tasks (ms_todo_id);
CREATE TABLE IF NOT EXISTS ms_todo_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ms_list_id TEXT NOT NULL,
  name TEXT NOT NULL,
  default_domain TEXT NOT NULL DEFAULT 'work',
  is_default_target INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS ms_todo_lists_ms_list_id_unique ON ms_todo_lists (ms_list_id);
CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  ms_task_id TEXT,
  summary TEXT NOT NULL,
  detail TEXT
);
CREATE TABLE IF NOT EXISTS top_three (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  task_id1 INTEGER,
  task_id2 INTEGER,
  task_id3 INTEGER,
  locked_at INTEGER
);
CREATE TABLE IF NOT EXISTS habits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  archived_at INTEGER
);
CREATE TABLE IF NOT EXISTS habit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  habit_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  note TEXT
);
CREATE TABLE IF NOT EXISTS time_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER,
  planned_start INTEGER NOT NULL,
  planned_end INTEGER NOT NULL,
  actual_start INTEGER,
  actual_end INTEGER,
  kind TEXT NOT NULL DEFAULT 'focus'
);
CREATE TABLE IF NOT EXISTS reflections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'daily',
  energy INTEGER,
  state TEXT,
  avoided_task TEXT,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  horizon TEXT NOT NULL DEFAULT 'quarter',
  title TEXT NOT NULL,
  why TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS morning_routines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  started_at INTEGER,
  completed_at INTEGER,
  energy INTEGER,
  state TEXT,
  sleep_quality INTEGER,
  gratitude TEXT,
  avoided_task TEXT,
  notes TEXT,
  braindump_raw TEXT,
  braindump_task_ids TEXT,
  top_three_ids TEXT,
  express_mode INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sync_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  processed_at INTEGER,
  error TEXT
);
CREATE TABLE IF NOT EXISTS inbox_scan_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_message_id TEXT,
  subject TEXT,
  from_address TEXT,
  received_at INTEGER,
  suggested_action TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL,
  device_label TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS auth_sessions_token_hash_unique ON auth_sessions (token_hash);
CREATE TABLE IF NOT EXISTS credit_balances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recordedAt INTEGER NOT NULL,
  balance INTEGER NOT NULL,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_credit_balances_recordedAt ON credit_balances(recordedAt);
CREATE TABLE IF NOT EXISTS cron_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cronId TEXT NOT NULL,
  cronType TEXT NOT NULL,
  startedAt INTEGER NOT NULL,
  endedAt INTEGER,
  ok INTEGER DEFAULT 1,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_cron_runs_started ON cron_runs(startedAt);
CREATE INDEX IF NOT EXISTS idx_cron_runs_type ON cron_runs(cronType);
CREATE TABLE IF NOT EXISTS planner_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS planner_notes_date_unique ON planner_notes (date);
CREATE TABLE IF NOT EXISTS credit_estimates (
  cronType TEXT PRIMARY KEY,
  perRunCredits REAL NOT NULL,
  sampleCount INTEGER DEFAULT 0,
  lastUpdatedAt INTEGER
);
INSERT OR IGNORE INTO credit_estimates (cronType, perRunCredits, sampleCount, lastUpdatedAt) VALUES
  ('daily_morning', 5, 0, NULL),
  ('weekly_review', 8, 0, NULL),
  ('two_hour_sync', 15, 0, NULL),
  ('calendar_sync', 10, 0, NULL),
  ('agent_session', 50, 0, NULL);

-- Email Status: high-priority unanswered emails
CREATE TABLE IF NOT EXISTS email_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL UNIQUE,
  thread_id TEXT,
  received_at INTEGER NOT NULL,
  sender TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  body_preview TEXT NOT NULL DEFAULT '',
  importance TEXT,
  is_flagged INTEGER NOT NULL DEFAULT 0,
  draft_response TEXT,
  draft_generated_at INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  dismissed_at INTEGER,
  web_link TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_status_status ON email_status(status);
CREATE INDEX IF NOT EXISTS idx_email_status_received ON email_status(received_at);

-- Projects (mapped from MS To Do lists ending in : Active or : Parked)
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ms_todo_list_id TEXT UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  priority TEXT NOT NULL DEFAULT 'low',
  description TEXT NOT NULL DEFAULT '',
  current_phase_id INTEGER,
  next_action_task_id INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

CREATE TABLE IF NOT EXISTS project_phases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_phases_project ON project_phases(project_id);

CREATE TABLE IF NOT EXISTS project_components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  phase_id INTEGER,
  name TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_components_project ON project_components(project_id);
CREATE INDEX IF NOT EXISTS idx_components_phase ON project_components(phase_id);

CREATE TABLE IF NOT EXISTS project_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  component_id INTEGER,
  ms_todo_task_id TEXT UNIQUE,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  deadline TEXT,
  completed INTEGER NOT NULL DEFAULT 0,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ptasks_project ON project_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_ptasks_component ON project_tasks(component_id);
`);

// Add new columns to existing tasks table if missing (idempotent)
for (const stmt of [
  "ALTER TABLE tasks ADD COLUMN from_braindump INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE tasks ADD COLUMN pending_action TEXT",
]) {
  try {
    sqlite.exec(stmt);
  } catch {
    // Column already exists — ignore.
  }
}

// ICS URL (including GitHub PAT) must be set via ANCHOR_ICS_URL env var.
// Never hardcode a PAT here — the server bundle ships to pplx.app.
const DEFAULT_ICS_URL = process.env.ANCHOR_ICS_URL ?? "";
// AUPFHS Outlook publish URL is a public subscription URL (no PAT), so it's
// safe to bake in as a default. User-set value via Settings overrides this.
const DEFAULT_AUPFHS_ICS_URL =
  process.env.AUPFHS_ICS_URL ??
  "process.env.AUPFHS_ICS_URL_REQUIRED";

const DEFAULT_SETTINGS: SettingsBlob = {
  adhd_tax_coefficient: 1.5,
  briefing_time: "07:00",
  calendar_ics_url: DEFAULT_ICS_URL,
  aupfhs_ics_url: DEFAULT_AUPFHS_ICS_URL,
  timezone: "Australia/Melbourne",
  theme: "dark",
  habits_seeded: false,
  passphrase_hash: null,
};

// On every boot, if ANCHOR_ICS_URL env var is set, treat it as canonical
// and overwrite any stored value. This lets us rotate the GitHub PAT without
// having to wipe data.db. Persisted user-set URLs from /api/settings PATCH are
// preserved when the env var is unset.
if (DEFAULT_ICS_URL) {
  const cur = db.select().from(settings).get();
  if (cur) {
    try {
      const parsed = JSON.parse(cur.data) as SettingsBlob;
      let dirty = false;
      if (parsed.calendar_ics_url !== DEFAULT_ICS_URL) {
        parsed.calendar_ics_url = DEFAULT_ICS_URL;
        dirty = true;
        console.log("[storage] calendar_ics_url updated from ANCHOR_ICS_URL env var");
      }
      // Backfill aupfhs_ics_url if missing on existing rows.
      if (!parsed.aupfhs_ics_url && DEFAULT_AUPFHS_ICS_URL) {
        parsed.aupfhs_ics_url = DEFAULT_AUPFHS_ICS_URL;
        dirty = true;
        console.log("[storage] aupfhs_ics_url backfilled from default");
      }
      if (dirty) {
        db.update(settings).set({ data: JSON.stringify(parsed) }).where(eq(settings.id, cur.id)).run();
      }
    } catch {
      // settings row corrupt; will be re-seeded below
    }
  }
}

// Seed settings row if missing
{
  const existing = db.select().from(settings).get();
  if (!existing) {
    db.insert(settings).values({ data: JSON.stringify(DEFAULT_SETTINGS) }).run();
  }
}

export class Storage {
  // ----- Tasks -----
  listTasks(): Task[] {
    return db.select().from(tasks).orderBy(desc(tasks.createdAt)).all();
  }
  getTask(id: number): Task | undefined {
    return db.select().from(tasks).where(eq(tasks.id, id)).get();
  }
  createTask(input: InsertTask): Task {
    return db
      .insert(tasks)
      .values({ ...input, createdAt: Date.now() })
      .returning()
      .get();
  }
  updateTask(id: number, patch: Partial<Task>): Task | undefined {
    const cur = this.getTask(id);
    const updates: any = { ...patch };
    if (patch.status === "done" && !patch.completedAt) {
      updates.completedAt = Date.now();
    }
    // If the task is linked to MS To Do and a sync-relevant field changed,
    // mark it dirty so the orchestrator picks it up next sync.
    const SYNC_RELEVANT = [
      "title",
      "status",
      "priority",
      "dueAt",
      "notes",
      "completedAt",
      "estimateMinutes",
    ];
    if (
      cur?.msTodoId &&
      Object.keys(patch).some((k) => SYNC_RELEVANT.includes(k)) &&
      patch.syncDirty === undefined
    ) {
      updates.syncDirty = 1;
    }
    db.update(tasks).set(updates).where(eq(tasks.id, id)).run();
    return this.getTask(id);
  }
  deleteTask(id: number) {
    const cur = this.getTask(id);
    // If the task is linked to MS To Do, soft-delete (drop) instead and
    // queue a remote completion so the orchestrator finalises it.
    if (cur?.msTodoId) {
      db.update(tasks)
        .set({ status: "dropped", syncDirty: 1, pendingAction: "complete-remote" })
        .where(eq(tasks.id, id))
        .run();
      return;
    }
    db.delete(tasks).where(eq(tasks.id, id)).run();
  }
  getTaskByMsId(msTodoId: string): Task | undefined {
    return db.select().from(tasks).where(eq(tasks.msTodoId, msTodoId)).get();
  }
  // Used by importer + sync engine: insert with explicit createdAt/sync fields.
  insertRawTask(row: Partial<Task> & { title: string; createdAt: number }): Task {
    return db.insert(tasks).values(row as any).returning().get();
  }

  // ----- Top three -----
  getTopThree(date: string): TopThree | undefined {
    return db.select().from(topThree).where(eq(topThree.date, date)).get();
  }
  setTopThree(date: string, ids: { taskId1?: number; taskId2?: number; taskId3?: number }): TopThree {
    const existing = this.getTopThree(date);
    if (existing) {
      db.update(topThree).set(ids).where(eq(topThree.date, date)).run();
      return this.getTopThree(date)!;
    }
    return db.insert(topThree).values({ date, ...ids }).returning().get();
  }
  lockTopThree(date: string): TopThree | undefined {
    db.update(topThree).set({ lockedAt: Date.now() }).where(eq(topThree.date, date)).run();
    return this.getTopThree(date);
  }

  // ----- Habits -----
  listHabits(): Habit[] {
    return db.select().from(habits).where(isNull(habits.archivedAt)).orderBy(habits.id).all();
  }
  createHabit(input: InsertHabit): Habit {
    return db
      .insert(habits)
      .values({ ...input, createdAt: Date.now() })
      .returning()
      .get();
  }
  updateHabit(id: number, patch: Partial<Habit>): Habit | undefined {
    db.update(habits).set(patch).where(eq(habits.id, id)).run();
    return db.select().from(habits).where(eq(habits.id, id)).get();
  }
  archiveHabit(id: number) {
    db.update(habits).set({ archivedAt: Date.now() }).where(eq(habits.id, id)).run();
  }
  deleteHabit(id: number) {
    db.delete(habits).where(eq(habits.id, id)).run();
    db.delete(habitLogs).where(eq(habitLogs.habitId, id)).run();
  }

  // ----- Habit logs -----
  listHabitLogs(fromDate?: string): HabitLog[] {
    if (fromDate) {
      return db.select().from(habitLogs).where(gte(habitLogs.date, fromDate)).all();
    }
    return db.select().from(habitLogs).all();
  }
  upsertHabitLog(input: InsertHabitLog): HabitLog {
    const existing = db
      .select()
      .from(habitLogs)
      .where(and(eq(habitLogs.habitId, input.habitId), eq(habitLogs.date, input.date)))
      .get();
    if (existing) {
      db.update(habitLogs)
        .set({ done: input.done ?? 0, note: input.note ?? null })
        .where(eq(habitLogs.id, existing.id))
        .run();
      return db.select().from(habitLogs).where(eq(habitLogs.id, existing.id)).get()!;
    }
    return db.insert(habitLogs).values(input).returning().get();
  }

  // ----- Time blocks -----
  listTimeBlocks(): TimeBlock[] {
    return db.select().from(timeBlocks).orderBy(timeBlocks.plannedStart).all();
  }
  createTimeBlock(input: InsertTimeBlock): TimeBlock {
    return db.insert(timeBlocks).values(input).returning().get();
  }
  updateTimeBlock(id: number, patch: Partial<TimeBlock>): TimeBlock | undefined {
    db.update(timeBlocks).set(patch).where(eq(timeBlocks.id, id)).run();
    return db.select().from(timeBlocks).where(eq(timeBlocks.id, id)).get();
  }
  deleteTimeBlock(id: number) {
    db.delete(timeBlocks).where(eq(timeBlocks.id, id)).run();
  }

  // ----- Reflections -----
  listReflections(): Reflection[] {
    return db.select().from(reflections).orderBy(desc(reflections.date)).all();
  }
  createReflection(input: InsertReflection): Reflection {
    return db.insert(reflections).values(input).returning().get();
  }
  updateReflection(id: number, patch: Partial<Reflection>): Reflection | undefined {
    db.update(reflections).set(patch).where(eq(reflections.id, id)).run();
    return db.select().from(reflections).where(eq(reflections.id, id)).get();
  }
  deleteReflection(id: number) {
    db.delete(reflections).where(eq(reflections.id, id)).run();
  }
  getReflectionsBetween(from: string, to: string): Reflection[] {
    return db
      .select()
      .from(reflections)
      .where(and(gte(reflections.date, from), lte(reflections.date, to)))
      .orderBy(desc(reflections.date))
      .all();
  }

  // ----- Goals -----
  listGoals(): Goal[] {
    return db.select().from(goals).orderBy(desc(goals.createdAt)).all();
  }
  createGoal(input: InsertGoal): Goal {
    return db
      .insert(goals)
      .values({ ...input, createdAt: Date.now() })
      .returning()
      .get();
  }
  updateGoal(id: number, patch: Partial<Goal>): Goal | undefined {
    db.update(goals).set(patch).where(eq(goals.id, id)).run();
    return db.select().from(goals).where(eq(goals.id, id)).get();
  }
  deleteGoal(id: number) {
    db.delete(goals).where(eq(goals.id, id)).run();
  }

  // ----- Settings -----
  getSettings(): SettingsBlob {
    const row = db.select().from(settings).get();
    if (!row) {
      return { ...DEFAULT_SETTINGS };
    }
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(row.data) };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }
  updateSettings(patch: Partial<SettingsBlob>): SettingsBlob {
    const cur = this.getSettings();
    const merged = { ...cur, ...patch };
    const row = db.select().from(settings).get();
    if (row) {
      db.update(settings).set({ data: JSON.stringify(merged) }).where(eq(settings.id, row.id)).run();
    } else {
      db.insert(settings).values({ data: JSON.stringify(merged) }).run();
    }
    return merged;
  }

  // ----- Derived -----
  rollingAdhdTaxCoefficient(): number {
    // last 20 completed tasks where both estimate and actual are positive
    const rows = db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.status, "done"),
          sql`${tasks.actualMinutes} IS NOT NULL`,
          sql`${tasks.estimateMinutes} > 0`,
        ),
      )
      .orderBy(desc(tasks.completedAt))
      .limit(20)
      .all();
    if (rows.length === 0) return this.getSettings().adhd_tax_coefficient;
    const ratios = rows.map((r) => (r.actualMinutes ?? 0) / Math.max(1, r.estimateMinutes));
    const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    return Math.round(avg * 100) / 100;
  }

  // ----- MS To Do lists (kept for import-mstodo script + Capture/Settings UI) -----
  getMsTodoListByMsId(msListId: string): MsTodoList | undefined {
    return db.select().from(msTodoLists).where(eq(msTodoLists.msListId, msListId)).get();
  }
  upsertMsTodoList(input: InsertMsTodoList): MsTodoList {
    const existing = this.getMsTodoListByMsId(input.msListId);
    if (existing) {
      db.update(msTodoLists).set(input).where(eq(msTodoLists.id, existing.id)).run();
      return db.select().from(msTodoLists).where(eq(msTodoLists.id, existing.id)).get()!;
    }
    return db.insert(msTodoLists).values(input).returning().get();
  }

  // ----- Sync log (still appended by import-mstodo) -----
  appendSyncLog(input: InsertSyncLog): SyncLog {
    return db.insert(syncLog).values(input).returning().get();
  }
  countImportedTasks(): number {
    const r = db
      .select({ c: sql<number>`count(*)` })
      .from(tasks)
      .where(sql`${tasks.msTodoId} IS NOT NULL`)
      .get();
    return Number(r?.c ?? 0);
  }

  // ----- Morning routines -----
  getMorningByDate(date: string): MorningRoutine | undefined {
    return db.select().from(morningRoutines).where(eq(morningRoutines.date, date)).get();
  }
  ensureMorningForDate(date: string): MorningRoutine {
    const existing = this.getMorningByDate(date);
    if (existing) return existing;
    return db
      .insert(morningRoutines)
      .values({ date, startedAt: Date.now() })
      .returning()
      .get();
  }
  updateMorning(date: string, patch: Partial<MorningRoutine>): MorningRoutine | undefined {
    const existing = this.ensureMorningForDate(date);
    db.update(morningRoutines).set(patch).where(eq(morningRoutines.id, existing.id)).run();
    return this.getMorningByDate(date);
  }
  recentMorningRoutines(limit = 7): MorningRoutine[] {
    return db
      .select()
      .from(morningRoutines)
      .orderBy(desc(morningRoutines.date))
      .limit(limit)
      .all();
  }

  // ----- Inbox scan queue -----
  insertInboxSuggestion(input: InsertInboxScan): InboxScanItem {
    return db.insert(inboxScanQueue).values(input).returning().get();
  }
  listInboxSuggestions(status?: string): InboxScanItem[] {
    if (status) {
      return db
        .select()
        .from(inboxScanQueue)
        .where(eq(inboxScanQueue.status, status))
        .orderBy(desc(inboxScanQueue.createdAt))
        .all();
    }
    return db
      .select()
      .from(inboxScanQueue)
      .orderBy(desc(inboxScanQueue.createdAt))
      .all();
  }
  getInboxSuggestion(id: number): InboxScanItem | undefined {
    return db.select().from(inboxScanQueue).where(eq(inboxScanQueue.id, id)).get();
  }
  decideInboxSuggestion(id: number, status: "approved" | "dismissed"): InboxScanItem | undefined {
    db.update(inboxScanQueue)
      .set({ status, decidedAt: Date.now() })
      .where(eq(inboxScanQueue.id, id))
      .run();
    return this.getInboxSuggestion(id);
  }
  countPendingInbox(): number {
    const r = db
      .select({ c: sql<number>`count(*)` })
      .from(inboxScanQueue)
      .where(eq(inboxScanQueue.status, "pending"))
      .get();
    return Number(r?.c ?? 0);
  }

  // ----- Credit balances -----
  insertCreditBalance(balance: number, note?: string | null): { id: number; recordedAt: number; balance: number; note: string | null } {
    const recordedAt = Date.now();
    const result = sqlite.prepare(
      "INSERT INTO credit_balances (recordedAt, balance, note) VALUES (?, ?, ?) RETURNING id, recordedAt, balance, note"
    ).get(recordedAt, balance, note ?? null) as any;
    return result;
  }
  getLastTwoCreditBalances(): Array<{ id: number; recordedAt: number; balance: number; note: string | null }> {
    return sqlite.prepare(
      "SELECT id, recordedAt, balance, note FROM credit_balances ORDER BY recordedAt DESC LIMIT 2"
    ).all() as any[];
  }
  getCreditBalancesSince(since: number): Array<{ id: number; recordedAt: number; balance: number; note: string | null }> {
    return sqlite.prepare(
      "SELECT id, recordedAt, balance, note FROM credit_balances WHERE recordedAt > ? ORDER BY recordedAt ASC"
    ).all(since) as any[];
  }
  getRecentCreditBalances(limit = 14): Array<{ id: number; recordedAt: number; balance: number; note: string | null }> {
    return sqlite.prepare(
      "SELECT id, recordedAt, balance, note FROM credit_balances ORDER BY recordedAt DESC LIMIT ?"
    ).all(limit) as any[];
  }
  deleteCreditBalance(id: number): void {
    sqlite.prepare("DELETE FROM credit_balances WHERE id = ?").run(id);
  }
  getCreditBalancesBetween(from: number, to: number): Array<{ id: number; recordedAt: number; balance: number; note: string | null }> {
    return sqlite.prepare(
      "SELECT id, recordedAt, balance, note FROM credit_balances WHERE recordedAt >= ? AND recordedAt <= ? ORDER BY recordedAt ASC"
    ).all(from, to) as any[];
  }

  // ----- Cron runs -----
  insertCronRun(cronId: string, cronType: string, startedAt: number, endedAt?: number | null, ok = 1, notes?: string | null): { id: number } {
    const result = sqlite.prepare(
      "INSERT INTO cron_runs (cronId, cronType, startedAt, endedAt, ok, notes) VALUES (?, ?, ?, ?, ?, ?) RETURNING id"
    ).get(cronId, cronType, startedAt, endedAt ?? null, ok, notes ?? null) as any;
    return result;
  }
  getCronRunsSince(since: number): Array<{ id: number; cronId: string; cronType: string; startedAt: number; endedAt: number | null; ok: number; notes: string | null }> {
    return sqlite.prepare(
      "SELECT id, cronId, cronType, startedAt, endedAt, ok, notes FROM cron_runs WHERE startedAt > ? ORDER BY startedAt ASC"
    ).all(since) as any[];
  }
  getCronRunsBetween(from: number, to: number): Array<{ cronType: string }> {
    return sqlite.prepare(
      "SELECT cronType FROM cron_runs WHERE startedAt >= ? AND startedAt <= ?"
    ).all(from, to) as any[];
  }
  getCronRunCountsByType(since: number): Array<{ cronType: string; count: number }> {
    return sqlite.prepare(
      "SELECT cronType, COUNT(*) as count FROM cron_runs WHERE startedAt > ? GROUP BY cronType"
    ).all(since) as any[];
  }

  // ----- Credit estimates -----
  getAllCreditEstimates(): Array<{ cronType: string; perRunCredits: number; sampleCount: number; lastUpdatedAt: number | null }> {
    return sqlite.prepare("SELECT cronType, perRunCredits, sampleCount, lastUpdatedAt FROM credit_estimates").all() as any[];
  }
  updateCreditEstimate(cronType: string, perRunCredits: number, sampleCount: number): void {
    sqlite.prepare(
      "UPDATE credit_estimates SET perRunCredits = ?, sampleCount = ?, lastUpdatedAt = ? WHERE cronType = ?"
    ).run(perRunCredits, sampleCount, Date.now(), cronType);
  }

  // ----- Planner notes -----
  getPlannerNote(date: string): PlannerNote | undefined {
    return db.select().from(plannerNotes).where(eq(plannerNotes.date, date)).get();
  }
  upsertPlannerNote(date: string, note: string): PlannerNote {
    const existing = this.getPlannerNote(date);
    const updatedAt = Date.now();
    if (existing) {
      db.update(plannerNotes)
        .set({ note, updatedAt })
        .where(eq(plannerNotes.id, existing.id))
        .run();
      return this.getPlannerNote(date)!;
    }
    return db
      .insert(plannerNotes)
      .values({ date, note, updatedAt })
      .returning()
      .get();
  }
  listPlannerNotes(from: string, to: string): PlannerNote[] {
    return db
      .select()
      .from(plannerNotes)
      .where(and(gte(plannerNotes.date, from), lte(plannerNotes.date, to)))
      .all();
  }
  deletePlannerNote(date: string): void {
    db.delete(plannerNotes).where(eq(plannerNotes.date, date)).run();
  }

  // ===== Email Status =====
  listEmailStatus(includeDismissed = false): EmailStatusRow[] {
    if (includeDismissed) {
      return db.select().from(emailStatus).orderBy(desc(emailStatus.receivedAt)).all();
    }
    return db.select().from(emailStatus)
      .where(eq(emailStatus.status, "pending"))
      .orderBy(desc(emailStatus.receivedAt))
      .all();
  }
  upsertEmailStatus(input: InsertEmailStatus): EmailStatusRow {
    const now = Date.now();
    const existing = db.select().from(emailStatus).where(eq(emailStatus.messageId, input.messageId)).get();
    if (existing) {
      const updates: Partial<InsertEmailStatus> = { updatedAt: now };
      if (input.draftResponse !== undefined) updates.draftResponse = input.draftResponse;
      if (input.draftGeneratedAt !== undefined) updates.draftGeneratedAt = input.draftGeneratedAt;
      if (input.bodyPreview !== undefined) updates.bodyPreview = input.bodyPreview;
      if (input.isFlagged !== undefined) updates.isFlagged = input.isFlagged;
      if (input.importance !== undefined) updates.importance = input.importance;
      if (input.threadId !== undefined) updates.threadId = input.threadId;
      if (input.webLink !== undefined) updates.webLink = input.webLink;
      db.update(emailStatus).set(updates).where(eq(emailStatus.id, existing.id)).run();
      return db.select().from(emailStatus).where(eq(emailStatus.id, existing.id)).get()!;
    }
    return db.insert(emailStatus).values({ ...input, updatedAt: now }).returning().get();
  }
  setEmailStatusStatus(id: number, status: "pending" | "replied" | "dismissed"): void {
    const now = Date.now();
    const updates: any = { status, updatedAt: now };
    if (status === "dismissed") updates.dismissedAt = now;
    db.update(emailStatus).set(updates).where(eq(emailStatus.id, id)).run();
  }
  updateEmailDraft(id: number, draft: string): void {
    const now = Date.now();
    db.update(emailStatus)
      .set({ draftResponse: draft, draftGeneratedAt: now, updatedAt: now })
      .where(eq(emailStatus.id, id))
      .run();
  }

  // ===== Projects =====
  listProjects(): Project[] {
    return db.select().from(projects).orderBy(projects.priority, projects.name).all();
  }
  getProject(id: number): Project | undefined {
    return db.select().from(projects).where(eq(projects.id, id)).get();
  }
  upsertProjectByListId(input: InsertProject): Project {
    const now = Date.now();
    if (input.msTodoListId) {
      const existing = db.select().from(projects).where(eq(projects.msTodoListId, input.msTodoListId)).get();
      if (existing) {
        const updates: any = { updatedAt: now };
        if (input.name) updates.name = input.name;
        if (input.status) updates.status = input.status;
        db.update(projects).set(updates).where(eq(projects.id, existing.id)).run();
        return db.select().from(projects).where(eq(projects.id, existing.id)).get()!;
      }
    }
    return db.insert(projects).values({ ...input, createdAt: now, updatedAt: now }).returning().get();
  }
  createProject(input: { name: string; status?: string; priority?: string; description?: string }): Project {
    const now = Date.now();
    return db.insert(projects).values({
      name: input.name,
      status: input.status || "active",
      priority: input.priority || "low",
      description: input.description || "",
      createdAt: now,
      updatedAt: now,
    }).returning().get();
  }
  updateProject(id: number, updates: Partial<InsertProject>): Project | undefined {
    db.update(projects).set({ ...updates, updatedAt: Date.now() }).where(eq(projects.id, id)).run();
    return this.getProject(id);
  }
  deleteProject(id: number): void {
    db.delete(projectTasks).where(eq(projectTasks.projectId, id)).run();
    db.delete(projectComponents).where(eq(projectComponents.projectId, id)).run();
    db.delete(projectPhases).where(eq(projectPhases.projectId, id)).run();
    db.delete(projects).where(eq(projects.id, id)).run();
  }

  listProjectPhases(projectId: number): ProjectPhase[] {
    return db.select().from(projectPhases)
      .where(eq(projectPhases.projectId, projectId))
      .orderBy(projectPhases.orderIndex)
      .all();
  }
  createProjectPhase(input: InsertProjectPhase): ProjectPhase {
    return db.insert(projectPhases).values({ ...input, createdAt: Date.now() }).returning().get();
  }
  updateProjectPhase(id: number, updates: Partial<InsertProjectPhase>): void {
    db.update(projectPhases).set(updates).where(eq(projectPhases.id, id)).run();
  }
  deleteProjectPhase(id: number): void {
    db.update(projectComponents).set({ phaseId: null }).where(eq(projectComponents.phaseId, id)).run();
    db.delete(projectPhases).where(eq(projectPhases.id, id)).run();
  }

  listProjectComponents(projectId: number): ProjectComponent[] {
    return db.select().from(projectComponents)
      .where(eq(projectComponents.projectId, projectId))
      .orderBy(projectComponents.orderIndex)
      .all();
  }
  createProjectComponent(input: InsertProjectComponent): ProjectComponent {
    return db.insert(projectComponents).values({ ...input, createdAt: Date.now() }).returning().get();
  }
  updateProjectComponent(id: number, updates: Partial<InsertProjectComponent>): void {
    db.update(projectComponents).set(updates).where(eq(projectComponents.id, id)).run();
  }
  deleteProjectComponent(id: number): void {
    db.update(projectTasks).set({ componentId: null }).where(eq(projectTasks.componentId, id)).run();
    db.delete(projectComponents).where(eq(projectComponents.id, id)).run();
  }

  listProjectTasks(projectId: number, options?: { unassignedOnly?: boolean }): ProjectTask[] {
    let q = db.select().from(projectTasks).where(eq(projectTasks.projectId, projectId));
    if (options?.unassignedOnly) {
      q = db.select().from(projectTasks).where(
        and(eq(projectTasks.projectId, projectId), isNull(projectTasks.componentId)),
      );
    }
    return q.orderBy(projectTasks.orderIndex, desc(projectTasks.createdAt)).all();
  }
  upsertProjectTaskByMsId(input: InsertProjectTask): ProjectTask {
    const now = Date.now();
    if (input.msTodoTaskId) {
      const existing = db.select().from(projectTasks).where(eq(projectTasks.msTodoTaskId, input.msTodoTaskId)).get();
      if (existing) {
        const updates: any = { updatedAt: now };
        if (input.title) updates.title = input.title;
        if (input.notes !== undefined) updates.notes = input.notes;
        if (input.deadline !== undefined) updates.deadline = input.deadline;
        if (input.completed !== undefined) updates.completed = input.completed;
        db.update(projectTasks).set(updates).where(eq(projectTasks.id, existing.id)).run();
        return db.select().from(projectTasks).where(eq(projectTasks.id, existing.id)).get()!;
      }
    }
    return db.insert(projectTasks).values({ ...input, createdAt: now, updatedAt: now }).returning().get();
  }
  createProjectTask(input: InsertProjectTask): ProjectTask {
    const now = Date.now();
    return db.insert(projectTasks).values({ ...input, createdAt: now, updatedAt: now }).returning().get();
  }
  updateProjectTask(id: number, updates: Partial<InsertProjectTask>): void {
    db.update(projectTasks).set({ ...updates, updatedAt: Date.now() }).where(eq(projectTasks.id, id)).run();
  }
  deleteProjectTask(id: number): void {
    db.delete(projectTasks).where(eq(projectTasks.id, id)).run();
  }

  seedDefaultHabitsIfNeeded() {
    const s = this.getSettings();
    if (s.habits_seeded) return;
    const defaults = [
      { name: "Sleep", target: "7+ hours" },
      { name: "Exercise", target: "30 min movement" },
      { name: "Family dinner", target: "Eat with family" },
      { name: "Deep work", target: "1× 90-min block" },
      { name: "Phone down by 10pm", target: "Off by 22:00" },
    ];
    for (const h of defaults) {
      db.insert(habits).values({ ...h, createdAt: Date.now() }).run();
    }
    this.updateSettings({ habits_seeded: true });
  }
}

export const storage = new Storage();
storage.seedDefaultHabitsIfNeeded();
