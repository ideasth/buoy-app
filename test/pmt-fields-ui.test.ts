// filepath: test/pmt-fields-ui.test.ts
// PMT component fields — UI source-text guards.
// Mirrors test/pmt-dashboard-ui.test.ts: reads page source and asserts the
// new affordances (narrative status box, phase description editor, notes
// timeline) and dashboard rollup badges are present.
//
// Note: the Actions section was removed in Stage 23.

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

  it("renders the component notes timeline section with a thread URL input", () => {
    expect(src).toContain("section-component-notes");
    expect(src).toContain("textarea-new-note-body");
    expect(src).toContain("input-new-note-source-url");
  });

  it("no longer renders the Actions section (removed in Stage 23)", () => {
    expect(src).not.toContain("section-actions");
    expect(src).not.toContain("action-row-");
    expect(src).not.toContain("select-action-status-");
  });

  it("queries the new sub-resource endpoints", () => {
    expect(src).toContain("/notes");
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
