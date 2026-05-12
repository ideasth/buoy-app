// Stage 17 — family auth tests.
// Tests checkFamilyAuth with various credential types.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { _setTestDb, _resetDbForTest } from "../server/app-settings";
import { checkFamilyAuth } from "../server/family-auth";
import { classifyHost } from "../server/hostname-router";

describe("family auth — checkFamilyAuth", () => {
  let settingsDb: Database.Database;

  beforeEach(async () => {
    settingsDb = new Database(":memory:");
    _setTestDb(settingsDb);

    const hash = await bcrypt.hash("correctpass", 10);
    settingsDb.prepare(`INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)`).run("family_calendar_enabled", "1");
    settingsDb.prepare(`INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)`).run("family_calendar_user", "family");
    settingsDb.prepare(`INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)`).run("family_calendar_password_hash", hash);
    settingsDb.prepare(`INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)`).run("family_calendar_token", "valid-family-token");
  });

  afterEach(() => _resetDbForTest());

  it("returns null for missing auth", () => {
    const req = { query: {}, cookies: {}, header: () => "" } as any;
    expect(checkFamilyAuth(req)).toBeNull();
  });

  it("returns token for correct token URL param", () => {
    const req = { query: { t: "valid-family-token" }, cookies: {}, header: () => "" } as any;
    expect(checkFamilyAuth(req)).toBe("token");
  });

  it("returns null for wrong token URL param", () => {
    const req = { query: { t: "wrong-token" }, cookies: {}, header: () => "" } as any;
    expect(checkFamilyAuth(req)).toBeNull();
  });

  // Regression — Stage 17 hotfix. Calendar clients can't reliably carry the
  // token in ?t= (some strip query strings on subscribe URLs) and never carry
  // cookies. Token-in-path /cal/<TOKEN>.ics must authenticate without query
  // string or cookie.
  it("returns token for correct token in /cal/<TOKEN>.ics path", () => {
    const req = {
      query: {},
      cookies: {},
      path: "/cal/valid-family-token.ics",
      header: () => "",
    } as any;
    expect(checkFamilyAuth(req)).toBe("token");
  });

  it("returns null for wrong token in /cal/<TOKEN>.ics path", () => {
    const req = {
      query: {},
      cookies: {},
      path: "/cal/bogus-token.ics",
      header: () => "",
    } as any;
    expect(checkFamilyAuth(req)).toBeNull();
  });

  it("does NOT extract token from non-/cal/ paths", () => {
    // The regex is anchored to /cal/ so other paths with similar shape
    // must not authenticate.
    const req = {
      query: {},
      cookies: {},
      path: "/other/valid-family-token.ics",
      header: () => "",
    } as any;
    expect(checkFamilyAuth(req)).toBeNull();
  });

  it("does NOT match /cal/<TOKEN>.ics with extra path segments", () => {
    const req = {
      query: {},
      cookies: {},
      path: "/cal/sub/valid-family-token.ics",
      header: () => "",
    } as any;
    expect(checkFamilyAuth(req)).toBeNull();
  });

  it("returns password for correct Basic auth", () => {
    const creds = Buffer.from("family:correctpass").toString("base64");
    const req = {
      query: {},
      cookies: {},
      header: (n: string) => n.toLowerCase() === "authorization" ? `Basic ${creds}` : "",
    } as any;
    expect(checkFamilyAuth(req)).toBe("password");
  });

  it("returns null for wrong Basic auth password", () => {
    const creds = Buffer.from("family:wrongpass").toString("base64");
    const req = {
      query: {},
      cookies: {},
      header: (n: string) => n.toLowerCase() === "authorization" ? `Basic ${creds}` : "",
    } as any;
    expect(checkFamilyAuth(req)).toBeNull();
  });

  it("returns null for wrong username in Basic auth", () => {
    const creds = Buffer.from("notfamily:correctpass").toString("base64");
    const req = {
      query: {},
      cookies: {},
      header: (n: string) => n.toLowerCase() === "authorization" ? `Basic ${creds}` : "",
    } as any;
    expect(checkFamilyAuth(req)).toBeNull();
  });
});

describe("family auth — family cannot access apex routes", () => {
  it("family hostname classified as family, not apex", () => {
    // The apex session cookie scope is different from the family cookie scope.
    // Family auth (Basic or token cookie) only works on buoy-family.thinhalo.com.
    // The classifyHost() function returns "family" for the family hostname,
    // and the apex routes middleware checks for "apex" classification —
    // so a family-hostname request with a family cookie can never reach apex routes.
    expect(classifyHost("buoy-family.thinhalo.com")).toBe("family");
    expect(classifyHost("buoy-family.thinhalo.com")).not.toBe("apex");
  });
});
