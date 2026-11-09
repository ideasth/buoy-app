// filepath: server/capture.ts
// Stage 26b — shared capture save rules, used by the in-app capture button
// (session auth) and, from Stage 26c, by Share to Buoy (capture token).
//
// No Inbox page (standing rule): a capture lands as a real item.
//   - no project  -> tasks row, tag "check", priority "iftime", status "todo"
//   - project     -> project_tasks row, unassigned, notes start with "[check]"
// The "check" marker is what the morning digest and the Tasks/Priorities
// "Needs a look" chip look for.

import { classifyTask } from "../client/src/lib/anchor";
import { melbToUtcMs } from "./ontime/time";

export const CHECK_TAG = "check";
export const CHECK_NOTE_PREFIX = "[check]";
export const MAX_CAPTURE_BYTES = 20 * 1024;
const DOMAINS = ["family", "work", "medicolegal", "personal", "health"] as const;

export interface CaptureInput {
  text: string;
  url: string | null;
  title: string | null;
  projectId: number | null;
  dueDate: string | null; // YYYY-MM-DD (Melbourne)
  domain: string | null;
  estimateMinutes: number | null;
}

export type CaptureValidation = { ok: true; value: CaptureInput } | { ok: false; status: number; error: string };

const isHttpUrl = (v: string) => {
  try { const u = new URL(v); return u.protocol === "http:" || u.protocol === "https:"; } catch { return false; }
};

export function validateCapture(body: unknown): CaptureValidation {
  const b = (body ?? {}) as Record<string, unknown>;
  const allowed = ["text", "url", "title", "projectId", "dueDate", "domain", "estimateMinutes"];
  for (const k of Object.keys(b)) if (!allowed.includes(k)) return { ok: false, status: 400, error: `unknown_field: ${k}` };
  try {
    if (Buffer.byteLength(JSON.stringify(b), "utf8") > MAX_CAPTURE_BYTES) return { ok: false, status: 413, error: "too_large" };
  } catch { return { ok: false, status: 400, error: "invalid_body" }; }
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const text = str(b.text);
  const url = str(b.url) || null;
  const title = str(b.title) || null;
  if (!text && !url && !title) return { ok: false, status: 400, error: "text required" };
  if (url && !isHttpUrl(url)) return { ok: false, status: 400, error: "invalid_url" };
  let projectId: number | null = null;
  if (b.projectId != null && b.projectId !== "") {
    const n = Number(b.projectId);
    if (!Number.isInteger(n) || n <= 0) return { ok: false, status: 400, error: "invalid_project" };
    projectId = n;
  }
  const dueDate = str(b.dueDate) || null;
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return { ok: false, status: 400, error: "invalid_due_date" };
  const domain = str(b.domain) || null;
  if (domain && !(DOMAINS as readonly string[]).includes(domain)) return { ok: false, status: 400, error: "invalid_domain" };
  let estimateMinutes: number | null = null;
  if (b.estimateMinutes != null && b.estimateMinutes !== "") {
    const n = Number(b.estimateMinutes);
    if (!Number.isInteger(n) || n < 5 || n > 600) return { ok: false, status: 400, error: "invalid_estimate" };
    estimateMinutes = n;
  }
  return { ok: true, value: { text, url, title, projectId, dueDate, domain, estimateMinutes } };
}

/** Title = first line of the text (or the shared page title); the rest goes to notes. */
export function shapeCapture(inp: CaptureInput): { title: string; notes: string } {
  const lines = inp.text.split(/\r?\n/);
  const first = (lines[0] ?? "").trim();
  const rest = lines.slice(1).join("\n").trim();
  const title = (first || inp.title || inp.url || "(capture)").slice(0, 200);
  const extra: string[] = [];
  if (first.length > 200) extra.push(first);
  if (rest) extra.push(rest);
  if (inp.title && inp.title !== title) extra.push(inp.title);
  if (inp.url) extra.push(inp.url);
  return { title, notes: extra.join("\n\n").slice(0, 4000) };
}

export interface CaptureDeps {
  getProject: (id: number) => { id: number; name: string } | undefined;
  createTask: (t: Record<string, unknown>) => { id: number };
  createProjectTask: (t: Record<string, unknown>) => { id: number };
  recordEvent: (projectId: number, summary: string, detail: Record<string, unknown>) => void;
  now?: () => number;
}

export type CaptureResult =
  | { ok: true; kind: "task"; id: number; title: string }
  | { ok: true; kind: "project_task"; id: number; projectId: number; projectName: string; title: string }
  | { ok: false; status: number; error: string };

