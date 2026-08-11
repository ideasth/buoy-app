// Stage 24 (2026-08-11) — Relationship Transition module storage layer.
//
// Encapsulates schema migration, seeding, and CRUD for the five new
// tables: transition_state, transition_actions, transition_ledger,
// transition_financial_items, transition_it_handover.
//
// Deliberately isolated from server/storage.ts so the module can be
// evolved (and, if ever needed, removed) without touching the shipped
// Buoy storage layer.

import type Database from "better-sqlite3";
import { rawSqlite } from "./storage";
import {
  TRANSITION_ACTION_STATUSES,
  TRANSITION_CONFIDENTIALITY_LEVELS,
  TRANSITION_CREDENTIAL_REGEX,
  TRANSITION_EXPORT_AUDIENCES,
  TRANSITION_FIN_CATEGORIES,
  TRANSITION_FIN_DIRECTIONS,
  TRANSITION_FIN_EVIDENCE_STATUSES,
  TRANSITION_HORIZONS,
  TRANSITION_IT_ACCESS_STATUSES,
  TRANSITION_IT_HANDOVER_STATUSES,
  TRANSITION_IT_SENSITIVITY,
  TRANSITION_LEDGER_PERSPECTIVES,
  TRANSITION_PHASES,
  TRANSITION_RECORD_TYPES,
  TRANSITION_SOURCE_KINDS,
  type TransitionExportAudience,
} from "@shared/schema";

// ---------- schema migration ----------

