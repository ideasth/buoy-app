// filepath: client/src/lib/pmtPriority.ts
// Stage 24 — pure helpers for the PMT dashboard priority filter + ordering.
// Kept DB- and React-free so they can be unit-tested directly in the node
// vitest environment.

export type PriorityFilter = "focus-of-week" | "high" | "low" | "all";

export interface PriorityItem {
  focusOfWeekAt?: number | null;
  priority?: string | null;
  pmtStatus?: string | null;
}

// Default filter state on the PMT dashboard: Active PMT status + Focus for Week
// priority (an emphasis/ordering mode, not a hard filter).
export const DEFAULT_PRIORITY_FILTER: PriorityFilter = "focus-of-week";

export const PRIORITY_FILTERS: { value: PriorityFilter; label: string }[] = [
  { value: "focus-of-week", label: "Focus for Week" },
  { value: "high", label: "High" },
  { value: "low", label: "Low" },
  { value: "all", label: "All priorities" },
];

// High/Low/All are hard filters. Focus-for-Week is an emphasis/ordering mode:
// it never hides an item — the ordering (see priorityDisplaySortKey) surfaces
// focus items first instead.
export function matchesPriorityFilter(item: PriorityItem, filter: PriorityFilter): boolean {
  switch (filter) {
    case "high":
      return (item.priority ?? "") === "high";
    case "low":
      return (item.priority ?? "") === "low";
    case "focus-of-week":
    case "all":
    default:
      return true;
  }
}

// Tier: focus-of-week => 0, high => 1, low (everything else) => 2.
export function priorityTier(item: PriorityItem): number {
  if (item.focusOfWeekAt != null) return 0;
  if ((item.priority ?? "") === "high") return 1;
  return 2;
}

export function isParked(item: PriorityItem): boolean {
  return (item.pmtStatus ?? "").toLowerCase() === "parked";
}

// Ordering key for Focus-for-Week emphasis mode: focus first, then high, then
// low; Parked items are pushed below every non-parked item regardless of tier.
export function priorityDisplaySortKey(item: PriorityItem): number {
  return (isParked(item) ? 10 : 0) + priorityTier(item);
}
