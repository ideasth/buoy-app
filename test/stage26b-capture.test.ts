// filepath: test/stage26b-capture.test.ts
// Stage 26b — unified capture save rules, check-tag clearing, undo of events.

import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  validateCapture, saveCapture, shapeCapture, shouldClearCheck,
  CHECK_TAG, CHECK_NOTE_PREFIX, type CaptureDeps,
} from "../server/capture";
import { ProjectEventStore } from "../server/project-events";

function mkDeps() {
  const tasks: any[] = [];
  const ptasks: any[] = [];
  const events: any[] = [];
  const deps: CaptureDeps = {
    getProject: (id) => (id === 386 ? { id: 386, name: "Buoy app development" } : undefined),
    createTask: (t) => { const row = { id: tasks.length + 1, ...t }; tasks.push(row); return row; },
    createProjectTask: (t) => { const row = { id: ptasks.length + 1, ...t }; ptasks.push(row); return row; },
    recordEvent: (projectId, summary, detail) => events.push({ projectId, summary, detail }),
    now: () => 1_800_000_000_000,
  };
  return { deps, tasks, ptasks, events };
}
const ok = (body: unknown) => {
  const v = validateCapture(body);
  if (!v.ok) throw new Error(v.error);
  return v.value;
};

describe("validateCapture", () => {
  it("accepts text only", () => {
    expect(ok({ text: "  Ring the plumber  " }).text).toBe("Ring the plumber");
  });
  it("rejects empty, unknown fields, bad url/date/domain/project", () => {
    expect(validateCapture({}).ok).toBe(false);
    expect(validateCapture({ text: "x", evil: 1 })).toMatchObject({ ok: false, status: 400 });
    expect(validateCapture({ text: "x", url: "javascript:alert(1)" }).ok).toBe(false);
    expect(validateCapture({ text: "x", dueDate: "tomorrow" }).ok).toBe(false);
    expect(validateCapture({ text: "x", domain: "spam" }).ok).toBe(false);
    expect(validateCapture({ text: "x", projectId: -2 }).ok).toBe(false);
    expect(validateCapture({ text: "x", estimateMinutes: 9999 }).ok).toBe(false);
  });
  it("returns 413 over 20 KB", () => {
    expect(validateCapture({ text: "a".repeat(21 * 1024) })).toMatchObject({ ok: false, status: 413 });
  });
});

describe("shapeCapture", () => {
  it("first line is the title, the rest plus url go to notes", () => {
    const s = shapeCapture({ ...ok({ text: "Read this\nabout pessaries", url: "https://example.com/a" }) });
    expect(s.title).toBe("Read this");
    expect(s.notes).toBe("about pessaries\n\nhttps://example.com/a");
  });
  it("falls back to shared page title when text is empty", () => {
    expect(shapeCapture(ok({ title: "A page", url: "https://e.com" })).title).toBe("A page");
  });
});

describe("saveCapture", () => {
  it("no project -> general task tagged check, iftime, todo", () => {
    const { deps, tasks, events } = mkDeps();
    const r = saveCapture(deps, ok({ text: "Book dentist" }));
    expect(r).toMatchObject({ ok: true, kind: "task", id: 1 });
    expect(tasks[0]).toMatchObject({ tag: CHECK_TAG, priority: "iftime", status: "todo", estimateMinutes: 30, dueAt: null });
    expect(tasks[0].domain).toBe("health");
    expect(events).toHaveLength(0);
  });
  it("due date becomes 17:00 Melbourne", () => {
    const { deps, tasks } = mkDeps();
    saveCapture(deps, ok({ text: "x", dueDate: "2026-11-10", domain: "work" }));
    expect(new Date(tasks[0].dueAt).toISOString()).toBe("2026-11-10T06:00:00.000Z");
    expect(tasks[0].domain).toBe("work");
  });
  it("project -> unassigned project task with [check] note and a capture event", () => {
    const { deps, ptasks, events } = mkDeps();
    const r = saveCapture(deps, ok({ text: "Add share sheet\nfor Mac too", projectId: 386, dueDate: "2026-11-20" }));
    expect(r).toMatchObject({ ok: true, kind: "project_task", projectId: 386, projectName: "Buoy app development" });
    expect(ptasks[0]).toMatchObject({ projectId: 386, componentId: null, deadline: "2026-11-20", completed: 0 });
    expect(ptasks[0].notes.startsWith(CHECK_NOTE_PREFIX)).toBe(true);
    expect(events[0]).toMatchObject({ projectId: 386, summary: "Captured: Add share sheet", detail: { projectTaskId: 1 } });
  });
  it("unknown project -> 404, nothing written", () => {
    const { deps, tasks, ptasks } = mkDeps();
    expect(saveCapture(deps, ok({ text: "x", projectId: 999 }))).toMatchObject({ ok: false, status: 404 });
    expect(tasks.length + ptasks.length).toBe(0);
  });
});

