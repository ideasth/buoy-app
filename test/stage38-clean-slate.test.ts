// filepath: test/stage38-clean-slate.test.ts
// Stage 38 — clean slate: Backlog (parked) status, tighter Morning list, park/unpark plan.
import { describe, expect, it } from "vitest";
import { planPark, selectMorningEligible, isOpenStatus } from "../server/morning-helpers";

const D = 86_400_000;
const dayStart = Date.parse("2026-11-21T00:00:00");
const now = dayStart + 7 * 3600_000;
const t = (id: number, p: Partial<{ status: string; dueAt: number | null; createdAt: number; tag: string | null }> = {}) =>
  ({ id, status: "todo", dueAt: null, createdAt: now - 200 * D, tag: null, ...p });

describe("selectMorningEligible — Stage 38", () => {
  const y = new Set<number>([9]);
  const list = [
    t(1, { dueAt: dayStart - 2 * D }),            // overdue 2 days -> shown
    t(2, { dueAt: dayStart - 30 * D }),           // overdue 30 days -> hidden
    t(3, { dueAt: dayStart + 3 * D }),            // due in 3 days -> shown
    t(4, { dueAt: dayStart + 20 * D }),           // due in 20 days -> hidden
    t(5, { createdAt: now - 3600_000, tag: "Braindump" }), // today's brain dump -> shown
    t(6),                                          // old, no due -> hidden
    t(7, { status: "parked", dueAt: dayStart + D }), // parked -> hidden even if due
    t(8, { status: "done", createdAt: now }),      // done -> hidden
    t(9),                                          // yesterday's Top 3 -> shown
    t(10, { status: "doing", dueAt: dayStart + D }), // doing + due tomorrow -> shown
  ];
  const ids = selectMorningEligible(list, { dayStartTs: dayStart, nowMs: now, yesterdayTopIds: y }).map((x) => x.id);
  it("shows only near-due, new and carry-over tasks, in that order", () => {
    expect(ids).toEqual([1, 10, 3, 5, 9]);
  });
  it("never shows parked tasks", () => expect(ids).not.toContain(7));
  it("treats only todo/doing as open", () => {
    expect(isOpenStatus("todo")).toBe(true); expect(isOpenStatus("doing")).toBe(true);
    expect(isOpenStatus("parked")).toBe(false); expect(isOpenStatus("done")).toBe(false);
  });
});

describe("planPark — Stage 38", () => {
  const before = now - 12 * D;
  const list = [
    t(1),                                          // old -> park
    t(2, { dueAt: now + 3 * D }),                  // old but due in 3 days -> keep
    t(3, { dueAt: now - 2 * D }),                  // old, overdue 2 days -> keep
    t(4, { dueAt: now - 40 * D }),                 // old, long overdue -> park
    t(5, { createdAt: now - 2 * D }),              // new -> untouched
    t(6, { status: "done" }),                      // closed -> untouched
    t(7, { status: "doing" }),                     // old doing -> park
  ];
  const r = planPark(list, { before, nowMs: now, keepDueDays: 7 });
  it("parks old open tasks except those due within 7 days", () => {
    expect(r.park.map((x) => x.id)).toEqual([1, 4, 7]);
    expect(r.keep.map((x) => x.id)).toEqual([2, 3]);
  });
});
