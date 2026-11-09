import { describe, it, expect } from "vitest";
import { parseIcs, expandRecurringEvents } from "../server/ics";
import { classifySharedOwner, isInfoOnlyOwner, normaliseFeedUrl, busyOnly, sharedFeedSpec } from "../server/shared-calendar";

const ICS = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "UID:fortnight-allday",
  "DTSTART;VALUE=DATE:20260928",
  "DTEND;VALUE=DATE:20261005",
  "RRULE:FREQ=WEEKLY;UNTIL=20261130;INTERVAL=2;BYDAY=MO",
  "SUMMARY:D: Kids week",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:weekly-timed",
  "DTSTART;TZID=Australia/Melbourne:20260929T183000",
  "DTEND;TZID=Australia/Melbourne:20260929T200000",
  "RRULE:FREQ=WEEKLY;COUNT=4",
  "EXDATE;TZID=Australia/Melbourne:20261013T183000",
  "SUMMARY:O: Choir",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:single",
  "DTSTART;TZID=Australia/Melbourne:20261113T190000",
  "DTEND;TZID=Australia/Melbourne:20261113T220000",
  "SUMMARY:D&O: Theatre",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const FROM = Date.UTC(2026, 0, 1);
const TO = Date.UTC(2027, 11, 31);

describe("Stage 28 shared calendar — owner prefixes", () => {
  it("classifies D:, O:, D&O: and variants", () => {
    expect(classifySharedOwner("O: ICS conference")).toBe("oliver");
    expect(classifySharedOwner("O; Europe")).toBe("oliver");
    expect(classifySharedOwner("D&O: Hamilton")).toBe("both");
    expect(classifySharedOwner("D & O: Dinner")).toBe("both");
    expect(classifySharedOwner("D: NZ")).toBe("daisy");
    expect(classifySharedOwner("D to Carl Cox")).toBe("daisy");
    expect(classifySharedOwner("Dinner at Goldie's")).toBe("unprefixed");
    expect(classifySharedOwner("Daisy's bday")).toBe("unprefixed");
    expect(classifySharedOwner("Ollie dinner")).toBe("unprefixed");
  });
  it("marks only Daisy and unprefixed events info-only", () => {
    expect(isInfoOnlyOwner("oliver")).toBe(false);
    expect(isInfoOnlyOwner("both")).toBe(false);
    expect(isInfoOnlyOwner("daisy")).toBe(true);
    expect(isInfoOnlyOwner("unprefixed")).toBe(true);
    expect(busyOnly([{ infoOnly: true }, { infoOnly: false }, {}])).toHaveLength(2);
  });
  it("normalises webcal:// to https://", () => {
    expect(normaliseFeedUrl("webcal://p1.icloud.com/published/2/x")).toBe("https://p1.icloud.com/published/2/x");
    expect(normaliseFeedUrl("")).toBe("");
    expect(sharedFeedSpec("webcal://a/b").url).toBe("https://a/b");
  });
});

describe("Stage 28 shared calendar — recurrence expansion", () => {
  const parsed = parseIcs(ICS);
  const expanded = expandRecurringEvents(parsed, FROM, TO);

  it("expands fortnightly all-day series up to UNTIL", () => {
    const kids = expanded.filter((e) => e.summary === "D: Kids week");
    // 28 Sep, 12 Oct, 26 Oct, 9 Nov, 23 Nov
    expect(kids).toHaveLength(5);
    expect(kids.every((e) => e.allDay)).toBe(true);
    expect(new Set(kids.map((e) => e.uid)).size).toBe(5);
    const d = new Date(kids[1].start);
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 10, 12]);
    const dur = (Date.parse(kids[1].end) - Date.parse(kids[1].start)) / 86400000;
    expect(Math.round(dur)).toBe(7);
  });

  it("honours COUNT and EXDATE and keeps Melbourne wall-clock across DST", () => {
    const choir = expanded.filter((e) => e.summary === "O: Choir");
    expect(choir).toHaveLength(3); // 4 generated, 13 Oct excluded
    const fmt = (iso: string) => new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Melbourne", hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(iso));
    // 29 Sep is AEST (+10), 6 Oct onwards AEDT (+11): wall clock stays 18:30.
    expect(choir.map((e) => fmt(e.start))).toEqual(["18:30", "18:30", "18:30"]);
    expect(choir[0].start).toBe("2026-09-29T08:30:00.000Z");
    expect(choir[1].start).toBe("2026-10-06T07:30:00.000Z");
  });

  it("leaves non-recurring events untouched", () => {
    expect(expanded.filter((e) => e.uid === "single")).toHaveLength(1);
  });

  it("falls back to the base event for unsupported rules", () => {
    const odd = parseIcs([
      "BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:odd",
      "DTSTART;TZID=Australia/Melbourne:20261101T090000",
      "DTEND;TZID=Australia/Melbourne:20261101T100000",
      "RRULE:FREQ=MONTHLY;BYDAY=1SU", "SUMMARY:O: Odd", "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n"));
    expect(expandRecurringEvents(odd, FROM, TO)).toHaveLength(1);
  });

  it("drops RECURRENCE-ID overridden occurrences from the series", () => {
    const ov = parseIcs([
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT", "UID:s1", "DTSTART;TZID=Australia/Melbourne:20261102T090000",
      "DTEND;TZID=Australia/Melbourne:20261102T100000", "RRULE:FREQ=DAILY;COUNT=3", "SUMMARY:O: Run", "END:VEVENT",
      "BEGIN:VEVENT", "UID:s1", "RECURRENCE-ID;TZID=Australia/Melbourne:20261103T090000",
      "DTSTART;TZID=Australia/Melbourne:20261103T120000",
      "DTEND;TZID=Australia/Melbourne:20261103T130000", "SUMMARY:O: Run (moved)", "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n"));
    const out = expandRecurringEvents(ov, FROM, TO);
    expect(out).toHaveLength(3);
    expect(out.filter((e) => e.summary === "O: Run (moved)")).toHaveLength(1);
  });
});
