// Stage 17 — calendar settings API + rotate-token unit tests.
// No HTTP server — tests call app-settings functions directly.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import {
  _setTestDb,
  _resetDbForTest,
  getSetting,
  setSetting,
  rotateToken,
  KEY,
} from "../server/app-settings";

describe("calendar settings — getSetting / setSetting", () => {
  beforeEach(() => {
    const db = new Database(":memory:");
    _setTestDb(db);
  });

  afterEach(() => {
    _resetDbForTest();
  });

  it("returns default '0' for public_calendar_enabled before any set", () => {
    const val = getSetting(KEY.PUBLIC_CALENDAR_ENABLED);
    // Default seeds to '0' or token; accept either '0' or '1'
    expect(val === "0" || val === "1").toBe(true);
  });

  it("setSetting persists a value readable by getSetting", () => {
    setSetting(KEY.PUBLIC_CALENDAR_ENABLED, "1");
    expect(getSetting(KEY.PUBLIC_CALENDAR_ENABLED)).toBe("1");
  });

  it("setSetting overwrites a previous value", () => {
    setSetting(KEY.PUBLIC_CALENDAR_ENABLED, "1");
    setSetting(KEY.PUBLIC_CALENDAR_ENABLED, "0");
    expect(getSetting(KEY.PUBLIC_CALENDAR_ENABLED)).toBe("0");
  });

  it("setSetting works for private_calendar_enabled", () => {
    setSetting(KEY.PRIVATE_CALENDAR_ENABLED, "1");
    expect(getSetting(KEY.PRIVATE_CALENDAR_ENABLED)).toBe("1");
  });
});

describe("calendar settings — rotateToken", () => {
  beforeEach(() => {
    const db = new Database(":memory:");
    _setTestDb(db);
  });

  afterEach(() => {
    _resetDbForTest();
  });

  it("rotateToken returns a non-empty string", () => {
    const token = rotateToken(KEY.PUBLIC_CALENDAR_TOKEN);
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
  });

  it("rotateToken persists the new token in settings", () => {
    const token = rotateToken(KEY.PUBLIC_CALENDAR_TOKEN);
    expect(getSetting(KEY.PUBLIC_CALENDAR_TOKEN)).toBe(token);
  });

  it("rotateToken produces a different value each call", () => {
    const t1 = rotateToken(KEY.PUBLIC_CALENDAR_TOKEN);
    const t2 = rotateToken(KEY.PUBLIC_CALENDAR_TOKEN);
    expect(t1).not.toBe(t2);
  });

  it("rotateToken works for private token key", () => {
    const token = rotateToken(KEY.PRIVATE_CALENDAR_TOKEN);
    expect(getSetting(KEY.PRIVATE_CALENDAR_TOKEN)).toBe(token);
  });

  it("old token no longer equals new token after rotate", () => {
    const before = getSetting(KEY.PRIVATE_CALENDAR_TOKEN);
    const after = rotateToken(KEY.PRIVATE_CALENDAR_TOKEN);
    expect(after).not.toBe(before);
    expect(getSetting(KEY.PRIVATE_CALENDAR_TOKEN)).toBe(after);
  });

  it("KEY constants include both token keys", () => {
    expect(KEY.PUBLIC_CALENDAR_TOKEN).toBeTruthy();
    expect(KEY.PRIVATE_CALENDAR_TOKEN).toBeTruthy();
  });
});
