// filepath: test/stage26a-updates.test.ts
// Stage 26a — project change feed + Time-Task Management nav section.

import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ProjectEventStore, diffProjectEvents } from "../server/project-events";
import { ALLOWED_LANDING_ROUTES } from "../server/app-settings";

function mkStore(now = 1_800_000_000_000) {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT);
           CREATE TABLE project_tasks (id INTEGER PRIMARY KEY, project_id INTEGER, title TEXT, completed INTEGER);
           INSERT INTO projects VALUES (1, 'Buoy app development'), (2, 'Other');`);
  let t = now;
  const store = new ProjectEventStore(db, () => t);
  return { db, store, tick: (ms: number) => { t += ms; } };
}

describe("diffProjectEvents", () => {
  it("records status, priority, focus and rename once each", () => {
    const ev = diffProjectEvents(
      { name: "A", pmtStatus: "Active", priority: "low", focusOfWeekAt: null },
      { name: "B", pmtStatus: "Parked", priority: "high", focusOfWeekAt: 123 },
    );
    expect(ev.map((e) => e.kind)).toEqual(["status", "priority", "focus", "renamed"]);
    expect(ev[0].summary).toBe("Status: Active → Parked");
    expect(ev[1].summary).toBe("Priority: Low → High");
    expect(ev[2].summary).toBe("Set as focus of the week");
  });
  it("no change -> no events; legacy status equivalent to pmtStatus is not a change", () => {
    expect(diffProjectEvents({ status: "active", priority: "high" }, { status: "active", priority: "high" })).toEqual([]);
    expect(diffProjectEvents({ status: "active", pmtStatus: "Active" }, { status: "active", pmtStatus: "Active" })).toEqual([]);
    expect(diffProjectEvents(undefined, { status: "active" })).toEqual([]);
  });
  it("focus cleared", () => {
    expect(diffProjectEvents({ focusOfWeekAt: 5 }, { focusOfWeekAt: null })[0].summary).toBe("Focus of the week cleared");
  });
});

describe("ProjectEventStore", () => {
  it("lists newest first with project names, filters by project/kind/window", () => {
    const s = mkStore();
    s.store.record(1, "note", "Note: first");
    s.tick(1000);
    s.store.record(2, "status", "Status: Active → Parked");
    s.tick(1000);
    s.store.record(1, "task_done", "Task done: X");
    const all = s.store.list({ sinceMs: 0 });
    expect(all.map((e) => e.kind)).toEqual(["task_done", "status", "note"]);
    expect(all[0].projectName).toBe("Buoy app development");
    expect(s.store.list({ sinceMs: 0, projectId: 2 }).map((e) => e.projectId)).toEqual([2]);
    expect(s.store.list({ sinceMs: 0, kind: "note" })).toHaveLength(1);
    expect(s.store.list({ sinceMs: 1_800_000_001_500 })).toHaveLength(1);
    expect(s.store.countSince(1_800_000_000_500)).toBe(2);
  });
  it("recordDiff writes one row per change, none for no change", () => {
    const s = mkStore();
    s.store.recordDiff(1, { pmtStatus: "Active" }, { pmtStatus: "Complete" });
    s.store.recordDiff(1, { pmtStatus: "Active" }, { pmtStatus: "Active" });
    expect(s.store.list({ sinceMs: 0 })).toHaveLength(1);
  });
  it("record never throws, even on a broken DB", () => {
    const s = mkStore();
    s.db.exec("DROP TABLE project_events");
    expect(() => s.store.record(1, "note", "x")).not.toThrow();
  });
  it("getProjectTask reads completion state", () => {
    const s = mkStore();
    s.db.exec("INSERT INTO project_tasks VALUES (9, 1, 'Ship 26a', 0)");
    expect(s.store.getProjectTask(9)).toEqual({ projectId: 1, title: "Ship 26a", completed: 0 });
    expect(s.store.getProjectTask(99)).toBeNull();
  });
});

describe("Time-Task Management nav", () => {
  const LAYOUT = readFileSync(path.resolve(__dirname, "../client/src/components/Layout.tsx"), "utf8");
  const APP = readFileSync(path.resolve(__dirname, "../client/src/App.tsx"), "utf8");
  const body = LAYOUT.match(/export\s+const\s+NAV:\s*NavItem\[\]\s*=\s*\[([\s\S]*?)\];/)![1];
  const rows = body.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("{"));
  it("groups the seven pages under the heading, in order", () => {
    const h = rows.findIndex((r) => r.includes('heading: "Time-Task Management"'));
    expect(h).toBeGreaterThan(0);
    const next = rows.slice(h + 1, h + 8).map((r) => r.match(/href:\s*"([^"]+)"/)?.[1]);
    expect(next).toEqual(["/on-time", "/tasks", "/email-status", "/pmt", "/projects", "/updates", "/habits"]);
  });
  it("NAV_ROUTES excludes headings and the /updates route is registered", () => {
    expect(LAYOUT).toMatch(/NAV\.filter\(\(item\)[^]*"href" in item/);
    expect(APP).toMatch(/<Route path="\/updates" component=\{Updates\} \/>/);
  });
  it("every Time-Task Management page is an allowed landing route", () => {
    for (const h of ["/on-time", "/tasks", "/email-status", "/pmt", "/projects", "/updates", "/habits"]) {
      expect(ALLOWED_LANDING_ROUTES).toContain(h);
    }
  });
});
