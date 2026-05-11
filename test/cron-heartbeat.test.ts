import { describe, it, expect } from "vitest";
import {
  classifyHeartbeat,
  parseHeartbeatBody,
  buildExpectedWindows,
} from "../server/cron-heartbeat";
import { AEDT_RETUNE_INVENTORY } from "../shared/cron-inventory";

// Test fixtures pick from the surviving Stage 12c inventory:
//   c751741f: "0 20,2,8,14 * * *" — fires daily at 20:00, 02:00, 08:00, 14:00 UTC
//   2928f9fa: "0 8,20 * * *"      — fires daily at 08:00, 20:00 UTC
//   17df3d7e: "54 0,2,4,6,8,10,12,20,22 * * *" — fires every 2h daily
//
// Pick a known Saturday to avoid timezone surprises.
// 2026-05-09 is a Saturday.
const SAT_2026_05_09_20_00_UTC_MS = Date.UTC(2026, 4, 9, 20, 0, 0); // month is 0-indexed
const SAT_2026_05_09_06_00_UTC_MS = Date.UTC(2026, 4, 9, 6, 0, 0);  // off-window for c751741f

describe("buildExpectedWindows", () => {
  it("includes every cron from the AEDT inventory", () => {
    const w = buildExpectedWindows();
    for (const e of AEDT_RETUNE_INVENTORY) {
      expect(w[e.id], `missing ${e.id}`).toBeDefined();
      expect(w[e.id].utcCron).toBe(e.currentCron);
    }
  });

  it("uses the inventory currentCron, not aedtCron (we are pre-cutover)", () => {
    const w = buildExpectedWindows();
    expect(w["c751741f"].utcCron).toBe("0 20,2,8,14 * * *");
  });
});

describe("classifyHeartbeat — clean", () => {
  it("returns null anomaly for a known cron firing on schedule", () => {
    const r = classifyHeartbeat({
      cronId: "c751741f",
      ranAtMs: SAT_2026_05_09_20_00_UTC_MS,
      recentHeartbeatsMs: [],
    });
    expect(r.anomaly).toBeNull();
    expect(r.detail).toBe("");
  });

  it("accepts heartbeat within +/- 30 min jitter window", () => {
    const fiveMinLate = SAT_2026_05_09_20_00_UTC_MS + 25 * 60 * 1000;
    const r = classifyHeartbeat({
      cronId: "c751741f",
      ranAtMs: fiveMinLate,
      recentHeartbeatsMs: [],
    });
    expect(r.anomaly).toBeNull();
  });

  it("accepts a multi-hour cron firing at any of its expected hours", () => {
    // c751741f = "0 20,2,8,14 * * *" — daily at 20:00, 02:00, 08:00, 14:00 UTC.
    // Pick a Tuesday at 14:00 UTC.
    const tue14 = Date.UTC(2026, 4, 12, 14, 0, 0);
    const r = classifyHeartbeat({
      cronId: "c751741f",
      ranAtMs: tue14,
      recentHeartbeatsMs: [],
    });
    expect(r.anomaly).toBeNull();
  });

  it("accepts a comma-list cron firing at the second listed hour", () => {
    // 2928f9fa = "0 8,20 * * *" — 08:00 UTC and 20:00 UTC daily.
    const tue08 = Date.UTC(2026, 4, 12, 8, 0, 0);
    const tue20 = Date.UTC(2026, 4, 12, 20, 0, 0);
    expect(
      classifyHeartbeat({ cronId: "2928f9fa", ranAtMs: tue08, recentHeartbeatsMs: [] }).anomaly,
    ).toBeNull();
    expect(
      classifyHeartbeat({ cronId: "2928f9fa", ranAtMs: tue20, recentHeartbeatsMs: [] }).anomaly,
    ).toBeNull();
  });
});

describe("classifyHeartbeat — unknown_cron_id", () => {
  it("flags an unknown cronId", () => {
    const r = classifyHeartbeat({
      cronId: "deadbeef",
      ranAtMs: SAT_2026_05_09_20_00_UTC_MS,
      recentHeartbeatsMs: [],
    });
    expect(r.anomaly).toBe("unknown_cron_id");
    expect(r.detail).toContain("deadbeef");
  });

  it("flags an offloaded (deleted) cron id that used to be in the inventory", () => {
    // 8e8b7bb5 was the old weekly backup cron — now a systemd timer on wmu.
    // A heartbeat from it now would be a forgery or a stale agent.
    const r = classifyHeartbeat({
      cronId: "8e8b7bb5",
      ranAtMs: SAT_2026_05_09_20_00_UTC_MS,
      recentHeartbeatsMs: [],
    });
    expect(r.anomaly).toBe("unknown_cron_id");
  });
});

describe("classifyHeartbeat — off_window", () => {
  it("flags a heartbeat for the right cron but at the wrong hour", () => {
    // c751741f fires at 02/08/14/20 UTC; 06:00 UTC is off-window from all of them.
    const r = classifyHeartbeat({
      cronId: "c751741f",
      ranAtMs: SAT_2026_05_09_06_00_UTC_MS,
      recentHeartbeatsMs: [],
    });
    expect(r.anomaly).toBe("off_window");
    expect(r.detail).toContain("c751741f");
  });

  it("flags a heartbeat just outside the 30-min jitter window", () => {
    const r = classifyHeartbeat({
      cronId: "c751741f",
      ranAtMs: SAT_2026_05_09_20_00_UTC_MS + 31 * 60 * 1000,
      recentHeartbeatsMs: [],
    });
    expect(r.anomaly).toBe("off_window");
  });
});

