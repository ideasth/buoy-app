// Stage 17 — app_settings: a simple key-value store for structured config
// rows that don't belong in the JSON blob inside the `settings` table.
//
// The table is created inline with a CREATE TABLE IF NOT EXISTS so it
// bootstraps on first boot without a separate migration runner.

import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import path from "node:path";
import fs from "node:fs";

// Resolve the database path the same way storage.ts does — "data.db" in the
// CWD.  In tests, DB_PATH can be overridden via environment variable.
function resolveDbPath(): string {
  return process.env.STAGE17_TEST_DB ?? "data.db";
}

let _db: Database.Database | null = null;

export function getAppSettingsDb(): Database.Database {
  if (_db) return _db;
  const dbPath = resolveDbPath();
  _db = new Database(dbPath);
  _db.exec(`
CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);
  // Seed defaults for rows that must always exist.
  seedDefaults(_db);
  return _db;
}

// Allow tests to inject a fresh in-memory instance.
export function _setTestDb(db: Database.Database): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);
  seedDefaults(db);
  _db = db;
}

export function _resetDbForTest(): void {
  _db = null;
}

// Keys used in app_settings.
export const KEY = {
  PUBLIC_CALENDAR_ENABLED: "public_calendar_enabled",
  PUBLIC_CALENDAR_TOKEN: "public_calendar_token",
  PUBLIC_CALENDAR_LABEL: "public_calendar_label",
  PUBLIC_CALENDAR_BOOKABLE_WINDOW_JSON: "public_calendar_bookable_window_json",
  PRIVATE_CALENDAR_ENABLED: "private_calendar_enabled",
  PRIVATE_CALENDAR_USER: "private_calendar_user",
  PRIVATE_CALENDAR_PASSWORD_HASH: "private_calendar_password_hash",
  PRIVATE_CALENDAR_TOKEN: "private_calendar_token",
  FAMILY_CALENDAR_ENABLED: "family_calendar_enabled",
  FAMILY_CALENDAR_USER: "family_calendar_user",
  FAMILY_CALENDAR_PASSWORD_HASH: "family_calendar_password_hash",
  FAMILY_CALENDAR_TOKEN: "family_calendar_token",
  // Stage 18 — user-selected default landing route. Must be one of
  // ALLOWED_LANDING_ROUTES below. Stored as a plain string in the KV table.
  DEFAULT_LANDING_ROUTE: "default_landing_route",
} as const;

// Stage 18 — allow-list for the default landing route. Mirrors the sidebar's
// NAV const in Layout.tsx (dividers excluded). The server validates incoming
// PATCH values against this list so a stale or malicious client cannot poison
// the stored value with a route that the SPA does not handle.
export const ALLOWED_LANDING_ROUTES: readonly string[] = [
  "/",
  "/checkin",
  "/calm",
  "/capture",
  "/coach",
  "/calendar-planner",
  "/morning",
  "/evening",
  "/review",
  "/tasks",
  "/email-status",
  "/projects",
  "/issues",
  "/habits",
  "/admin",
] as const;

export function isAllowedLandingRoute(value: unknown): value is string {
  return typeof value === "string" && ALLOWED_LANDING_ROUTES.includes(value);
}

export type SettingsKey = (typeof KEY)[keyof typeof KEY];

const DEFAULT_BOOKABLE_WINDOW = JSON.stringify({
  mon: ["07:00", "19:00"],
  tue: ["07:00", "19:00"],
  wed: ["07:00", "19:00"],
  thu: ["07:00", "19:00"],
  fri: ["07:00", "19:00"],
  sat: ["08:00", "13:00"],
  sun: null,
});

function seedDefaults(db: Database.Database): void {
  const rows: Array<{ key: string; value: string }> = [
    { key: KEY.PUBLIC_CALENDAR_ENABLED, value: "0" },
    { key: KEY.PUBLIC_CALENDAR_TOKEN, value: randomBytes(32).toString("base64url") },
    { key: KEY.PUBLIC_CALENDAR_LABEL, value: "Author Available (sanitised)" },
    { key: KEY.PUBLIC_CALENDAR_BOOKABLE_WINDOW_JSON, value: DEFAULT_BOOKABLE_WINDOW },
    { key: KEY.PRIVATE_CALENDAR_ENABLED, value: "0" },
    { key: KEY.PRIVATE_CALENDAR_USER, value: "" },
    { key: KEY.PRIVATE_CALENDAR_PASSWORD_HASH, value: "" },
    { key: KEY.PRIVATE_CALENDAR_TOKEN, value: randomBytes(32).toString("base64url") },
    { key: KEY.FAMILY_CALENDAR_ENABLED, value: "0" },
    { key: KEY.FAMILY_CALENDAR_USER, value: "" },
    { key: KEY.FAMILY_CALENDAR_PASSWORD_HASH, value: "" },
    { key: KEY.FAMILY_CALENDAR_TOKEN, value: randomBytes(32).toString("base64url") },
    // Stage 18 — default landing route. "/" maps to Today; existing installs
    // get this seeded on first boot so the server response always carries a
    // value the client can read without a null-coalesce.
    { key: KEY.DEFAULT_LANDING_ROUTE, value: "/" },
  ];
  const upsert = db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING`,
  );
  for (const row of rows) {
    upsert.run(row.key, row.value);
  }
}

export function getSetting(key: string): string | null {
  const db = getAppSettingsDb();
  const row = db.prepare(`SELECT value FROM app_settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  const db = getAppSettingsDb();
  db.prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(
    key,
    value,
  );
}

export function rotateToken(key: string): string {
  const token = randomBytes(32).toString("base64url");
  setSetting(key, token);
  return token;
}
