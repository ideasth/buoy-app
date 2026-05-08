// Feature 1 — Travel time matching + Maps URL helpers.
//
// Matches a calendar event to a TravelLocation row by case-insensitive
// substring on the event's summary + location + description against each
// location's comma-separated keywords. The longest matched keyword wins
// (so "elgin braybrook" beats "braybrook" if both are in keywords).
//
// Per-event overrides (TravelOverride) apply on top: if an override row
// exists, its non-null fields win over the matched location's defaults.

import type { TravelLocation, TravelOverride } from "@shared/schema";
import type { CalEvent } from "./ics";

export interface TravelMatch {
  matchedLocation: TravelLocation | null;
  matchedKeyword: string | null;
  nominalMinutes: number | null;
  allowMinutes: number | null;
  outboundMapsUrl: string | null;
  returnMapsUrl: string | null;
  override: TravelOverride | null;
}

/** Lowercase haystack from event title + location + description. */
function eventHaystack(ev: CalEvent): string {
  return `${ev.summary ?? ""} ${ev.location ?? ""} ${ev.description ?? ""}`.toLowerCase();
}

/**
 * Find the best-matching travel location by keyword. The longest keyword
 * (most-specific) wins on ties so "elgin carlton" beats "carlton".
 * Returns { location, matchedKeyword } or null if no keyword matches.
 */
export function matchEventToLocation(
  ev: CalEvent,
  locations: TravelLocation[],
): { location: TravelLocation; keyword: string } | null {
  const hay = eventHaystack(ev);
  let best: { location: TravelLocation; keyword: string } | null = null;
  for (const loc of locations) {
    const kws = (loc.keywords ?? "")
      .split(",")
      .map((k) => k.trim().toLowerCase())
      .filter((k) => k.length >= 3);
    for (const kw of kws) {
      if (hay.includes(kw)) {
        if (!best || kw.length > best.keyword.length) {
          best = { location: loc, keyword: kw };
        }
      }
    }
  }
  return best;
}

/** Build a Google Maps directions URL. */
export function buildGoogleMapsUrl(origin: string, destination: string): string {
  const params = new URLSearchParams({
    api: "1",
    origin,
    destination,
    travelmode: "driving",
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/**
 * Resolve travel info for one event. Combines:
 *  - keyword match against locations
 *  - override row (if any)
 *  - home_address from settings (for Maps URLs)
 *
 * Returns a fully-populated TravelMatch with nulls when no match.
 */
export function resolveTravel(opts: {
  event: CalEvent;
  locations: TravelLocation[];
  override: TravelOverride | null;
  homeAddress: string | null;
}): TravelMatch {
  const { event, locations, override, homeAddress } = opts;

  // Determine the active location: prefer override.locationIdOverride if set;
  // otherwise keyword-match.
  let location: TravelLocation | null = null;
  let keyword: string | null = null;

  if (override?.locationIdOverride) {
    location = locations.find((l) => l.id === override.locationIdOverride) ?? null;
  }
  if (!location) {
    const m = matchEventToLocation(event, locations);
    if (m) {
      location = m.location;
      keyword = m.keyword;
    }
  }

  if (!location) {
    return {
      matchedLocation: null,
      matchedKeyword: null,
      nominalMinutes: override?.nominalMinutesOverride ?? null,
      allowMinutes: override?.allowMinutesOverride ?? null,
      outboundMapsUrl: null,
      returnMapsUrl: null,
      override: override ?? null,
    };
  }

  const nominalMinutes = override?.nominalMinutesOverride ?? location.nominalMinutes;
  const allowMinutes = override?.allowMinutesOverride ?? location.allowMinutes;

  // Maps URLs: prefer destination_address on the location, fall back to the
  // event's location field, finally the location name.
  const dest = location.destinationAddress?.trim() || event.location?.trim() || location.name;
  const home = (homeAddress ?? "").trim();
  const outbound = home ? buildGoogleMapsUrl(home, dest) : null;
  const ret = home ? buildGoogleMapsUrl(dest, home) : null;

  return {
    matchedLocation: location,
    matchedKeyword: keyword,
    nominalMinutes,
    allowMinutes,
    outboundMapsUrl: outbound,
    returnMapsUrl: ret,
    override: override ?? null,
  };
}
