// Plan-mode contract regression suite.
//
// What this guards: the model emits anchor-action JSON blocks with a fixed
// schema; the client parses them; downstream we apply commits. If the schema
// drifts (e.g. "kind" → "type", or new mandatory field added), this suite
// fails and forces a deliberate update.
//
// What this does NOT guard: model behaviour. We don't call Perplexity here.
// Live nightly checks can be added later if drift becomes a real concern.

import { describe, expect, it } from "vitest";
import {
  extractAnchorActions,
  stripAnchorActions,
  validateAnchorAction,
} from "../shared/anchor-action";

describe("extractAnchorActions", () => {
  it("returns empty array on empty input", () => {
    expect(extractAnchorActions("")).toEqual([]);
    expect(extractAnchorActions("plain prose with no fenced block")).toEqual([]);
  });

  it("extracts a top3_candidate block", () => {
    const text = [
      "Here is your suggested top three for today:",
      "",
      "```anchor-action",
      '{ "kind": "top3_candidate", "date": "2026-05-08", "taskIds": [12, 34, 56] }',
      "```",
      "",
      "Want me to lock it in?",
    ].join("\n");
    const actions = extractAnchorActions(text);
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe("top3_candidate");
    expect(actions[0].payload).toMatchObject({
      kind: "top3_candidate",
      date: "2026-05-08",
      taskIds: [12, 34, 56],
    });
  });

  it("extracts an issue_patch block", () => {
    const text =
      'preamble\n```anchor-action\n{ "kind": "issue_patch", "issueId": 99, "fields": { "status": "in_progress", "domain": "work" } }\n```\ntrailer';
    const actions = extractAnchorActions(text);
    expect(actions).toHaveLength(1);
    expect(actions[0].payload.issueId).toBe(99);
    expect(actions[0].payload.fields).toEqual({ status: "in_progress", domain: "work" });
  });

  it("extracts repeat_last_top3", () => {
    const text =
      '```anchor-action\n{ "kind": "repeat_last_top3", "date": "2026-05-08" }\n```';
    expect(extractAnchorActions(text)[0].kind).toBe("repeat_last_top3");
  });

  it("extracts swap_in_underworked_project", () => {
    const text =
      '```anchor-action\n{ "kind": "swap_in_underworked_project", "date": "2026-05-08", "slot": 3, "projectId": 42, "taskId": 117 }\n```';
    const action = extractAnchorActions(text)[0];
    expect(action.kind).toBe("swap_in_underworked_project");
    expect(action.payload.slot).toBe(3);
  });

  it("skips malformed blocks silently", () => {
    const text =
      "```anchor-action\n{ this is not json }\n```\n```anchor-action\n{ \"kind\": \"top3_candidate\", \"date\": \"2026-05-08\", \"taskIds\": [1] }\n```";
    const actions = extractAnchorActions(text);
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe("top3_candidate");
  });

  it("skips blocks without a string kind", () => {
    const text = '```anchor-action\n{ "type": "top3_candidate" }\n```';
    expect(extractAnchorActions(text)).toEqual([]);
  });

  it("extracts multiple distinct blocks in a single response", () => {
    const text = [
      "```anchor-action",
      '{ "kind": "issue_patch", "issueId": 1, "fields": { "status": "done" } }',
      "```",
      "and another",
      "```anchor-action",
      '{ "kind": "repeat_last_top3", "date": "2026-05-08" }',
      "```",
    ].join("\n");
    const actions = extractAnchorActions(text);
    expect(actions.map((a) => a.kind)).toEqual(["issue_patch", "repeat_last_top3"]);
  });
});

describe("stripAnchorActions", () => {
  it("removes fenced action blocks but keeps prose", () => {
    const text =
      'Lead sentence.\n\n```anchor-action\n{ "kind": "repeat_last_top3", "date": "2026-05-08" }\n```\n\nClosing question?';
    const cleaned = stripAnchorActions(text);
    expect(cleaned).toContain("Lead sentence.");
    expect(cleaned).toContain("Closing question?");
    expect(cleaned).not.toContain("anchor-action");
    expect(cleaned).not.toContain("kind");
  });

  it("returns trimmed empty string when input is only an action block", () => {
    const text =
      '```anchor-action\n{ "kind": "repeat_last_top3", "date": "2026-05-08" }\n```';
    expect(stripAnchorActions(text)).toBe("");
  });
});

