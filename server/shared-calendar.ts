// Stage 28 — Daisy & Oliver shared iCloud calendar ("D&O").
//
// Title prefixes say whose event it is:
//   "O:"   Oliver's event      -> busy, gets leave-by cues
//   "D&O:" shared event        -> busy, gets leave-by cues
//   "D:"   Daisy's event       -> information only (not busy, no cues)
//   none   unprefixed / shared -> information only
// Variants seen in the live feed ("O;", "D to Carl Cox") are handled.
//
// The feed URL lives in settings.shared_ics_url (set via PATCH /api/settings)
// and is never committed. webcal:// is normalised to https://.

export type SharedOwner = "oliver" | "both" | "daisy" | "unprefixed";

export function classifySharedOwner(summary: string): SharedOwner {
  const s = (summary || "").trim();
  if (/^D\s*(&|and|\+)\s*O\s*[:;-]/i.test(s)) return "both";
  if (/^O\s*[:;-]/i.test(s)) return "oliver";
  if (/^D\s*[:;-]/i.test(s)) return "daisy";
  if (/^D\s+to\b/i.test(s)) return "daisy";
  return "unprefixed";
}

export function isInfoOnlyOwner(owner: SharedOwner): boolean {
  return owner === "daisy" || owner === "unprefixed";
}

export function normaliseFeedUrl(url: string | undefined | null): string {
  const u = String(url ?? "").trim();
  if (!u) return "";
  return u.replace(/^webcal:\/\//i, "https://");
}

// Feed spec for getCachedEventsForFeeds.
export function sharedFeedSpec(url: string | undefined | null) {
  return {
    url: normaliseFeedUrl(url),
    forceSource: "external" as const,
    expandRecurrence: true,
    sharedOwnerPrefixes: true,
  };
}

// Drop information-only events (Daisy's and unprefixed shared events) before
// anything that treats events as busy time.
export function busyOnly<T extends { infoOnly?: boolean }>(events: T[]): T[] {
  return events.filter((e) => !e.infoOnly);
}
