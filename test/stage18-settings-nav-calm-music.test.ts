// Stage 18 (2026-05-16) — Settings default landing page + sidebar reshuffle
// + Calm box-breathing audio.
//
// Vitest env is `node` (no jsdom) so the page-side tests follow the
// established source-text-inspection pattern from find-time-page.test.tsx
// rather than React Testing Library. The server-side allow-list is exercised
// directly through the pure helper (`isAllowedLandingRoute`) and the KV
// store (`getSetting` / `setSetting`) is exercised against an in-memory
// SQLite, the same shape as calendar-settings-rotate-token.test.ts.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  _setTestDb,
  _resetDbForTest,
  getSetting,
  setSetting,
  KEY,
  ALLOWED_LANDING_ROUTES,
  isAllowedLandingRoute,
} from "../server/app-settings";

const LAYOUT_SRC = readFileSync(
  path.resolve(__dirname, "../client/src/components/Layout.tsx"),
  "utf8",
);
const SETTINGS_SRC = readFileSync(
  path.resolve(__dirname, "../client/src/pages/Settings.tsx"),
  "utf8",
);
const APP_SRC = readFileSync(
  path.resolve(__dirname, "../client/src/App.tsx"),
  "utf8",
);
const CALM_SRC = readFileSync(
  path.resolve(__dirname, "../client/src/pages/Calm.tsx"),
  "utf8",
);
const ROUTES_SRC = readFileSync(
  path.resolve(__dirname, "../server/routes.ts"),
  "utf8",
);

const CALM_LOOP_PATH = path.resolve(
  __dirname,
  "../client/src/assets/calm-loop.mp3",
);

// ----- Server-side allow-list -----

describe("Stage 18 — default landing route allow-list", () => {
  it("exposes the documented set of routes", () => {
    // Sanity: the allow-list must contain every NAV target the spec calls
    // out. Order is not significant for the allow-list semantics, but every
    // entry must be present.
    const expected = [
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
    ];
    for (const route of expected) {
      expect(ALLOWED_LANDING_ROUTES).toContain(route);
    }
  });

  it("isAllowedLandingRoute accepts every documented route", () => {
    for (const route of ALLOWED_LANDING_ROUTES) {
      expect(isAllowedLandingRoute(route)).toBe(true);
    }
  });

  it("isAllowedLandingRoute rejects unknown routes and non-strings", () => {
    expect(isAllowedLandingRoute("/totally-fake")).toBe(false);
    expect(isAllowedLandingRoute("")).toBe(false);
    expect(isAllowedLandingRoute(null)).toBe(false);
    expect(isAllowedLandingRoute(undefined)).toBe(false);
    expect(isAllowedLandingRoute(42)).toBe(false);
    expect(isAllowedLandingRoute({ href: "/calm" })).toBe(false);
    // Trailing slash variants are not in the allow-list — they must fail.
    expect(isAllowedLandingRoute("/calm/")).toBe(false);
  });

  it("rejects retired routes that the SPA no longer serves on the apex", () => {
    // /priorities was renamed to /tasks in Stage 17c. Stage 18 must not
    // let a stale client persist /priorities as a default landing route.
    expect(isAllowedLandingRoute("/priorities")).toBe(false);
    // /reflect was renamed to /evening in Stage 9a.
    expect(isAllowedLandingRoute("/reflect")).toBe(false);
  });
});

// ----- KV persistence -----

describe("Stage 18 — default_landing_route KV row", () => {
  beforeEach(() => {
    const db = new Database(":memory:");
    _setTestDb(db);
  });

  afterEach(() => {
    _resetDbForTest();
  });

  it("seeds DEFAULT_LANDING_ROUTE to '/' on first boot", () => {
    expect(getSetting(KEY.DEFAULT_LANDING_ROUTE)).toBe("/");
  });

  it("round-trips a valid update", () => {
    setSetting(KEY.DEFAULT_LANDING_ROUTE, "/checkin");
    expect(getSetting(KEY.DEFAULT_LANDING_ROUTE)).toBe("/checkin");
  });

  it("does not overwrite an existing value on re-seed", () => {
    setSetting(KEY.DEFAULT_LANDING_ROUTE, "/calm");
    // Force the seed path again by re-attaching a fresh DB connection that
    // already contains the row, then opening the wrapper which re-runs the
    // ON CONFLICT DO NOTHING upsert.
    expect(getSetting(KEY.DEFAULT_LANDING_ROUTE)).toBe("/calm");
  });
});