describe("shouldClearCheck", () => {
  const cur = { tag: "check", title: "A", notes: null, priority: "iftime", status: "todo", dueAt: null, domain: "personal", estimateMinutes: 30 };
  it("clears on real edits, status change or non-iftime priority", () => {
    expect(shouldClearCheck(cur, { title: "B" })).toBe(true);
    expect(shouldClearCheck(cur, { status: "done" })).toBe(true);
    expect(shouldClearCheck(cur, { priority: "deep" })).toBe(true);
    expect(shouldClearCheck(cur, { dueAt: 123 })).toBe(true);
  });
  it("does not clear on no-op patches, iftime priority, explicit tag or non-check tasks", () => {
    expect(shouldClearCheck(cur, { title: "A", status: "todo" })).toBe(false);
    expect(shouldClearCheck(cur, { priority: "iftime" })).toBe(false);
    expect(shouldClearCheck(cur, { tag: "check", title: "B" })).toBe(false);
    expect(shouldClearCheck({ ...cur, tag: "Buoy" }, { title: "B" })).toBe(false);
    expect(shouldClearCheck(undefined, { title: "B" })).toBe(false);
  });
});

describe("undo removes the capture event", () => {
  it("deleteCaptureEvent only removes the matching capture row", () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO projects VALUES (386, 'Buoy');
             CREATE TABLE project_tasks (id INTEGER PRIMARY KEY, project_id INTEGER, title TEXT, completed INTEGER);`);
    const store = new ProjectEventStore(db, () => 1_800_000_000_000);
    store.record(386, "capture", "Captured: a", { projectTaskId: 7 });
    store.record(386, "capture", "Captured: b", { projectTaskId: 8 });
    store.record(386, "note", "Note added", { projectTaskId: 7 });
    store.deleteCaptureEvent(7);
    expect(store.list({ sinceMs: 0 }).map((e: any) => e.summary).sort()).toEqual(["Captured: b", "Note added"]);
  });
});

describe("wiring", () => {
  const read = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf8");
  it("routes expose guarded capture endpoints and clear check on PATCH", () => {
    const r = read("server/routes.ts");
    expect(r).toMatch(/app\.post\("\/api\/capture\/item"[\s\S]{0,80}requireUserOrOrchestrator/);
    expect(r).toMatch(/app\.delete\("\/api\/capture\/item\/:kind\/:id"[\s\S]{0,80}requireUserOrOrchestrator/);
    expect(r).toContain("shouldClearCheck(storage.getTask(id)");
  });
  it("floating button, c shortcut, shared save path, Needs a look chip", () => {
    expect(read("client/src/components/Layout.tsx")).toContain('data-testid="button-capture-fab"');
    expect(read("client/src/components/Layout.tsx")).toMatch(/e\.key === "c"/);
    expect(read("client/src/components/QuickCaptureModal.tsx")).toContain("saveCaptureItem");
    expect(read("client/src/pages/Capture.tsx")).toContain("saveCaptureItem");
    expect(read("client/src/pages/Capture.tsx")).not.toContain('"/api/tasks", payload');
    expect(read("client/src/pages/Priorities.tsx")).toContain('data-testid="filter-needs-a-look"');
  });
});