export function ensureTransitionSchema(db: Database.Database = rawSqlite as any): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS transition_state (
      id INTEGER PRIMARY KEY,
      phase TEXT NOT NULL DEFAULT 'decision_taken',
      decision_statement TEXT,
      decision_statement_updated_at INTEGER,
      driver_relationship_end INTEGER,
      driver_financial_pressure INTEGER,
      driver_workload_pressure INTEGER,
      driver_child_impact INTEGER,
      driver_relationship_quality INTEGER,
      driver_health_impact INTEGER,
      driver_business_impact INTEGER,
      drivers_updated_at INTEGER,
      interaction_climate TEXT,
      interaction_climate_updated_at INTEGER,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transition_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      horizon TEXT NOT NULL DEFAULT '2w',
      area TEXT NOT NULL DEFAULT 'general',
      title TEXT NOT NULL,
      detail TEXT,
      status TEXT NOT NULL DEFAULT 'Open',
      due_at INTEGER,
      record_type TEXT NOT NULL DEFAULT 'recommendation',
      confidentiality TEXT NOT NULL DEFAULT 'private',
      source_url TEXT,
      source_label TEXT,
      seed_key TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_transition_actions_seed_key
      ON transition_actions(seed_key) WHERE seed_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_transition_actions_horizon
      ON transition_actions(horizon, sort_order, id);

    CREATE TABLE IF NOT EXISTS transition_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_type TEXT NOT NULL,
      category TEXT,
      title TEXT,
      body TEXT NOT NULL,
      event_date TEXT,
      source_kind TEXT,
      source_url TEXT,
      source_label TEXT,
      perspective TEXT NOT NULL DEFAULT 'me',
      confidentiality TEXT NOT NULL DEFAULT 'private',
      seed_key TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_transition_ledger_seed_key
      ON transition_ledger(seed_key) WHERE seed_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_transition_ledger_record_type
      ON transition_ledger(record_type, created_at DESC);

    CREATE TABLE IF NOT EXISTS transition_financial_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL DEFAULT 'other',
      description TEXT NOT NULL,
      amount_aud_cents INTEGER,
      direction TEXT NOT NULL DEFAULT 'unknown',
      event_date TEXT,
      evidence_status TEXT NOT NULL DEFAULT 'partial',
      source_url TEXT,
      source_label TEXT,
      notes TEXT,
      record_type TEXT NOT NULL DEFAULT 'documented_fact',
      confidentiality TEXT NOT NULL DEFAULT 'private',
      seed_key TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_transition_financial_seed_key
      ON transition_financial_items(seed_key) WHERE seed_key IS NOT NULL;

    CREATE TABLE IF NOT EXISTS transition_it_handover (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      system TEXT NOT NULL,
      account_context TEXT,
      access_status TEXT NOT NULL DEFAULT 'unknown',
      handover_status TEXT NOT NULL DEFAULT 'not_started',
      sensitivity TEXT NOT NULL DEFAULT 'standard',
      notes TEXT,
      next_action TEXT,
      due_at INTEGER,
      record_type TEXT NOT NULL DEFAULT 'recommendation',
      confidentiality TEXT NOT NULL DEFAULT 'private',
      seed_key TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_transition_it_seed_key
      ON transition_it_handover(seed_key) WHERE seed_key IS NOT NULL;
  `);
}

// ---------- seeding (idempotent by seed_key) ----------

const SEED_DECISION_STATEMENT =
  "I've made the decision to end my marriage with Marieke. The next 1\u20133 months are about doing this safely: protecting the children, protecting my recovery and work capacity, sorting finances honestly, and untangling shared IT and household systems. This module is my own governance surface \u2014 not a channel to Marieke, and not a tool for Axel or Hilde.";

const SEED_INTERACTION_CLIMATE = {
  conflict_level: 3,
  communication_quality: 2,
  hostility_signals: ["post-Bangkok friction"],
  safety_concerns: null,
};

const SEED_LEDGER: Array<{
  seed_key: string;
  record_type: string;
  category: string;
  title: string;
  body: string;
  source_kind: string;
  perspective: string;
}> = [
  {
    seed_key: "seed:2026-08-11:historical-mismatch",
    record_type: "historical_summary",
    category: "pattern",
    title: "Long-standing mismatch",
    body:
      "Repeated pattern of financial imbalance and workload imbalance across the relationship, culminating in the Sunday-message dynamic and the Bangkok trip.",
    source_kind: "own_recollection",
    perspective: "me",
  },
  {
    seed_key: "seed:2026-08-11:sunday-message-correction",
    record_type: "reported_other_statement",
    category: "communication",
    title: "Sunday message \u2014 correction skeleton",
    body:
      "Sunday message: Marieke stated <fill in verbatim quote>. Correction: my recollection differs on <fill in point>. Kept as a skeleton so the record exists before the detail is added.",
    source_kind: "message",
    perspective: "other",
  },
  {
    seed_key: "seed:2026-08-11:post-flight-morning-message",
    record_type: "self_report",
    category: "communication",
    title: "Post-flight morning message (Aug 11)",
    body:
      "On arrival for my flight, I confirmed my intent to end the marriage and named the reasons. My recollection of what I sent and why.",
    source_kind: "message",
    perspective: "me",
  },
  {
    seed_key: "seed:2026-08-11:child-communication-question",
    record_type: "open_question",
    category: "child_related",
    title: "How and when to tell Axel and Hilde",
    body:
      "How and when do we tell Axel (14) and Hilde (10)? Coordinate wording with therapist first. Never unilaterally. No child-facing surface in this module.",
    source_kind: "inference",
    perspective: "me",
  },
  {
    seed_key: "seed:2026-08-11:no-outbound-send",
    record_type: "recommendation",
    category: "governance",
    title: "Do not send any of these records",
    body:
      "This module is read-only outbound. No send buttons, no message construction, no forwarding. Every export is a copy-only Markdown bundle for me or a professional advisor.",
    source_kind: "inference",
    perspective: "me",
  },
];

const SEED_FINANCIAL: Array<{
  seed_key: string;
  category: string;
  description: string;
  evidence_status: string;
}> = [
  { seed_key: "seed:fin:couch", category: "furniture", description: "Couch", evidence_status: "partial" },
  { seed_key: "seed:fin:white-goods", category: "white_goods", description: "White goods (fridge / washing machine / dryer)", evidence_status: "partial" },
  { seed_key: "seed:fin:tools", category: "tools", description: "Tools", evidence_status: "partial" },
  { seed_key: "seed:fin:festival-tickets", category: "tickets", description: "Festival tickets", evidence_status: "partial" },
  { seed_key: "seed:fin:bangkok-flights", category: "travel", description: "Bangkok flights", evidence_status: "partial" },
  { seed_key: "seed:fin:groceries-pattern", category: "groceries", description: "Groceries \u2014 pattern of imbalance", evidence_status: "recollection_only" },
  { seed_key: "seed:fin:renovations", category: "renovations", description: "Renovations", evidence_status: "partial" },
];

const SEED_IT_HANDOVER: Array<{
  seed_key: string;
  system: string;
  sensitivity: string;
  next_action: string;
}> = [
  { seed_key: "seed:it:google-workspace", system: "Google Workspace", sensitivity: "sensitive", next_action: "Inventory shared docs; plan account separation." },
  { seed_key: "seed:it:icloud-family", system: "iCloud family sharing", sensitivity: "sensitive", next_action: "List shared subscriptions; plan family-share dissolution." },
  { seed_key: "seed:it:xero", system: "Xero", sensitivity: "sensitive", next_action: "Confirm who has access to which entities; plan cut-over." },
  { seed_key: "seed:it:meta-business", system: "Meta Business Suite", sensitivity: "standard", next_action: "Confirm page admins; plan admin handover." },
  { seed_key: "seed:it:squarespace", system: "Squarespace", sensitivity: "standard", next_action: "Confirm site ownership; plan handover if applicable." },
  { seed_key: "seed:it:home-apple-home", system: "Home network / Apple Home", sensitivity: "standard", next_action: "Plan Home hub owner + device rotation." },
];

const SEED_ACTIONS: Array<{
  seed_key: string;
  horizon: string;
  area: string;
  title: string;
  detail: string;
  sort_order: number;
}> = [
  { seed_key: "seed:act:72h:solicitor", horizon: "72h", area: "legal", title: "Call solicitor for initial consult", detail: "Get first advice on process, timing, and immediate do-not-do list.", sort_order: 1 },
  { seed_key: "seed:act:72h:therapist", horizon: "72h", area: "health", title: "Brief therapist on decision and wording for children", detail: "Wording for Axel and Hilde must be agreed with therapist before any conversation with them.", sort_order: 2 },
  { seed_key: "seed:act:72h:no-bigticket", horizon: "72h", area: "finance", title: "Do NOT initiate any big-ticket transfer or shared-account change", detail: "Freeze impulse changes. Every financial move should go through solicitor advice first.", sort_order: 3 },
  { seed_key: "seed:act:72h:household", horizon: "72h", area: "family", title: "Keep normal household running", detail: "Minimise disruption for the children over the next 72 hours.", sort_order: 4 },
  { seed_key: "seed:act:72h:sleep-eat", horizon: "72h", area: "health", title: "Sleep and eat", detail: "Non-negotiable baseline. Recovery capacity comes first.", sort_order: 5 },

  { seed_key: "seed:act:2w:legal-appt", horizon: "2w", area: "legal", title: "First legal advice appointment", detail: "Formal appointment, not just the initial consult call.", sort_order: 1 },
  { seed_key: "seed:act:2w:therapist-appts", horizon: "2w", area: "health", title: "Therapist appointments booked", detail: "Regular cadence for the next 3 months.", sort_order: 2 },
  { seed_key: "seed:act:2w:fin-register-draft", horizon: "2w", area: "finance", title: "Draft (do not send) financial-reconciliation register", detail: "Populate the register in this module. Do not share yet.", sort_order: 3 },
  { seed_key: "seed:act:2w:safe-channel", horizon: "2w", area: "communication", title: "Identify safe communication channel with Marieke", detail: "Written, low-conflict, one topic per thread. Consider a mediator-suggested channel.", sort_order: 4 },
  { seed_key: "seed:act:2w:gp", horizon: "2w", area: "health", title: "GP check-in re: sleep / stress", detail: "Baseline review; consider short-term supports.", sort_order: 5 },

  { seed_key: "seed:act:1_3m:pathway", horizon: "1_3m", area: "legal", title: "Mediator vs solicitor pathway decision", detail: "Choose the primary pathway based on advice from the initial legal + therapist consults.", sort_order: 1 },
  { seed_key: "seed:act:1_3m:property", horizon: "1_3m", area: "housing", title: "Property + tenancy plan", detail: "Who stays where, in what sequence, and how the children experience it.", sort_order: 2 },
  { seed_key: "seed:act:1_3m:it-handover", horizon: "1_3m", area: "it_handover", title: "IT handover schedule with hard cut-over dates", detail: "Google, iCloud, Xero, Meta, Squarespace, Home. See IT handover section.", sort_order: 3 },
  { seed_key: "seed:act:1_3m:child-comm-plan", horizon: "1_3m", area: "children", title: "Child-communication plan agreed with therapist", detail: "Wording and timing for Axel and Hilde. Nothing unilateral.", sort_order: 4 },
  { seed_key: "seed:act:1_3m:work-capacity", horizon: "1_3m", area: "work", title: "Work capacity plan (Bayside / Sandringham / AUPFHS load review)", detail: "Protect clinical capacity and recovery. Consider short-term load reduction.", sort_order: 5 },
];

export function seedTransitionModule(db: Database.Database = rawSqlite as any): void {
  const now = Date.now();

  // ---- state row ----
  const stateRow = db
    .prepare("SELECT id FROM transition_state WHERE id = 1")
    .get() as { id: number } | undefined;
  if (!stateRow) {
    db
      .prepare(
        `INSERT INTO transition_state (
          id, phase, decision_statement, decision_statement_updated_at,
          driver_relationship_end, driver_financial_pressure, driver_workload_pressure,
          driver_child_impact, driver_relationship_quality, driver_health_impact,
          driver_business_impact, drivers_updated_at,
          interaction_climate, interaction_climate_updated_at,
          updated_at
        ) VALUES (1, 'decision_taken', ?, ?,
          5, 4, 4, 4, 5, 4, 3, ?,
          ?, ?, ?)`,
      )
      .run(
        SEED_DECISION_STATEMENT,
        now,
        now,
        JSON.stringify(SEED_INTERACTION_CLIMATE),
        now,
        now,
      );
  }

  // ---- ledger seeds ----
  const insertLedger = db.prepare(
    `INSERT OR IGNORE INTO transition_ledger
      (record_type, category, title, body, event_date, source_kind, source_url,
       source_label, perspective, confidentiality, seed_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?, NULL, NULL, ?, 'private', ?, ?, ?)`,
  );
  const ledgerTx = db.transaction(() => {
    for (const row of SEED_LEDGER) {
      insertLedger.run(
        row.record_type,
        row.category,
        row.title,
        row.body,
        row.source_kind,
        row.perspective,
        row.seed_key,
        now,
        now,
      );
    }
  });
  ledgerTx();

  // ---- financial seeds ----
  const insertFin = db.prepare(
    `INSERT OR IGNORE INTO transition_financial_items
      (category, description, amount_aud_cents, direction, event_date,
       evidence_status, source_url, source_label, notes, record_type,
       confidentiality, seed_key, created_at, updated_at)
     VALUES (?, ?, NULL, 'unknown', NULL, ?, NULL, NULL, NULL,
             'documented_fact', 'private', ?, ?, ?)`,
  );
  const finTx = db.transaction(() => {
    for (const row of SEED_FINANCIAL) {
      insertFin.run(
        row.category,
        row.description,
        row.evidence_status,
        row.seed_key,
        now,
        now,
      );
    }
  });
  finTx();

  // ---- IT handover seeds ----
  const insertIt = db.prepare(
    `INSERT OR IGNORE INTO transition_it_handover
      (system, account_context, access_status, handover_status, sensitivity,
       notes, next_action, due_at, record_type, confidentiality, seed_key,
       created_at, updated_at)
     VALUES (?, NULL, 'unknown', 'not_started', ?, NULL, ?, NULL,
             'recommendation', 'private', ?, ?, ?)`,
  );
  const itTx = db.transaction(() => {
    for (const row of SEED_IT_HANDOVER) {
      insertIt.run(
        row.system,
        row.sensitivity,
        row.next_action,
        row.seed_key,
        now,
        now,
      );
    }
  });
  itTx();

  // ---- action plan seeds ----
  const insertAct = db.prepare(
    `INSERT OR IGNORE INTO transition_actions
      (horizon, area, title, detail, status, due_at, record_type,
       confidentiality, source_url, source_label, seed_key, sort_order,
       created_at, updated_at, completed_at)
     VALUES (?, ?, ?, ?, 'Open', NULL, 'recommendation', 'private', NULL, NULL,
             ?, ?, ?, ?, NULL)`,
  );
  const actTx = db.transaction(() => {
    for (const row of SEED_ACTIONS) {
      insertAct.run(
        row.horizon,
        row.area,
        row.title,
        row.detail,
        row.seed_key,
        row.sort_order,
        now,
        now,
      );
    }
  });
  actTx();
}

// ---------- validation helpers ----------

function inEnum<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === "string" && (list as readonly string[]).includes(v);
}

function nowMs(): number {
  return Date.now();
}

function assertNoCredentials(text: unknown, field: string): void {
  if (typeof text === "string" && TRANSITION_CREDENTIAL_REGEX.test(text)) {
    const err: any = new Error(`credential_in_${field}`);
    err.status = 400;
    err.code = `credential_in_${field}`;
    throw err;
  }
}

// ---------- state ----------

export function getTransitionState() {
  const row = rawSqlite
    .prepare("SELECT * FROM transition_state WHERE id = 1")
    .get() as any;
  if (!row) return null;
  return normalizeStateRow(row);
}

function normalizeStateRow(row: any) {
  let climate: any = null;
  if (row.interaction_climate) {
    try {
      climate = JSON.parse(row.interaction_climate);
    } catch {
      climate = null;
    }
  }
  return {
    id: 1,
    phase: row.phase,
    decisionStatement: row.decision_statement,
    decisionStatementUpdatedAt: row.decision_statement_updated_at,
    drivers: {
      relationshipEnd: row.driver_relationship_end,
      financialPressure: row.driver_financial_pressure,
      workloadPressure: row.driver_workload_pressure,
      childImpact: row.driver_child_impact,
      relationshipQuality: row.driver_relationship_quality,
      healthImpact: row.driver_health_impact,
      businessImpact: row.driver_business_impact,
    },
    driversUpdatedAt: row.drivers_updated_at,
    interactionClimate: climate,
    interactionClimateUpdatedAt: row.interaction_climate_updated_at,
    updatedAt: row.updated_at,
  };
}

export function patchTransitionState(patch: Record<string, unknown>) {
  const allowedTop = new Set([
    "phase",
    "decisionStatement",
    "drivers",
    "interactionClimate",
  ]);
  for (const key of Object.keys(patch)) {
    if (!allowedTop.has(key)) {
      const err: any = new Error(`unknown_field:${key}`);
      err.status = 400;
      err.code = "unknown_field";
      throw err;
    }
  }
  const now = nowMs();
  const sets: string[] = [];
  const params: any[] = [];

  if ("phase" in patch) {
    if (!inEnum(TRANSITION_PHASES, patch.phase)) {
      const err: any = new Error("invalid_phase");
      err.status = 400;
      err.code = "invalid_phase";
      throw err;
    }
    sets.push("phase = ?");
    params.push(patch.phase);
  }
  if ("decisionStatement" in patch) {
    if (patch.decisionStatement !== null && typeof patch.decisionStatement !== "string") {
      const err: any = new Error("invalid_decision_statement");
      err.status = 400;
      err.code = "invalid_decision_statement";
      throw err;
    }
    sets.push("decision_statement = ?", "decision_statement_updated_at = ?");
    params.push(patch.decisionStatement, now);
  }
  if ("drivers" in patch) {
    const d = patch.drivers as Record<string, unknown> | null;
    if (d === null || typeof d !== "object") {
      const err: any = new Error("invalid_drivers");
      err.status = 400;
      err.code = "invalid_drivers";
      throw err;
    }
    const map: Record<string, string> = {
      relationshipEnd: "driver_relationship_end",
      financialPressure: "driver_financial_pressure",
      workloadPressure: "driver_workload_pressure",
      childImpact: "driver_child_impact",
      relationshipQuality: "driver_relationship_quality",
      healthImpact: "driver_health_impact",
      businessImpact: "driver_business_impact",
    };
    for (const [k, col] of Object.entries(map)) {
      if (k in d) {
        const val = (d as any)[k];
        if (val !== null && (typeof val !== "number" || val < 1 || val > 5)) {
          const err: any = new Error(`invalid_driver:${k}`);
          err.status = 400;
          err.code = `invalid_driver:${k}`;
          throw err;
        }
        sets.push(`${col} = ?`);
        params.push(val);
      }
    }
    sets.push("drivers_updated_at = ?");
    params.push(now);
  }
  if ("interactionClimate" in patch) {
    const c = patch.interactionClimate;
    if (c !== null && typeof c !== "object") {
      const err: any = new Error("invalid_climate");
      err.status = 400;
      err.code = "invalid_climate";
      throw err;
    }
    sets.push("interaction_climate = ?", "interaction_climate_updated_at = ?");
    params.push(c === null ? null : JSON.stringify(c), now);
  }

  if (sets.length === 0) return getTransitionState();

  sets.push("updated_at = ?");
  params.push(now);

  rawSqlite
    .prepare(`UPDATE transition_state SET ${sets.join(", ")} WHERE id = 1`)
    .run(...params);
  return getTransitionState();
}

// ---------- actions ----------

const ACTION_INSERT_FIELDS = [
  "horizon",
  "area",
  "title",
  "detail",
  "status",
  "dueAt",
  "recordType",
  "confidentiality",
  "sourceUrl",
  "sourceLabel",
  "sortOrder",
] as const;

const ACTION_PATCH_FIELDS = [
  ...ACTION_INSERT_FIELDS,
  "completedAt",
] as const;

export function listTransitionActions(filters: {
  horizon?: string;
  area?: string;
  status?: string;
}) {
  const where: string[] = [];
  const params: any[] = [];
  if (filters.horizon) {
    where.push("horizon = ?");
    params.push(filters.horizon);
  }
  if (filters.area) {
    where.push("area = ?");
    params.push(filters.area);
  }
  if (filters.status) {
    where.push("status = ?");
    params.push(filters.status);
  }
  const sql = `SELECT * FROM transition_actions ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY horizon, sort_order, id`;
  const rows = rawSqlite.prepare(sql).all(...params) as any[];
  return rows.map(normalizeActionRow);
}

function normalizeActionRow(r: any) {
  return {
    id: r.id,
    horizon: r.horizon,
    area: r.area,
    title: r.title,
    detail: r.detail,
    status: r.status,
    dueAt: r.due_at,
    recordType: r.record_type,
    confidentiality: r.confidentiality,
    sourceUrl: r.source_url,
    sourceLabel: r.source_label,
    seedKey: r.seed_key,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    completedAt: r.completed_at,
  };
}

function validateActionFields(body: any, isPatch: boolean) {
  const allowed = new Set<string>(isPatch ? ACTION_PATCH_FIELDS : ACTION_INSERT_FIELDS);
  for (const k of Object.keys(body)) {
    if (!allowed.has(k)) {
      const err: any = new Error(`unknown_field:${k}`);
      err.status = 400;
      err.code = "unknown_field";
      throw err;
    }
  }
  if ("horizon" in body && !inEnum(TRANSITION_HORIZONS, body.horizon)) {
    throw enumError("invalid_horizon");
  }
  if ("status" in body && !inEnum(TRANSITION_ACTION_STATUSES, body.status)) {
    throw enumError("invalid_status");
  }
  if ("recordType" in body && !inEnum(TRANSITION_RECORD_TYPES, body.recordType)) {
    throw enumError("invalid_record_type");
  }
  if (
    "confidentiality" in body &&
    !inEnum(TRANSITION_CONFIDENTIALITY_LEVELS, body.confidentiality)
  ) {
    throw enumError("invalid_confidentiality");
  }
  if (!isPatch) {
    if (typeof body.title !== "string" || body.title.trim() === "") {
      throw enumError("invalid_title");
    }
  }
}

function enumError(code: string) {
  const err: any = new Error(code);
  err.status = 400;
  err.code = code;
  return err;
}

export function createTransitionAction(body: any) {
  validateActionFields(body, false);
  const now = nowMs();
  const info = rawSqlite
    .prepare(
      `INSERT INTO transition_actions
        (horizon, area, title, detail, status, due_at, record_type,
         confidentiality, source_url, source_label, seed_key, sort_order,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    )
    .run(
      body.horizon ?? "2w",
      body.area ?? "general",
      body.title,
      body.detail ?? null,
      body.status ?? "Open",
      body.dueAt ?? null,
      body.recordType ?? "recommendation",
      body.confidentiality ?? "private",
      body.sourceUrl ?? null,
      body.sourceLabel ?? null,
      body.sortOrder ?? 0,
      now,
      now,
    );
  return getTransitionAction(Number(info.lastInsertRowid));
}

export function getTransitionAction(id: number) {
  const r = rawSqlite
    .prepare("SELECT * FROM transition_actions WHERE id = ?")
    .get(id) as any;
  return r ? normalizeActionRow(r) : null;
}

export function patchTransitionAction(id: number, body: any) {
  validateActionFields(body, true);
  const existing = getTransitionAction(id);
  if (!existing) return null;

  const now = nowMs();
  const sets: string[] = [];
  const params: any[] = [];
  const map: Record<string, string> = {
    horizon: "horizon",
    area: "area",
    title: "title",
    detail: "detail",
    status: "status",
    dueAt: "due_at",
    recordType: "record_type",
    confidentiality: "confidentiality",
    sourceUrl: "source_url",
    sourceLabel: "source_label",
    sortOrder: "sort_order",
  };
  for (const [k, col] of Object.entries(map)) {
    if (k in body) {
      sets.push(`${col} = ?`);
      params.push(body[k]);
    }
  }
  if ("status" in body) {
    if (body.status === "Complete" && !existing.completedAt) {
      sets.push("completed_at = ?");
      params.push(now);
    } else if (body.status !== "Complete" && existing.completedAt) {
      sets.push("completed_at = NULL");
    }
  }
  sets.push("updated_at = ?");
  params.push(now);
  params.push(id);
  rawSqlite
    .prepare(`UPDATE transition_actions SET ${sets.join(", ")} WHERE id = ?`)
    .run(...params);
  return getTransitionAction(id);
}

export function deleteTransitionAction(id: number) {
  return rawSqlite
    .prepare("DELETE FROM transition_actions WHERE id = ?")
    .run(id).changes > 0;
}

// ---------- ledger ----------

const LEDGER_INSERT_FIELDS = [
  "recordType",
  "category",
  "title",
  "body",
  "eventDate",
  "sourceKind",
  "sourceUrl",
  "sourceLabel",
  "perspective",
  "confidentiality",
] as const;

function normalizeLedgerRow(r: any) {
  return {
    id: r.id,
    recordType: r.record_type,
    category: r.category,
    title: r.title,
    body: r.body,
    eventDate: r.event_date,
    sourceKind: r.source_kind,
    sourceUrl: r.source_url,
    sourceLabel: r.source_label,
    perspective: r.perspective,
    confidentiality: r.confidentiality,
    seedKey: r.seed_key,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listTransitionLedger(filters: {
  recordType?: string;
  category?: string;
  perspective?: string;
  confidentiality?: string;
}) {
  const where: string[] = [];
  const params: any[] = [];
  if (filters.recordType) {
    where.push("record_type = ?");
    params.push(filters.recordType);
  }
  if (filters.category) {
    where.push("category = ?");
    params.push(filters.category);
  }
  if (filters.perspective) {
    where.push("perspective = ?");
    params.push(filters.perspective);
  }
  if (filters.confidentiality) {
    where.push("confidentiality = ?");
    params.push(filters.confidentiality);
  }
  const sql = `SELECT * FROM transition_ledger ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC, id DESC`;
  return (rawSqlite.prepare(sql).all(...params) as any[]).map(normalizeLedgerRow);
}

function validateLedger(body: any, isPatch: boolean) {
  const allowed = new Set<string>(LEDGER_INSERT_FIELDS);
  for (const k of Object.keys(body)) {
    if (!allowed.has(k)) throw enumError(`unknown_field:${k}`);
  }
  if (
    ("recordType" in body || !isPatch) &&
    !inEnum(TRANSITION_RECORD_TYPES, body.recordType ?? (isPatch ? undefined : ""))
  ) {
    if (!isPatch || "recordType" in body) throw enumError("invalid_record_type");
  }
  if (
    "confidentiality" in body &&
    !inEnum(TRANSITION_CONFIDENTIALITY_LEVELS, body.confidentiality)
  ) {
    throw enumError("invalid_confidentiality");
  }
  if ("perspective" in body && !inEnum(TRANSITION_LEDGER_PERSPECTIVES, body.perspective)) {
    throw enumError("invalid_perspective");
  }
  if ("sourceKind" in body && body.sourceKind !== null && !inEnum(TRANSITION_SOURCE_KINDS, body.sourceKind)) {
    throw enumError("invalid_source_kind");
  }
  if (!isPatch) {
    if (typeof body.body !== "string" || body.body.trim() === "") {
      throw enumError("invalid_body");
    }
    // Documented facts must carry a source.
    if (
      body.recordType === "documented_fact" &&
      !body.sourceUrl &&
      !body.sourceLabel &&
      !body.sourceKind
    ) {
      throw enumError("documented_fact_requires_source");
    }
  }
}

export function createTransitionLedgerEntry(body: any) {
  validateLedger(body, false);
  const now = nowMs();
  const info = rawSqlite
    .prepare(
      `INSERT INTO transition_ledger
        (record_type, category, title, body, event_date, source_kind,
         source_url, source_label, perspective, confidentiality, seed_key,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    )
    .run(
      body.recordType,
      body.category ?? null,
      body.title ?? null,
      body.body,
      body.eventDate ?? null,
      body.sourceKind ?? null,
      body.sourceUrl ?? null,
      body.sourceLabel ?? null,
      body.perspective ?? "me",
      body.confidentiality ?? "private",
      now,
      now,
    );
  return getTransitionLedgerEntry(Number(info.lastInsertRowid));
}

export function getTransitionLedgerEntry(id: number) {
  const r = rawSqlite
    .prepare("SELECT * FROM transition_ledger WHERE id = ?")
    .get(id) as any;
  return r ? normalizeLedgerRow(r) : null;
}

export function patchTransitionLedgerEntry(id: number, body: any) {
  validateLedger(body, true);
  const now = nowMs();
  const sets: string[] = [];
  const params: any[] = [];
  const map: Record<string, string> = {
    recordType: "record_type",
    category: "category",
    title: "title",
    body: "body",
    eventDate: "event_date",
    sourceKind: "source_kind",
    sourceUrl: "source_url",
    sourceLabel: "source_label",
    perspective: "perspective",
    confidentiality: "confidentiality",
  };
  for (const [k, col] of Object.entries(map)) {
    if (k in body) {
      sets.push(`${col} = ?`);
      params.push(body[k]);
    }
  }
  if (sets.length === 0) return getTransitionLedgerEntry(id);
  sets.push("updated_at = ?");
  params.push(now);
  params.push(id);
  rawSqlite
    .prepare(`UPDATE transition_ledger SET ${sets.join(", ")} WHERE id = ?`)
    .run(...params);
  return getTransitionLedgerEntry(id);
}

export function deleteTransitionLedgerEntry(id: number) {
  return rawSqlite
    .prepare("DELETE FROM transition_ledger WHERE id = ?")
    .run(id).changes > 0;
}

// ---------- financial ----------

const FIN_INSERT_FIELDS = [
  "category",
  "description",
  "amountAudCents",
  "direction",
  "eventDate",
  "evidenceStatus",
  "sourceUrl",
  "sourceLabel",
  "notes",
  "recordType",
  "confidentiality",
] as const;

function normalizeFinRow(r: any) {
  return {
    id: r.id,
    category: r.category,
    description: r.description,
    amountAudCents: r.amount_aud_cents,
    direction: r.direction,
    eventDate: r.event_date,
    evidenceStatus: r.evidence_status,
    sourceUrl: r.source_url,
    sourceLabel: r.source_label,
    notes: r.notes,
    recordType: r.record_type,
    confidentiality: r.confidentiality,
    seedKey: r.seed_key,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listTransitionFinancial(filters: { category?: string; direction?: string }) {
  const where: string[] = [];
  const params: any[] = [];
  if (filters.category) {
    where.push("category = ?");
    params.push(filters.category);
  }
  if (filters.direction) {
    where.push("direction = ?");
    params.push(filters.direction);
  }
  const sql = `SELECT * FROM transition_financial_items ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY event_date, id`;
  return (rawSqlite.prepare(sql).all(...params) as any[]).map(normalizeFinRow);
}

function validateFin(body: any, isPatch: boolean) {
  const allowed = new Set<string>(FIN_INSERT_FIELDS);
  for (const k of Object.keys(body)) {
    if (!allowed.has(k)) throw enumError(`unknown_field:${k}`);
  }
  if ("category" in body && !inEnum(TRANSITION_FIN_CATEGORIES, body.category)) {
    throw enumError("invalid_category");
  }
  if ("direction" in body && !inEnum(TRANSITION_FIN_DIRECTIONS, body.direction)) {
    throw enumError("invalid_direction");
  }
  if (
    "evidenceStatus" in body &&
    !inEnum(TRANSITION_FIN_EVIDENCE_STATUSES, body.evidenceStatus)
  ) {
    throw enumError("invalid_evidence_status");
  }
  if ("recordType" in body && !inEnum(TRANSITION_RECORD_TYPES, body.recordType)) {
    throw enumError("invalid_record_type");
  }
  if (
    "confidentiality" in body &&
    !inEnum(TRANSITION_CONFIDENTIALITY_LEVELS, body.confidentiality)
  ) {
    throw enumError("invalid_confidentiality");
  }
  if ("amountAudCents" in body && body.amountAudCents !== null) {
    if (typeof body.amountAudCents !== "number" || !Number.isFinite(body.amountAudCents)) {
      throw enumError("invalid_amount");
    }
  }
  if (!isPatch) {
    if (typeof body.description !== "string" || body.description.trim() === "") {
      throw enumError("invalid_description");
    }
  }
}

export function createTransitionFinancial(body: any) {
  validateFin(body, false);
  const now = nowMs();
  const info = rawSqlite
    .prepare(
      `INSERT INTO transition_financial_items
        (category, description, amount_aud_cents, direction, event_date,
         evidence_status, source_url, source_label, notes, record_type,
         confidentiality, seed_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    )
    .run(
      body.category ?? "other",
      body.description,
      body.amountAudCents ?? null,
      body.direction ?? "unknown",
      body.eventDate ?? null,
      body.evidenceStatus ?? "partial",
      body.sourceUrl ?? null,
      body.sourceLabel ?? null,
      body.notes ?? null,
      body.recordType ?? "documented_fact",
      body.confidentiality ?? "private",
      now,
      now,
    );
  return getTransitionFinancial(Number(info.lastInsertRowid));
}

export function getTransitionFinancial(id: number) {
  const r = rawSqlite
    .prepare("SELECT * FROM transition_financial_items WHERE id = ?")
    .get(id) as any;
  return r ? normalizeFinRow(r) : null;
}

export function patchTransitionFinancial(id: number, body: any) {
  validateFin(body, true);
  const now = nowMs();
  const sets: string[] = [];
  const params: any[] = [];
  const map: Record<string, string> = {
    category: "category",
    description: "description",
    amountAudCents: "amount_aud_cents",
    direction: "direction",
    eventDate: "event_date",
    evidenceStatus: "evidence_status",
    sourceUrl: "source_url",
    sourceLabel: "source_label",
    notes: "notes",
    recordType: "record_type",
    confidentiality: "confidentiality",
  };
  for (const [k, col] of Object.entries(map)) {
    if (k in body) {
      sets.push(`${col} = ?`);
      params.push(body[k]);
    }
  }
  if (sets.length === 0) return getTransitionFinancial(id);
  sets.push("updated_at = ?");
  params.push(now);
  params.push(id);
  rawSqlite
    .prepare(`UPDATE transition_financial_items SET ${sets.join(", ")} WHERE id = ?`)
    .run(...params);
  return getTransitionFinancial(id);
}

export function deleteTransitionFinancial(id: number) {
  return rawSqlite
    .prepare("DELETE FROM transition_financial_items WHERE id = ?")
    .run(id).changes > 0;
}

// ---------- IT handover ----------

const IT_INSERT_FIELDS = [
  "system",
  "accountContext",
  "accessStatus",
  "handoverStatus",
  "sensitivity",
  "notes",
  "nextAction",
  "dueAt",
  "recordType",
  "confidentiality",
] as const;

function normalizeItRow(r: any) {
  return {
    id: r.id,
    system: r.system,
    accountContext: r.account_context,
    accessStatus: r.access_status,
    handoverStatus: r.handover_status,
    sensitivity: r.sensitivity,
    notes: r.notes,
    nextAction: r.next_action,
    dueAt: r.due_at,
    recordType: r.record_type,
    confidentiality: r.confidentiality,
    seedKey: r.seed_key,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listTransitionIt() {
  return (
    rawSqlite
      .prepare("SELECT * FROM transition_it_handover ORDER BY sensitivity DESC, system, id")
      .all() as any[]
  ).map(normalizeItRow);
}

function validateIt(body: any, isPatch: boolean) {
  const allowed = new Set<string>(IT_INSERT_FIELDS);
  for (const k of Object.keys(body)) {
    if (!allowed.has(k)) throw enumError(`unknown_field:${k}`);
  }
  if ("accessStatus" in body && !inEnum(TRANSITION_IT_ACCESS_STATUSES, body.accessStatus)) {
    throw enumError("invalid_access_status");
  }
  if (
    "handoverStatus" in body &&
    !inEnum(TRANSITION_IT_HANDOVER_STATUSES, body.handoverStatus)
  ) {
    throw enumError("invalid_handover_status");
  }
  if ("sensitivity" in body && !inEnum(TRANSITION_IT_SENSITIVITY, body.sensitivity)) {
    throw enumError("invalid_sensitivity");
  }
  if ("recordType" in body && !inEnum(TRANSITION_RECORD_TYPES, body.recordType)) {
    throw enumError("invalid_record_type");
  }
  if (
    "confidentiality" in body &&
    !inEnum(TRANSITION_CONFIDENTIALITY_LEVELS, body.confidentiality)
  ) {
    throw enumError("invalid_confidentiality");
  }
  // Never store raw credentials.
  if ("notes" in body) assertNoCredentials(body.notes, "notes");
  if ("nextAction" in body) assertNoCredentials(body.nextAction, "next_action");
  if (!isPatch) {
    if (typeof body.system !== "string" || body.system.trim() === "") {
      throw enumError("invalid_system");
    }
  }
}

export function createTransitionIt(body: any) {
  validateIt(body, false);
  const now = nowMs();
  const info = rawSqlite
    .prepare(
      `INSERT INTO transition_it_handover
        (system, account_context, access_status, handover_status, sensitivity,
         notes, next_action, due_at, record_type, confidentiality, seed_key,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    )
    .run(
      body.system,
      body.accountContext ?? null,
      body.accessStatus ?? "unknown",
      body.handoverStatus ?? "not_started",
      body.sensitivity ?? "standard",
      body.notes ?? null,
      body.nextAction ?? null,
      body.dueAt ?? null,
      body.recordType ?? "recommendation",
      body.confidentiality ?? "private",
      now,
      now,
    );
  return getTransitionIt(Number(info.lastInsertRowid));
}

export function getTransitionIt(id: number) {
  const r = rawSqlite
    .prepare("SELECT * FROM transition_it_handover WHERE id = ?")
    .get(id) as any;
  return r ? normalizeItRow(r) : null;
}

export function patchTransitionIt(id: number, body: any) {
  validateIt(body, true);
  const now = nowMs();
  const sets: string[] = [];
  const params: any[] = [];
  const map: Record<string, string> = {
    system: "system",
    accountContext: "account_context",
    accessStatus: "access_status",
    handoverStatus: "handover_status",
    sensitivity: "sensitivity",
    notes: "notes",
    nextAction: "next_action",
    dueAt: "due_at",
    recordType: "record_type",
    confidentiality: "confidentiality",
  };
  for (const [k, col] of Object.entries(map)) {
    if (k in body) {
      sets.push(`${col} = ?`);
      params.push(body[k]);
    }
  }
  if (sets.length === 0) return getTransitionIt(id);
  sets.push("updated_at = ?");
  params.push(now);
  params.push(id);
  rawSqlite
    .prepare(`UPDATE transition_it_handover SET ${sets.join(", ")} WHERE id = ?`)
    .run(...params);
  return getTransitionIt(id);
}

export function deleteTransitionIt(id: number) {
  return rawSqlite
    .prepare("DELETE FROM transition_it_handover WHERE id = ?")
    .run(id).changes > 0;
}

// ---------- summary ----------

export function getTransitionSummary() {
  const counts = rawSqlite
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM transition_actions WHERE status IN ('Open','Active')) AS open_actions,
        (SELECT COUNT(*) FROM transition_actions WHERE status = 'Complete') AS complete_actions,
        (SELECT COUNT(*) FROM transition_ledger) AS ledger_entries,
        (SELECT COUNT(*) FROM transition_ledger WHERE record_type='documented_fact') AS documented_facts,
        (SELECT COUNT(*) FROM transition_ledger WHERE record_type='open_question') AS open_questions,
        (SELECT COUNT(*) FROM transition_financial_items) AS financial_items,
        (SELECT COUNT(*) FROM transition_financial_items WHERE evidence_status='documented') AS financial_documented,
        (SELECT COUNT(*) FROM transition_it_handover) AS it_items,
        (SELECT COUNT(*) FROM transition_it_handover WHERE handover_status='complete') AS it_complete
      `,
    )
    .get() as Record<string, number>;
  return {
    state: getTransitionState(),
    counts,
  };
}

// ---------- export bundles ----------

const AUDIENCE_HEADER: Record<TransitionExportAudience, string> = {
  lawyer:
    "Legal-audience bundle. Documented facts and self-report items only, financial + communication categories. Do not distribute.",
  therapist:
    "Therapist-audience bundle. Includes historical summary, self-report, and open questions. Do not distribute.",
  mediator:
    "Mediator-audience bundle. Documented facts and open questions only; inference and emotional language stripped. Do not distribute.",
  child_comm:
    "Child-communication bundle. Only recommendations flagged for mediator-level confidentiality plus agreed-wording items. Populated by Oliver; starts empty. Never a substitute for professional guidance.",
  redacted_chronology:
    "Redacted chronology. Event dates and neutral categories only; body redacted to first 12 words.",
};

function truncateBody(body: string, n: number): string {
  const words = body.split(/\s+/);
  if (words.length <= n) return body;
  return words.slice(0, n).join(" ") + " \u2026";
}

export function buildTransitionExport(audience: TransitionExportAudience) {
  if (!inEnum(TRANSITION_EXPORT_AUDIENCES, audience)) {
    throw enumError("invalid_audience");
  }
  const state = getTransitionState();
  const allLedger = rawSqlite.prepare("SELECT * FROM transition_ledger").all() as any[];
  const allFin = rawSqlite
    .prepare("SELECT * FROM transition_financial_items")
    .all() as any[];
  const allIt = rawSqlite.prepare("SELECT * FROM transition_it_handover").all() as any[];

  // First filter: never emit 'private' records.
  const publicLedger = allLedger.filter((r) => r.confidentiality !== "private");
  const publicFin = allFin.filter((r) => r.confidentiality !== "private");
  const publicIt = allIt.filter((r) => r.confidentiality !== "private");

  let selectedLedger: any[] = [];
  let selectedFin: any[] = [];
  let selectedIt: any[] = [];

  const suppressedPrivate =
    (allLedger.length - publicLedger.length) +
    (allFin.length - publicFin.length) +
    (allIt.length - publicIt.length);

  switch (audience) {
    case "lawyer":
      selectedLedger = publicLedger.filter(
        (r) =>
          ["documented_fact", "self_report", "open_question"].includes(r.record_type) &&
          ["financial", "communication", "child_related", "legal_step"].includes(r.category ?? ""),
      );
      selectedFin = publicFin;
      selectedIt = publicIt;
      break;
    case "therapist":
      selectedLedger = publicLedger.filter((r) =>
        ["self_report", "historical_summary", "open_question", "reported_other_statement"].includes(
          r.record_type,
        ),
      );
      selectedFin = []; // therapist bundle strips financial amounts
      selectedIt = [];
      break;
    case "mediator":
      selectedLedger = publicLedger.filter((r) =>
        ["documented_fact", "open_question"].includes(r.record_type),
      );
      selectedFin = publicFin.filter((r) => r.evidence_status === "documented");
      selectedIt = publicIt;
      break;
    case "child_comm":
      selectedLedger = publicLedger.filter(
        (r) => r.record_type === "recommendation" && r.confidentiality === "mediator",
      );
      selectedFin = [];
      selectedIt = [];
      break;
    case "redacted_chronology":
      selectedLedger = publicLedger.map((r) => ({
        ...r,
        body: truncateBody(r.body ?? "", 12),
      }));
      selectedFin = publicFin.map((r) => ({
        ...r,
        description: truncateBody(r.description ?? "", 6),
        amount_aud_cents: null,
      }));
      selectedIt = [];
      break;
  }

  const totalIncluded = selectedLedger.length + selectedFin.length + selectedIt.length;

  const lines: string[] = [];
  lines.push(`# Buoy Relationship Transition module \u2014 ${audience} bundle`);
  lines.push(`Generated ${new Date().toISOString()}`);
  lines.push(`This is an internal, read-only export. Not a message to any party.`);
  lines.push(`Records included: ${totalIncluded} \u00b7 Records suppressed as private: ${suppressedPrivate}`);
  lines.push("");
  lines.push(AUDIENCE_HEADER[audience]);
  lines.push("");
  if (state) {
    lines.push(`## Phase\n\n${state.phase}\n`);
    if (state.decisionStatement) {
      lines.push(`## Decision statement\n\n${state.decisionStatement}\n`);
    }
  }
  if (selectedLedger.length) {
    lines.push(`## Ledger (${selectedLedger.length})`);
    for (const r of selectedLedger) {
      lines.push(
        `\n- **[${r.record_type}]** ${r.title ?? ""} \u2014 (${r.category ?? "-"}, ${r.perspective ?? "-"})`,
      );
      if (r.event_date) lines.push(`  - date: ${r.event_date}`);
      lines.push(`  - ${r.body}`);
      if (r.source_label || r.source_url) {
        lines.push(`  - source: ${r.source_label ?? ""} ${r.source_url ?? ""}`.trim());
      }
    }
    lines.push("");
  }
  if (selectedFin.length) {
    lines.push(`## Financial reconciliation (${selectedFin.length})`);
    for (const r of selectedFin) {
      const amount =
        r.amount_aud_cents == null
          ? "n/a"
          : `AUD ${(r.amount_aud_cents / 100).toFixed(2)}`;
      lines.push(
        `- [${r.category}] ${r.description} \u2014 ${amount} (${r.direction}, evidence: ${r.evidence_status})`,
      );
    }
    lines.push("");
  }
  if (selectedIt.length) {
    lines.push(`## IT handover (${selectedIt.length})`);
    for (const r of selectedIt) {
      lines.push(
        `- ${r.system} \u2014 access: ${r.access_status}, handover: ${r.handover_status}${
          r.sensitivity === "sensitive" ? " (sensitive)" : ""
        }`,
      );
    }
    lines.push("");
  }
  const markdown = lines.join("\n");
  return {
    audience,
    markdown,
    json: {
      generatedAt: new Date().toISOString(),
      state,
      ledger: selectedLedger.map(normalizeLedgerRow),
      financial: selectedFin.map(normalizeFinRow),
      itHandover: selectedIt.map(normalizeItRow),
      counts: {
        totalIncluded,
        suppressedPrivate,
      },
    },
  };
}
