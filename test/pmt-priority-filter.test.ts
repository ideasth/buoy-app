// filepath: test/pmt-priority-filter.test.ts
// Stage 24 — PMT dashboard priority filter + ordering helper tests.
// Pure logic (no DB, no React) — imports the helpers directly.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  type PriorityFilter,
  type PriorityItem,
  DEFAULT_PRIORITY_FILTER,
  matchesPriorityFilter,
  priorityTier,
  isParked,
  priorityDisplaySortKey,
} from "../client/src/lib/pmtPriority";

const ROOT = path.resolve(__dirname, "..");

function item(partial: Partial<PriorityItem>): PriorityItem {
  return { focusOfWeekAt: null, priority: "low", pmtStatus: "Active", ...partial };
}

describe("matchesPriorityFilter", () => {
  it("high matches only priority=high", () => {
    expect(matchesPriorityFilter(item({ priority: "high" }), "high")).toBe(true);
    expect(matchesPriorityFilter(item({ priority: "low" }), "high")).toBe(false);
  });

  it("low matches only priority=low", () => {
    expect(matchesPriorityFilter(item({ priority: "low" }), "low")).toBe(true);
    expect(matchesPriorityFilter(item({ priority: "high" }), "low")).toBe(false);
  });

  it("all matches everything", () => {
    expect(matchesPriorityFilter(item({ priority: "high" }), "all")).toBe(true);
    expect(matchesPriorityFilter(item({ priority: "low" }), "all")).toBe(true);
  });

  it("focus-of-week is an emphasis mode — never hides an item", () => {
    // Nothing hidden: focus-of-week returns true regardless of the item.
    expect(matchesPriorityFilter(item({ focusOfWeekAt: 123 }), "focus-of-week")).toBe(true);
    expect(matchesPriorityFilter(item({ focusOfWeekAt: null, priority: "low" }), "focus-of-week")).toBe(true);
    expect(matchesPriorityFilter(item({ priority: "high", pmtStatus: "Parked" }), "focus-of-week")).toBe(true);
  });
});

describe("priorityTier", () => {
  it("focus-of-week => 0, high => 1, low => 2", () => {
    expect(priorityTier(item({ focusOfWeekAt: 999, priority: "low" }))).toBe(0);
    expect(priorityTier(item({ focusOfWeekAt: null, priority: "high" }))).toBe(1);
    expect(priorityTier(item({ focusOfWeekAt: null, priority: "low" }))).toBe(2);
  });

  it("focus flag beats a high priority value", () => {
    expect(priorityTier(item({ focusOfWeekAt: 5, priority: "high" }))).toBe(0);
  });
});

describe("isParked", () => {
  it("true only when pmtStatus is Parked (case-insensitive)", () => {
    expect(isParked(item({ pmtStatus: "Parked" }))).toBe(true);
    expect(isParked(item({ pmtStatus: "parked" }))).toBe(true);
    expect(isParked(item({ pmtStatus: "Active" }))).toBe(false);
  });
});

describe("priorityDisplaySortKey — focus first, then high, then low, parked last", () => {
  it("orders a mixed list focus > high > low > parked", () => {
    const focus = item({ focusOfWeekAt: 1, priority: "low", pmtStatus: "Active" });
    const high = item({ focusOfWeekAt: null, priority: "high", pmtStatus: "Active" });
    const low = item({ focusOfWeekAt: null, priority: "low", pmtStatus: "Active" });
    const parkedHigh = item({ focusOfWeekAt: null, priority: "high", pmtStatus: "Parked" });

    const sorted = [low, parkedHigh, high, focus].sort(
      (a, b) => priorityDisplaySortKey(a) - priorityDisplaySortKey(b),
    );
    expect(sorted).toEqual([focus, high, low, parkedHigh]);
  });

  it("pushes parked below every non-parked item regardless of tier", () => {
    const parkedFocus = item({ focusOfWeekAt: 1, pmtStatus: "Parked" });
    const activeLow = item({ focusOfWeekAt: null, priority: "low", pmtStatus: "Active" });
    expect(priorityDisplaySortKey(parkedFocus)).toBeGreaterThan(priorityDisplaySortKey(activeLow));
  });
});

describe("default filter state", () => {
  it("priority default is focus-of-week", () => {
    const d: PriorityFilter = DEFAULT_PRIORITY_FILTER;
    expect(d).toBe("focus-of-week");
  });

  it("PmtDashboard.tsx defaults PMT status to active and priority to the focus-of-week default", () => {
    const src = readFileSync(path.join(ROOT, "client/src/pages/PmtDashboard.tsx"), "utf-8");
    expect(src).toContain('useState<PmtStatusFilter>("active")');
    expect(src).toContain("useState<PriorityFilter>(DEFAULT_PRIORITY_FILTER)");
    expect(src).toContain('data-testid="select-priority-filter"');
  });
});
