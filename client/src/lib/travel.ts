// Feature 1 — Travel time client helpers.

export interface TravelMatchPayload {
  matchedLocation: {
    id: number;
    name: string;
    keywords: string;
    nominalMinutes: number;
    allowMinutes: number;
    destinationAddress: string | null;
    notes: string | null;
  } | null;
  matchedKeyword: string | null;
  nominalMinutes: number | null;
  allowMinutes: number | null;
  outboundMapsUrl: string | null;
  returnMapsUrl: string | null;
  override: {
    eventUid: string;
    nominalMinutesOverride: number | null;
    allowMinutesOverride: number | null;
    locationIdOverride: number | null;
  } | null;
}

export interface TravelTodayItem extends TravelMatchPayload {
  event: {
    uid: string;
    summary: string;
    start: string;
    end: string;
    location?: string;
    allDay: boolean;
  };
}

/**
 * "Leave by HH:MM" string in Australia/Melbourne, given event start ISO and
 * an allow-minutes value. Returns null if any input is missing.
 */
export function leaveByLabel(eventStartIso: string, allowMinutes: number | null): string | null {
  if (allowMinutes == null) return null;
  try {
    const start = new Date(eventStartIso);
    if (isNaN(start.getTime())) return null;
    const leaveBy = new Date(start.getTime() - allowMinutes * 60_000);
    return new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Melbourne",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(leaveBy);
  } catch {
    return null;
  }
}

/** Build a Maps URL on the client side as a fallback (server already builds these). */
export function buildGoogleMapsUrl(origin: string, destination: string): string {
  const params = new URLSearchParams({
    api: "1",
    origin,
    destination,
    travelmode: "driving",
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