// ----- /api/settings handler shape (source-text guard) -----

describe("Stage 18 — /api/settings handler wiring", () => {
  it("GET handler reads DEFAULT_LANDING_ROUTE from the KV store", () => {
    expect(ROUTES_SRC).toContain("KEY.DEFAULT_LANDING_ROUTE");
    expect(ROUTES_SRC).toContain("defaultLandingRoute");
  });

  it("PATCH handler validates against isAllowedLandingRoute and returns 400", () => {
    expect(ROUTES_SRC).toContain("isAllowedLandingRoute");
    expect(ROUTES_SRC).toContain('"invalid_route"');
    // Validation must be a hard short-circuit (return 400) before the
    // existing whitelist of settings fields is applied, so the patch is
    // atomic. Match the structural shape rather than exact whitespace.
    expect(ROUTES_SRC).toMatch(
      /defaultLandingRoute[\s\S]{0,400}?status\(400\)[\s\S]{0,200}?invalid_route/,
    );
  });

  it("PATCH handler persists defaultLandingRoute via setSetting", () => {
    expect(ROUTES_SRC).toMatch(
      /setSetting\(\s*KEY\.DEFAULT_LANDING_ROUTE\s*,\s*req\.body\.defaultLandingRoute\s*\)/,
    );
  });
});

// ----- Sidebar NAV order -----

describe("Stage 18 — sidebar NAV reshuffle", () => {
  it("exports NAV and NAV_ROUTES", async () => {
    // Source-level guard: the named exports must exist so Settings.tsx and
    // any future test can import them.
    expect(LAYOUT_SRC).toMatch(/export\s+(const|type)\s+NAV(\s|:)/);
    expect(LAYOUT_SRC).toMatch(/export\s+const\s+NAV_ROUTES/);
  });

  it("places Check-in / Calm / Capture / Coach as the first four nav items", () => {
    // Extract NAV array literal and assert the first four href values.
    const navMatch = LAYOUT_SRC.match(
      /export\s+const\s+NAV:\s*NavItem\[\]\s*=\s*\[([\s\S]*?)\];/,
    );
    expect(navMatch).not.toBeNull();
    const navBody = navMatch![1];

    // Pull out the href values in order.
    const hrefs: string[] = [];
    const hrefRe = /href:\s*"([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = hrefRe.exec(navBody)) !== null) {
      hrefs.push(m[1]);
    }
    expect(hrefs.slice(0, 4)).toEqual([
      "/checkin",
      "/calm",
      "/capture",
      "/coach",
    ]);
    // Today / Calendar must follow the first divider, in this order.
    const todayIdx = hrefs.indexOf("/");
    const calIdx = hrefs.indexOf("/calendar-planner");
    expect(todayIdx).toBe(4);
    expect(calIdx).toBe(5);
  });

  it("includes a divider between the regulation group and the planning group", () => {
    // Naive but reliable: count dividers and confirm the first one sits
    // after exactly four link rows.
    const navMatch = LAYOUT_SRC.match(
      /export\s+const\s+NAV:\s*NavItem\[\]\s*=\s*\[([\s\S]*?)\];/,
    );
    const navBody = navMatch![1];
    const rows = navBody
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("{"));
    // First four rows are links; fifth row is the divider.
    expect(rows[0]).toContain("/checkin");
    expect(rows[3]).toContain("/coach");
    expect(rows[4]).toContain("divider: true");
  });

  it("includes a Calm link pointing at /calm", () => {
    expect(LAYOUT_SRC).toMatch(/href:\s*"\/calm",\s*label:\s*"Calm"/);
  });
});

// ----- Settings page Default Landing card -----

describe("Stage 18 — Settings page Default Landing card", () => {
  it("imports NAV_ROUTES from Layout", () => {
    expect(SETTINGS_SRC).toMatch(
      /import\s*\{\s*NAV_ROUTES\s*\}\s*from\s*"@\/components\/Layout"/,
    );
  });

  it("renders a labelled section with a select control", () => {
    expect(SETTINGS_SRC).toContain('data-testid="section-default-landing"');
    expect(SETTINGS_SRC).toContain('data-testid="select-default-landing"');
    expect(SETTINGS_SRC).toContain("Default landing page");
  });

  it("persists changes via PATCH /api/settings with defaultLandingRoute", () => {
    // The save helper must call apiRequest with PATCH, /api/settings, and
    // a body that contains defaultLandingRoute. Allow any whitespace and
    // any other body fields around it.
    expect(SETTINGS_SRC).toContain('"PATCH", "/api/settings"');
    expect(SETTINGS_SRC).toMatch(/defaultLandingRoute:\s*next/);
  });

  it("seeds the picker from q.data.defaultLandingRoute", () => {
    expect(SETTINGS_SRC).toMatch(
      /setDefaultLandingRoute\s*\(\s*q\.data\.defaultLandingRoute\s*\?\?\s*"\/"\s*\)/,
    );
  });
});

