// filepath: test/pmt-fields-ui.test.ts
// PMT component fields — UI source-text guards.
// Mirrors test/pmt-dashboard-ui.test.ts: reads page source and asserts the
// new affordances (narrative status box, phase description editor, actions
// section, notes timeline) and dashboard rollup badges are present.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");

function readSrc(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf-8");
}

describe("ProjectDetail.tsx — PMT component field affordances", () => {
  const src = readSrc("client/src/pages/ProjectDetail.tsx");

  it("renders the narrative status box with edit/save controls", () => {
    expect(src).toContain("narrative-status-box");
    expect(src).toContain("textarea-narrative-status");
    expect(src).toContain("button-save-narrative-status");
  });

  it("renders phase description editing controls", () => {
    expect(src).toContain("phase-description-");
    expect(src).toContain("textarea-phase-description-");
    expect(src).toContain("button-save-phase-description-");
  });

  it("renders the actions section with an add-action control", () => {
    expect(src).toContain("section-actions");
    expect(src).toContain("input-new-action");
    expect(src).toContain("button-add-action");
  });

  it("renders the component notes timeline section", () => {
    expect(src).toContain("section-component-notes");
    expect(src).toContain("textarea-new-note-body");
  });

  it("renders per-action status select and action notes", () => {
    expect(src).toContain("action-row-");
    expect(src).toContain("select-action-status-");
    expect(src).toContain("button-add-action-note-");
  });

  it("queries the new sub-resource endpoints", () => {
    expect(src).toContain("/notes");
    expect(src).toContain("/actions");
    expect(src).toContain("/narrative-status");
  });
});

describe("PmtDashboard.tsx — component-field rollups", () => {
  const src = readSrc("client/src/pages/PmtDashboard.tsx");

  it("renders the narrative snippet and no-status badge", () => {
    expect(src).toContain("narrative-snippet-");
    expect(src).toContain("badge-no-narrative-");
  });

  it("renders open-action and phase-objectives badges", () => {
    expect(src).toContain("badge-open-actions-");
    expect(src).toContain("badge-phase-desc-");
  });

  it("reads the rollup fields from the PmtItem", () => {
    for (const field of [
      "hasNarrativeStatus",
      "narrativeSnippet",
      "openActiveActionCount",
      "phaseDescriptionCount",
    ]) {
      expect(src, `expected rollup field ${field}`).toContain(field);
    }
  });
});
