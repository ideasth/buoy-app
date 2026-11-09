// filepath: server/project-events.ts
// Stage 26a — project change feed. Append-only log of notable project changes,
// written by the existing project routes at the moment a change succeeds.
// Read-only via GET /api/updates. Recording never throws: a logging failure
// must not break the user's edit.

import type DatabaseT from "better-sqlite3";

export type ProjectEventKind =
  | "created"
  | "status"
  | "priority"
  | "focus"
  | "renamed"
  | "note"
  | "phase"
  | "component"
  | "task_done"
  | "capture";

export const PROJECT_EVENT_KINDS: readonly ProjectEventKind[] = [
  "created", "status", "priority", "focus", "renamed", "note", "phase", "component", "task_done", "capture",
];

export interface ProjectEvent {
  id: number;
  projectId: number;
  projectName: string | null;
  at: number;
  kind: ProjectEventKind;
  summary: string;
  detail: Record<string, unknown> | null;
}

/** Fields of a project row that the diff looks at. */
export interface ProjectSnapshot {
  name?: string | null;
  status?: string | null;
  pmtStatus?: string | null;
  priority?: string | null;
  focusOfWeekAt?: number | null;
}

const STATUS_LABEL: Record<string, string> = {
  active: "Active", parked: "Parked", complete: "Complete", completed: "Complete", done: "Complete",
};
const label = (s: string | null | undefined) => (s ? STATUS_LABEL[s.toLowerCase()] ?? s : "none");
const PRIORITY_LABEL: Record<string, string> = { high: "High", low: "Low" };
const plabel = (s: string | null | undefined) => (s ? PRIORITY_LABEL[s.toLowerCase()] ?? s : "none");

/** Pure: which events does a before -> after project change produce? */
export function diffProjectEvents(
  before: ProjectSnapshot | undefined | null,
  after: ProjectSnapshot | undefined | null,
): Array<{ kind: ProjectEventKind; summary: string; detail: Record<string, unknown> }> {
  if (!before || !after) return [];
  const out: Array<{ kind: ProjectEventKind; summary: string; detail: Record<string, unknown> }> = [];
  const bs = before.pmtStatus ?? before.status ?? null;
  const as = after.pmtStatus ?? after.status ?? null;
  if (label(bs) !== label(as)) {
    out.push({ kind: "status", summary: `Status: ${label(bs)} → ${label(as)}`, detail: { from: bs, to: as } });
  }
  if ((before.priority ?? null) !== (after.priority ?? null)) {
    out.push({
      kind: "priority", summary: `Priority: ${plabel(before.priority)} → ${plabel(after.priority)}`,
      detail: { from: before.priority ?? null, to: after.priority ?? null },
    });
  }
  const bf = before.focusOfWeekAt != null;
  const af = after.focusOfWeekAt != null;
  if (bf !== af) {
    out.push({ kind: "focus", summary: af ? "Set as focus of the week" : "Focus of the week cleared", detail: { focus: af } });
  }
  if ((before.name ?? "") !== (after.name ?? "") && after.name) {
    out.push({ kind: "renamed", summary: `Renamed from "${before.name ?? ""}"`, detail: { from: before.name ?? null, to: after.name } });
  }
  return out;
}

export class ProjectEventStore {
  constructor(private db: DatabaseT.Database, private clock: () => number = Date.now) {
    this.db.exec(`
CREATE TABLE IF NOT EXISTS project_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  detail_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_project_events_at ON project_events(at);
CREATE INDEX IF NOT EXISTS idx_project_events_project_at ON project_events(project_id, at);
`);
  }

  record(projectId: number, kind: ProjectEventKind, summary: string, detail?: Record<string, unknown> | null): void {
    try {
      if (!Number.isFinite(projectId)) return;
      this.db.prepare(
        `INSERT INTO project_events (project_id, at, kind, summary, detail_json) VALUES (?, ?, ?, ?, ?)`,
      ).run(projectId, this.clock(), kind, summary.slice(0, 300), detail ? JSON.stringify(detail) : null);
    } catch (e) {
      console.warn("[project-events] record failed:", (e as Error).message);
    }
  }

  recordDiff(projectId: number, before: ProjectSnapshot | undefined | null, after: ProjectSnapshot | undefined | null): void {
    for (const ev of diffProjectEvents(before, after)) this.record(projectId, ev.kind, ev.summary, ev.detail);
  }

  /** Project task row lookup used to detect a completion transition. */
  getProjectTask(id: number): { projectId: number; title: string; completed: number } | null {
    try {
      const r = this.db.prepare(`SELECT project_id AS projectId, title, completed FROM project_tasks WHERE id = ?`).get(id) as
        | { projectId: number; title: string; completed: number }
        | undefined;
      return r ?? null;
    } catch {
      return null;
    }
  }

  list(opts: { sinceMs: number; projectId?: number | null; kind?: string | null; limit?: number }): ProjectEvent[] {
    const where = ["e.at >= ?"];
    const args: unknown[] = [opts.sinceMs];
    if (opts.projectId != null) { where.push("e.project_id = ?"); args.push(opts.projectId); }
    if (opts.kind) { where.push("e.kind = ?"); args.push(opts.kind); }
    args.push(Math.min(Math.max(opts.limit ?? 500, 1), 2000));
    const rows = this.db.prepare(
      `SELECT e.id, e.project_id AS projectId, p.name AS projectName, e.at, e.kind, e.summary, e.detail_json AS detailJson
         FROM project_events e LEFT JOIN projects p ON p.id = e.project_id
        WHERE ${where.join(" AND ")}
        ORDER BY e.at DESC, e.id DESC
        LIMIT ?`,
    ).all(...args) as Array<Omit<ProjectEvent, "detail"> & { detailJson: string | null }>;
    return rows.map(({ detailJson, ...r }) => {
      let detail: Record<string, unknown> | null = null;
      if (detailJson) { try { detail = JSON.parse(detailJson); } catch { detail = null; } }
      return { ...r, detail };
    });
  }

  /** Stage 26b — undo of a project capture removes its "capture" event too. */
  deleteCaptureEvent(projectTaskId: number): void {
    try {
      this.db.prepare(`DELETE FROM project_events WHERE kind = 'capture' AND json_extract(detail_json, '$.projectTaskId') = ?`).run(projectTaskId);
    } catch (e) {
      console.warn("[project-events] deleteCaptureEvent failed:", (e as Error).message);
    }
  }

  countSince(sinceMs: number): number {
    const r = this.db.prepare(`SELECT COUNT(*) AS n FROM project_events WHERE at >= ?`).get(sinceMs) as { n: number };
    return r.n;
  }
}