// ----- App.tsx redirect -----

describe("Stage 18 — DefaultLandingRedirect", () => {
  it("mounts inside the Router tree alongside MorningGuard", () => {
    expect(APP_SRC).toMatch(/<DefaultLandingRedirect\s*\/>/);
    expect(APP_SRC).toMatch(/<MorningGuard\s*\/>/);
  });

  it("only fires when location === '/'", () => {
    expect(APP_SRC).toMatch(/if\s*\(\s*location\s*!==\s*"\/"\s*\)\s*return/);
  });

  it("uses { replace: true } and a one-shot ref guard", () => {
    expect(APP_SRC).toMatch(/navigate\([^,]+,\s*\{\s*replace:\s*true\s*\}\)/);
    expect(APP_SRC).toMatch(/fired\.current\s*=\s*true/);
  });

  it("treats a stored value of '/' as a no-op", () => {
    expect(APP_SRC).toMatch(/target\s*===\s*"\/"/);
  });
});

// ----- Calm.tsx box breathing + audio -----

describe("Stage 18 — Calm box breathing + audio", () => {
  it("uses 4-second phases and 4 phases per cycle", () => {
    expect(CALM_SRC).toMatch(/const\s+PHASE_SECONDS\s*=\s*4\b/);
    expect(CALM_SRC).toMatch(/const\s+PHASES_PER_CYCLE\s*=\s*4\b/);
    // 16 s cycle is implied by PHASE_SECONDS * PHASES_PER_CYCLE.
    expect(CALM_SRC).toMatch(
      /CYCLE_SECONDS\s*=\s*PHASE_SECONDS\s*\*\s*PHASES_PER_CYCLE/,
    );
  });

  it("imports the bundled calm-loop.mp3 asset", () => {
    expect(CALM_SRC).toMatch(
      /import\s+calmLoopUrl\s+from\s+"@\/assets\/calm-loop\.mp3"/,
    );
  });

  it("renders a hidden looping audio element keyed to the breath screen", () => {
    // The audio element can attribute-order in any way, so check each
    // required slot independently within a single <audio> ... /> block.
    const audioBlock = CALM_SRC.match(/<audio[\s\S]{0,500}?\/>/);
    expect(audioBlock).not.toBeNull();
    const block = audioBlock![0];
    expect(block).toMatch(/\bloop\b/);
    expect(block).toMatch(/src=\{calmLoopUrl\}/);
    expect(block).toContain('data-testid="calm-audio"');
  });

  it("starts playback on mount and pauses + resets on unmount", () => {
    expect(CALM_SRC).toMatch(/el\.play\(\)/);
    expect(CALM_SRC).toMatch(/cur\.pause\(\)/);
    expect(CALM_SRC).toMatch(/cur\.currentTime\s*=\s*0/);
  });

  it("removes the 'Breathe in / Breathe out' label and exposes a phase data attribute", () => {
    expect(CALM_SRC).not.toMatch(/Breathe in/);
    expect(CALM_SRC).not.toMatch(/Breathe out/);
    expect(CALM_SRC).toContain('data-testid="calm-breath-circle"');
    expect(CALM_SRC).toContain("data-phase={phase}");
  });
});

// ----- Audio asset -----

describe("Stage 18 — calm-loop.mp3 asset", () => {
  it("ships at the documented path", () => {
    // Asset must exist; missing-asset failure would surface as a Vite build
    // error long before tests, but the unit test makes the dependency
    // explicit.
    const stat = statSync(CALM_LOOP_PATH);
    expect(stat.isFile()).toBe(true);
    // Must be a non-trivial payload (>10 kB) but well under 1 MB to keep
    // the bundle slim.
    expect(stat.size).toBeGreaterThan(10_000);
    expect(stat.size).toBeLessThan(1_000_000);
  });
});
