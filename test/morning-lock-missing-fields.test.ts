// Morning lock — alignment between server-side `missing[]` check and the
// reflection chips on the Morning page.
//
// Regression context (2026-05-23): the Morning page chips wrote only to
// `energyLabel` (text: low | moderate | high), but the server's lock
// handler still tested the legacy `cur.energy` integer column. A user who
// had tapped an energy chip would still see the toast "Saved — a few
// things still missing: energy". Symmetrically, the server's check
// omitted `arousalState` entirely, so the chip pair could disagree with
// the toast in either direction.
//
// These tests follow the source-text guard pattern used by
// stage19-llm-proxy.test.ts: cheap, no Express spin-up, and they catch
// the exact regression by name.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROUTES_SRC = readFileSync(
  path.resolve(__dirname, "../server/routes.ts"),
  "utf8",
);

describe("Morning lock — server `missing[]` aligns with reflection chips", () => {
  // Isolate the /api/morning/lock handler body so we don't accidentally
  // match unrelated occurrences of `cur.energy` elsewhere in routes.ts.
  const LOCK_HANDLER = (() => {
    const start = ROUTES_SRC.indexOf('app.post("/api/morning/lock"');
    expect(start).toBeGreaterThan(-1);
    // Grab a generous window — handler is short, ~30 lines.
    return ROUTES_SRC.slice(start, start + 2000);
  })();

  it("checks energyLabel (the column the chip writes), not the legacy energy integer", () => {
    expect(LOCK_HANDLER).toContain('if (!cur.energyLabel) missing.push("energy")');
    // Legacy column must not be used in the gate.
    expect(LOCK_HANDLER).not.toMatch(/if \(!cur\.energy\)\s*missing\.push/);
  });

  it("checks the arousal chip column (`state` on morningRoutines) so the server agrees with reflectDone", () => {
    // The arousal chip in Morning.tsx writes to `state`, not
    // `arousalState` (which lives only on the reflections table). The
    // pushed-missing key remains "arousalState" because that's the
    // semantic name the client toast surfaces to the user.
    expect(LOCK_HANDLER).toContain('if (!cur.state) missing.push("arousalState")');
    expect(LOCK_HANDLER).not.toMatch(/cur\.arousalState/);
  });

  it("still checks braindumpRaw and topThreeIds (no regressions on the other gates)", () => {
    expect(LOCK_HANDLER).toContain('if (!cur.braindumpRaw) missing.push("braindumpRaw")');
    expect(LOCK_HANDLER).toContain('if (ids.length === 0) missing.push("topThreeIds")');
  });

  it("reports the missing fields back to the client in the response payload", () => {
    expect(LOCK_HANDLER).toContain("res.json({ completed, missing })");
  });
});
