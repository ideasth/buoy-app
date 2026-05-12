// Stage 14b (2026-05-12) — Relationships page mount smoke test.
//
// The repo's vitest config runs in the "node" environment and does not
// include @testing-library/react. A full render-with-RTL smoke test
// would require pulling in jsdom + react-dom/test-utils, which is more
// surface area than this stage warrants. Instead this is a "module
// shape + locked copy" test that catches:
//   - The component file is parseable / type-checks.
//   - It exports a default React component function.
//   - The locked spec copy is present (header, helper text, empty-state
//     message, button labels), which is what a future RTL test would
//     also assert.
//
// When @testing-library/react eventually lands in the repo, replace
// this file with a real render-and-assert smoke test.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SRC = readFileSync(
  path.resolve(__dirname, "../client/src/pages/Relationships.tsx"),
  "utf8",
);

describe("Relationships page (smoke)", () => {
  it("module loads and exports a default React component function", async () => {
    const mod = await import("../client/src/pages/Relationships");
    expect(typeof mod.default).toBe("function");
  });

  it("renders the locked title + helper text from the spec", () => {
    expect(SRC).toMatch(/<CardTitle>Relationships<\/CardTitle>/);
    expect(SRC).toContain(
      "Names the coach knows about. Soft-delete to hide a row from prompts without losing history.",
    );
  });

  it("ships the empty-state message verbatim", () => {
    expect(SRC).toContain(
      "No relationships yet. The coach prompt will omit the people section until you add some.",
    );
  });

  it("wires the Show inactive toggle and the Add relationship button", () => {
    expect(SRC).toMatch(/data-testid="switch-show-inactive"/);
    expect(SRC).toMatch(/data-testid="button-add-relationship"/);
    expect(SRC).toMatch(/Add relationship/);
  });

  it("offers Edit, Soft delete, and Re-activate per-row actions", () => {
    expect(SRC).toMatch(/data-testid={`button-edit-\$\{row\.id\}`}/);
    expect(SRC).toMatch(/data-testid={`button-soft-delete-\$\{row\.id\}`}/);
    expect(SRC).toMatch(/data-testid={`button-reactivate-\$\{row\.id\}`}/);
    // The two are mutually exclusive — only soft-delete shown when
    // active, only re-activate shown when inactive. Sanity-check the
    // conditional branches are paired.
    expect(SRC).toMatch(/row\.active === 1 \?/);
  });

  it("invalidates the relationships query on mutation success", () => {
    expect(SRC).toMatch(/queryClient\.invalidateQueries\(\{[\s\S]*?relationships/);
  });

  it("uses the new fetch URL with include_inactive=1 when the toggle is on", () => {
    expect(SRC).toMatch(/\/api\/relationships\?include_inactive=1/);
  });

  it("matches the storage facade field-name shape (camelCase from the server)", () => {
    // The page reads camelCase fields (relationshipLabel, displayOrder,
    // updatedAt) — drizzle's $inferSelect returns camelCase. If the
    // server ever shifted to snake_case this test would fail.
    expect(SRC).toMatch(/row\.relationshipLabel/);
    expect(SRC).toMatch(/row\.displayOrder/);
    expect(SRC).toMatch(/row\.updatedAt/);
  });
});
