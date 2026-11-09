// Stage 17 — availability hostname routing tests.
// Tests availability auth and ICS computation without HTTP server.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { _setTestDb, _resetDbForTest } from "../server/app-settings";
import { _setCalendarBlocksTestDb, _resetCalendarBlocksDbForTest } from "../server/calendar-blocks-storage";
import { checkAvailabilityToken } from "../server/availability-auth";
import { classifyHost } from "../server/hostname-router";
import { computeAvailability, emitPublicIcs } from "../server/public-calendar";

describe("availability hostname classification", () => {
  it("oliver-availability.thinhalo.com is classified as availability", () => {
    expect(classifyHost("oliver-availability.thinhalo.com")).toBe("availability");
  });

  it("buoy.thinhalo.com is NOT classified as availability", () => {
    expect(classifyHost("buoy.thinhalo.com")).not.toBe("availability");
  });

  it("buoy-family.thinhalo.com is NOT classified as availability", () => {
    expect(classifyHost("buoy-family.thinhalo.com")).not.toBe("availability");
  });
});

describe("availability token auth", () => {
  beforeEach(() => {
    const db = new Database(":memory:");
    _setTestDb(db);
    db.prepare(`INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)`).run("public_calendar_enabled", "1");
    db.prepare(`INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)`).run("public_calendar_token", "avail-token-xyz");
  });

  afterEach(() => _resetDbForTest());

  it("returns true for correct token", () => {
    const req = { query: { t: "avail-token-xyz" } } as any;
    expect(checkAvailabilityToken(req)).toBe(true);
  });

  it("returns false for wrong token", () => {
    const req = { query: { t: "wrong-token" } } as any;
    expect(checkAvailabilityToken(req)).toBe(false);
  });

  it("returns false for missing token", () => {
    const req = { query: {} } as any;
    expect(checkAvailabilityToken(req)).toBe(false);
  });
});

describe("availability ICS generation", () => {
  beforeEach(() => {
    const db = new Database(":memory:");
    const fdb = new Database(":memory:");
    _setTestDb(db);
    _setCalendarBlocksTestDb(fdb);
  });

  afterEach(() => {
    _resetDbForTest();
    _resetCalendarBlocksDbForTest();
  });

  it("emits VCALENDAR with correct PRODID", () => {
    const ics = emitPublicIcs([]);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("PRODID:-//Buoy//Public Availability//EN");
    expect(ics).toContain("END:VCALENDAR");
  });

  it("emits Available blocks with correct format", () => {
    const now = new Date("2026-05-31T21:00:00Z").getTime();
    const blocks = computeAvailability({
      calEvents: [],
      blocks: [],
      bookableWindow: {
        mon: ["07:00", "19:00"],
        tue: ["07:00", "19:00"],
        wed: null,
        thu: null,
        fri: null,
        sat: null,
        sun: null,
      },
      now,
      horizonMs: 24 * 60 * 60 * 1000,
    });
    const ics = emitPublicIcs(blocks, "Test Label");
    expect(ics).toContain("X-WR-CALNAME:Test Label");
    if (blocks.length > 0) {
      expect(ics).toContain("Available (");
      expect(ics).toContain("STATUS:CONFIRMED");
    }
  });

  it("/ without token returns 404 (simulated via checkAvailabilityToken)", () => {
    const req = { query: {} } as any;
    const tokenValid = checkAvailabilityToken(req);
    expect(tokenValid).toBe(false);
    // In the actual route, this 404s. The check here verifies auth logic.
  });
});
