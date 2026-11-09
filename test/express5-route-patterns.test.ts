// Regression test for the deploy that rolled back when Stage 17 first
// shipped: `router.get("/assets/*", ...)` is Express-4 syntax and throws at
// router-construction time under Express 5 / path-to-regexp 8.
//
// This test imports the availability router (the family router was retired 9 Nov 2026) and asserts that constructing them does
// not throw.  If anyone reintroduces a bare-`*` route pattern or any other
// Express-4 form, this test fails fast — long before pm2 has to roll back.

import { describe, it, expect } from "vitest";
import { makeAvailabilityRouter } from "../server/availability-routes";

describe("Express 5 route-pattern compatibility", () => {
  it("constructs the availability router without throwing", () => {
    expect(() => makeAvailabilityRouter()).not.toThrow();
  });

  it("rejects bare-`*` patterns at construction time (sanity check)", () => {
    // Confirms the underlying path-to-regexp is the strict 8.x version we
    // expect.  If this test starts passing without throwing, the project has
    // downgraded path-to-regexp and the *splat-form fix in
    // availability-routes is no longer the right shape.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const express = require("express");
    const r = express.Router();
    expect(() => r.get("/assets/*", () => {})).toThrow();
  });
});