describe("classifyHeartbeat — double_fire", () => {
  it("flags a second heartbeat within 24h of the first", () => {
    const r = classifyHeartbeat({
      cronId: "c751741f",
      ranAtMs: SAT_2026_05_09_20_00_UTC_MS,
      recentHeartbeatsMs: [SAT_2026_05_09_20_00_UTC_MS - 12 * 60 * 60 * 1000], // 12h earlier
    });
    expect(r.anomaly).toBe("double_fire");
  });

  it("does NOT flag a heartbeat exactly 24h+ later (clean daily cron)", () => {
    // c751741f fires every 6 hours, so the prior expected fire was 6h before.
    // The "double_fire" rule looks at the last 24h window; a heartbeat exactly
    // 25h after a prior one is clean.
    const oneDayPlusLater = SAT_2026_05_09_20_00_UTC_MS + 25 * 60 * 60 * 1000;
    // Use a 02:00 UTC fire 25h after 20:00 prior fire — wait, 20:00 + 25h = 21:00 next day,
    // which is off-window. Use 20:00 next day instead (24h later — borderline).
    // Use 26h for clear-clean.
    const next20 = SAT_2026_05_09_20_00_UTC_MS + 26 * 60 * 60 * 1000; // 22:00 next day — off-window
    // Easier: shift the prior heartbeat to be just outside the 24h window from current.
    const current = SAT_2026_05_09_20_00_UTC_MS;
    const prior = current - 25 * 60 * 60 * 1000; // 25h before — outside double_fire window
    const r = classifyHeartbeat({
      cronId: "c751741f",
      ranAtMs: current,
      recentHeartbeatsMs: [prior],
    });
    expect(r.anomaly).toBeNull();
    void oneDayPlusLater;
    void next20;
  });

  it("priorities: unknown_cron_id wins over off_window and double_fire", () => {
    const r = classifyHeartbeat({
      cronId: "ghostfire",
      ranAtMs: SAT_2026_05_09_06_00_UTC_MS,
      recentHeartbeatsMs: [SAT_2026_05_09_06_00_UTC_MS - 1000],
    });
    expect(r.anomaly).toBe("unknown_cron_id");
  });

  it("priorities: off_window wins over double_fire", () => {
    const r = classifyHeartbeat({
      cronId: "c751741f",
      ranAtMs: SAT_2026_05_09_06_00_UTC_MS,
      recentHeartbeatsMs: [SAT_2026_05_09_06_00_UTC_MS - 60 * 60 * 1000],
    });
    expect(r.anomaly).toBe("off_window");
  });
});

describe("parseHeartbeatBody", () => {
  const NOW = Date.UTC(2026, 4, 9, 12, 0, 0);

  it("rejects non-objects", () => {
    expect(parseHeartbeatBody(null, NOW).ok).toBe(false);
    expect(parseHeartbeatBody("string", NOW).ok).toBe(false);
    expect(parseHeartbeatBody(42, NOW).ok).toBe(false);
  });

  it("rejects missing or malformed cronId", () => {
    expect(parseHeartbeatBody({}, NOW).ok).toBe(false);
    expect(parseHeartbeatBody({ cronId: "" }, NOW).ok).toBe(false);
    expect(parseHeartbeatBody({ cronId: "abc" }, NOW).ok).toBe(false); // too short
    expect(parseHeartbeatBody({ cronId: "x".repeat(40) }, NOW).ok).toBe(false); // too long
    expect(parseHeartbeatBody({ cronId: "bad spaces" }, NOW).ok).toBe(false);
  });

  it("accepts a clean cronId without ranAt and defaults to now", () => {
    const r = parseHeartbeatBody({ cronId: "c751741f" }, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.cronId).toBe("c751741f");
      expect(r.ranAtMs).toBe(NOW);
    }
  });

  it("converts ranAt unix-seconds to ms", () => {
    const r = parseHeartbeatBody({ cronId: "c751741f", ranAt: NOW / 1000 }, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.ranAtMs).toBe(NOW);
  });

  it("accepts ranAt already in ms (>= 10^12)", () => {
    const r = parseHeartbeatBody({ cronId: "c751741f", ranAt: NOW }, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.ranAtMs).toBe(NOW);
  });

  it("rejects ranAt more than 1 day in the future", () => {
    const future = NOW / 1000 + 2 * 24 * 3600;
    const r = parseHeartbeatBody({ cronId: "c751741f", ranAt: future }, NOW);
    expect(r.ok).toBe(false);
  });

  it("rejects ranAt more than 7 days in the past", () => {
    const past = NOW / 1000 - 8 * 24 * 3600;
    const r = parseHeartbeatBody({ cronId: "c751741f", ranAt: past }, NOW);
    expect(r.ok).toBe(false);
  });

  it("rejects non-finite ranAt", () => {
    expect(parseHeartbeatBody({ cronId: "c751741f", ranAt: NaN }, NOW).ok).toBe(false);
    expect(parseHeartbeatBody({ cronId: "c751741f", ranAt: Infinity }, NOW).ok).toBe(false);
    expect(parseHeartbeatBody({ cronId: "c751741f", ranAt: "12345" }, NOW).ok).toBe(false);
  });
});