export function saveCapture(deps: CaptureDeps, inp: CaptureInput): CaptureResult {
  const now = (deps.now ?? Date.now)();
  const { title, notes } = shapeCapture(inp);
  if (inp.projectId != null) {
    const p = deps.getProject(inp.projectId);
    if (!p) return { ok: false, status: 404, error: "project_not_found" };
    const row = deps.createProjectTask({
      projectId: p.id, componentId: null, title,
      notes: notes ? `${CHECK_NOTE_PREFIX} ${notes}` : CHECK_NOTE_PREFIX,
      deadline: inp.dueDate, msTodoTaskId: null, completed: 0, orderIndex: 0, createdAt: now, updatedAt: now,
    });
    deps.recordEvent(p.id, `Captured: ${title.slice(0, 160)}`, { projectTaskId: row.id });
    return { ok: true, kind: "project_task", id: row.id, projectId: p.id, projectName: p.name, title };
  }
  const domain = inp.domain ?? classifyTask(title).domain ?? "personal";
  const row = deps.createTask({
    title, notes: notes || null, domain, priority: "iftime", status: "todo", estimateMinutes: inp.estimateMinutes ?? 30,
    tag: CHECK_TAG, dueAt: inp.dueDate ? melbToUtcMs(inp.dueDate, "17:00") : null,
  });
  return { ok: true, kind: "task", id: row.id, title };
}

/**
 * Should a PATCH to a check-tagged task clear the tag? Yes when the user has
 * actually engaged with it: edited title/notes/due/domain/estimate, changed
 * status, or set a priority other than "iftime". An explicit `tag` in the
 * patch always wins.
 */
export function shouldClearCheck(cur: Record<string, unknown> | undefined, patch: Record<string, unknown>): boolean {
  if (!cur || cur.tag !== CHECK_TAG) return false;
  if ("tag" in patch) return false;
  const changed = (k: string) => k in patch && (patch[k] ?? null) !== (cur[k] ?? null);
  if (["title", "notes", "dueAt", "domain", "estimateMinutes", "status"].some(changed)) return true;
  if (changed("priority") && patch.priority !== "iftime") return true;
  return false;
}

/**
 * Stage 31 — the project-capture equivalent of shouldClearCheck. A project
 * capture's notes start with "[check]". When Oliver engages with it (edits
 * the title, notes or deadline, assigns it to a component, or ticks it
 * done) the marker is stripped. Returns the new notes value to write, or
 * undefined to leave notes alone.
 */
export function stripProjectCheck(cur: Record<string, unknown> | undefined, updates: Record<string, unknown>): string | undefined {
  if (!cur) return undefined;
  const base = "notes" in updates ? updates.notes : cur.notes;
  if (typeof base !== "string" || !base.startsWith(CHECK_NOTE_PREFIX)) return undefined;
  const changed = (k: string) => k in updates && (updates[k] ?? null) !== (cur[k] ?? null);
  const engaged = ["title", "notes", "deadline", "componentId"].some(changed)
    || (changed("completed") && Boolean(updates.completed));
  if (!engaged) return undefined;
  return base.slice(CHECK_NOTE_PREFIX.length).replace(/^\s+/, "");
}

/** Stage 31 — turn a "Needs a look" general task into a project task. */
export interface FileToProjectDeps {
  getTask: (id: number) => Record<string, any> | undefined;
  getProject: (id: number) => { id: number; name: string } | undefined;
  createProjectTask: (t: Record<string, unknown>) => { id: number };
  deleteTask: (id: number) => void;
  recordEvent: (projectId: number, summary: string, detail: Record<string, unknown>) => void;
  now?: () => number;
}

export type FileToProjectResult =
  | { ok: true; projectTaskId: number; projectId: number; projectName: string; title: string }
  | { ok: false; status: number; error: string };

const melbDate = (ms: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));

export function fileTaskToProject(deps: FileToProjectDeps, taskId: number, projectId: unknown): FileToProjectResult {
  const pid = Number(projectId);
  if (!Number.isInteger(pid) || pid <= 0) return { ok: false, status: 400, error: "invalid_project" };
  const task = deps.getTask(taskId);
  if (!task) return { ok: false, status: 404, error: "task_not_found" };
  if (task.status === "done" || task.status === "dropped") return { ok: false, status: 409, error: "task_closed" };
  const p = deps.getProject(pid);
  if (!p) return { ok: false, status: 404, error: "project_not_found" };
  const now = (deps.now ?? Date.now)();
  const title = String(task.title ?? "(capture)").slice(0, 200);
  // Filing it is the "look", so no [check] marker on the project task.
  const row = deps.createProjectTask({
    projectId: p.id, componentId: null, title, notes: String(task.notes ?? ""),
    deadline: typeof task.dueAt === "number" ? melbDate(task.dueAt) : null,
    msTodoTaskId: null, completed: 0, orderIndex: 0, createdAt: now, updatedAt: now,
  });
  deps.recordEvent(p.id, `Filed from Needs a look: ${title.slice(0, 140)}`, { projectTaskId: row.id, fromTaskId: taskId });
  deps.deleteTask(taskId);
  return { ok: true, projectTaskId: row.id, projectId: p.id, projectName: p.name, title };
}
