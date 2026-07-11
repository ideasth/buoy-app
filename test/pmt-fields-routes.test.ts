// filepath: test/pmt-fields-routes.test.ts
// PMT component fields — route-shape / source-text guards.
// Mirrors test/pmt-routes.test.ts: reads server/routes.ts source and asserts
// structural invariants (route registration, session gating, unknown-field
// rejection, validation strings) without booting the server.

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");

function readSrc(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf-8");
}

describe("PMT field routes registered (server/routes.ts)", () => {
  const src = readSrc("server/routes.ts");

  it("registers narrative status, phase description, and notes routes", () => {
    for (const route of [
      '"/api/projects/:id/narrative-status"',
      '"/api/phases/:phaseId/description"',
      '"/api/projects/:id/notes"',
      '"/api/component-notes/:noteId"',
    ]) {
      expect(src, `expected route ${route}`).toContain(route);
    }
  });

  it("no longer registers any Actions routes (removed in Stage 23)", () => {
    for (const route of [
      '"/api/projects/:id/actions"',
      '"/api/actions/:actionId"',
      '"/api/actions/:actionId/notes"',
      '"/api/action-notes/:noteId"',
    ]) {
      expect(src, `route ${route} should be gone`).not.toContain(route);
    }
  });

  it("session-gates every new route with requireUserOrOrchestrator", () => {
    // Count of new PMT-field handlers must all check the session guard.
    // The block begins at the narrative-status route.
    const block = src.slice(src.indexOf("PMT component fields"), src.indexOf("Bulk ingest from MS To Do"));
    const handlers = (block.match(/app\.(get|post|patch|delete)\(/g) || []).length;
    const guards = (block.match(/requireUserOrOrchestrator\(req, res\)/g) || []).length;
    expect(handlers).toBeGreaterThan(0);
    expect(guards).toBe(handlers);
  });

  it("rejects unknown fields on write routes", () => {
    expect(src).toContain("unknown_field:");
  });

  it("enforces length limits on narrative status and description", () => {
    expect(src).toContain("latestNarrativeStatus too long (max 2000)");
    expect(src).toContain("description too long (max 5000)");
    expect(src).toContain("title too long (max 200)");
  });

  it("requires body/date-independent required fields", () => {
    expect(src).toContain("latestNarrativeStatus required");
    expect(src).toContain("description required");
    expect(src).toContain("body required");
    expect(src).toContain("noteDate required");
  });

  it("validates optional URL fields as blank-or-http(s)", () => {
    expect(src).toContain("isBlankOrValidUrl");
    expect(src).toContain("invalid_source_url");
  });
});