describe("validateAnchorAction", () => {
  it("accepts a valid top3_candidate", () => {
    const a = validateAnchorAction({
      kind: "top3_candidate",
      date: "2026-05-08",
      taskIds: [1, 2, 3],
    });
    expect(a).not.toBeNull();
    expect(a!.kind).toBe("top3_candidate");
  });

  it("rejects top3_candidate with bad date format", () => {
    expect(
      validateAnchorAction({ kind: "top3_candidate", date: "8 May", taskIds: [1] }),
    ).toBeNull();
  });

  it("rejects top3_candidate with non-numeric task ids", () => {
    expect(
      validateAnchorAction({
        kind: "top3_candidate",
        date: "2026-05-08",
        taskIds: ["12" as unknown as number],
      }),
    ).toBeNull();
  });

  it("accepts a valid issue_patch", () => {
    const a = validateAnchorAction({
      kind: "issue_patch",
      issueId: 99,
      fields: { status: "in_progress" },
    });
    expect(a).not.toBeNull();
  });

  it("rejects issue_patch with array fields", () => {
    expect(
      validateAnchorAction({ kind: "issue_patch", issueId: 1, fields: ["a"] }),
    ).toBeNull();
  });

  it("accepts swap_in_underworked_project with slot 1/2/3", () => {
    for (const slot of [1, 2, 3] as const) {
      expect(
        validateAnchorAction({
          kind: "swap_in_underworked_project",
          date: "2026-05-08",
          slot,
          projectId: 42,
          taskId: 117,
        }),
      ).not.toBeNull();
    }
  });

  it("rejects swap_in_underworked_project with slot 0 or 4", () => {
    for (const slot of [0, 4]) {
      expect(
        validateAnchorAction({
          kind: "swap_in_underworked_project",
          date: "2026-05-08",
          slot,
          projectId: 42,
          taskId: 117,
        }),
      ).toBeNull();
    }
  });

  it("rejects unknown kind", () => {
    expect(
      validateAnchorAction({ kind: "delete_everything", date: "2026-05-08" }),
    ).toBeNull();
  });

  it("rejects null/non-object input", () => {
    expect(validateAnchorAction(null)).toBeNull();
    expect(validateAnchorAction(undefined)).toBeNull();
    expect(validateAnchorAction("string")).toBeNull();
    expect(validateAnchorAction(42)).toBeNull();
  });
});

// Realistic full-response fixtures mirroring what the model has emitted in
// past sessions. Each must pass extract + validate end-to-end.
const RESPONSE_FIXTURES: Array<{ name: string; text: string; expectedKind: string }> = [
  {
    name: "top3 with leading orientation and trailing question",
    text: `You're under-slept and morning theatre is at 09:00, so save deep work for the afternoon block.

- Submit the Coleman report (carried over 3 days)
- Reply to RANZCOG safety letter
- 30 min on the funnel diagram

\`\`\`anchor-action
{ "kind": "top3_candidate", "date": "2026-05-08", "taskIds": [12, 34, 56] }
\`\`\`

Lock these in?`,
    expectedKind: "top3_candidate",
  },
  {
    name: "issue_patch with multiline fields",
    text: `That issue has been stuck for two weeks and the blocker is on Marieke. I'd reframe it from "blocked" to "in_progress" so the calendar nudges resume.

\`\`\`anchor-action
{
  "kind": "issue_patch",
  "issueId": 99,
  "fields": { "status": "in_progress", "domain": "work" }
}
\`\`\`

Want me to apply that?`,
    expectedKind: "issue_patch",
  },
  {
    name: "repeat_last_top3 with empty narrative",
    text: `Yesterday's three still hold. No need to redecide.

\`\`\`anchor-action
{ "kind": "repeat_last_top3", "date": "2026-05-08" }
\`\`\`

Run it back?`,
    expectedKind: "repeat_last_top3",
  },
];

describe("end-to-end fixtures", () => {
  for (const f of RESPONSE_FIXTURES) {
    it(`parses + validates: ${f.name}`, () => {
      const actions = extractAnchorActions(f.text);
      expect(actions).toHaveLength(1);
      expect(actions[0].kind).toBe(f.expectedKind);
      const validated = validateAnchorAction(actions[0].payload);
      expect(validated).not.toBeNull();
      expect(validated!.kind).toBe(f.expectedKind);

      const stripped = stripAnchorActions(f.text);
      expect(stripped).not.toContain("anchor-action");
      expect(stripped.length).toBeGreaterThan(0);
    });
  }
});
