// Plan-mode action contract. The coach model (sonar-reasoning-pro / sonar-pro)
// emits one fenced ```anchor-action ... ``` block per turn when the user has
// indicated they want a concrete commitment. The block is JSON with a "kind"
// discriminator. This file is the single source of truth for that contract;
// import from both client (UI) and test suite (regression).

export type AnchorActionKind =
  | "top3_candidate"
  | "issue_patch"
  | "repeat_last_top3"
  | "swap_in_underworked_project";

export interface AnchorActionTop3Candidate {
  kind: "top3_candidate";
  date: string; // YYYY-MM-DD
  taskIds: number[];
}

export interface AnchorActionIssuePatch {
  kind: "issue_patch";
  issueId: number;
  fields: Record<string, unknown>;
}

export interface AnchorActionRepeatLastTop3 {
  kind: "repeat_last_top3";
  date: string; // YYYY-MM-DD
}

export interface AnchorActionSwapInUnderworkedProject {
  kind: "swap_in_underworked_project";
  date: string; // YYYY-MM-DD
  slot: 1 | 2 | 3;
  projectId: number;
  taskId: number;
}

export type AnchorAction =
  | AnchorActionTop3Candidate
  | AnchorActionIssuePatch
  | AnchorActionRepeatLastTop3
  | AnchorActionSwapInUnderworkedProject;

export interface ExtractedAnchorAction {
  kind: string;
  payload: Record<string, unknown>;
  raw: string;
}

const ANCHOR_ACTION_RE = /```anchor-action\s*\n([\s\S]*?)\n```/g;

/**
 * Extract every anchor-action JSON block from an assistant response. Malformed
 * blocks (invalid JSON, missing kind) are silently skipped — the model has
 * historically emitted partial blocks when streaming was truncated.
 */
export function extractAnchorActions(text: string): ExtractedAnchorAction[] {
  if (!text) return [];
  const out: ExtractedAnchorAction[] = [];
  // RegExp with /g must be reset; we construct a fresh exec loop per call.
  const re = new RegExp(ANCHOR_ACTION_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    try {
      const obj = JSON.parse(m[1]);
      if (obj && typeof obj === "object" && typeof obj.kind === "string") {
        out.push({ kind: obj.kind, payload: obj, raw: m[0] });
      }
    } catch {
      // Skip malformed action blocks silently.
    }
  }
  return out;
}

/**
 * Remove anchor-action blocks from response text so the UI can render the
 * narrative reply without the machine-readable footer.
 */
export function stripAnchorActions(text: string): string {
  return text.replace(new RegExp(ANCHOR_ACTION_RE.source, "g"), "").trim();
}

/**
 * Type-guard validation. Returns the typed action if `kind` and required
 * fields match the contract; null otherwise.
 */
export function validateAnchorAction(input: unknown): AnchorAction | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  if (typeof o.kind !== "string") return null;

  switch (o.kind) {
    case "top3_candidate": {
      if (typeof o.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(o.date)) return null;
      if (!Array.isArray(o.taskIds)) return null;
      if (!o.taskIds.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
      return {
        kind: "top3_candidate",
        date: o.date,
        taskIds: o.taskIds as number[],
      };
    }
    case "issue_patch": {
      if (typeof o.issueId !== "number" || !Number.isFinite(o.issueId)) return null;
      if (!o.fields || typeof o.fields !== "object" || Array.isArray(o.fields)) return null;
      return {
        kind: "issue_patch",
        issueId: o.issueId,
        fields: o.fields as Record<string, unknown>,
      };
    }
    case "repeat_last_top3": {
      if (typeof o.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(o.date)) return null;
      return { kind: "repeat_last_top3", date: o.date };
    }
    case "swap_in_underworked_project": {
      if (typeof o.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(o.date)) return null;
      if (o.slot !== 1 && o.slot !== 2 && o.slot !== 3) return null;
      if (typeof o.projectId !== "number" || !Number.isFinite(o.projectId)) return null;
      if (typeof o.taskId !== "number" || !Number.isFinite(o.taskId)) return null;
      return {
        kind: "swap_in_underworked_project",
        date: o.date,
        slot: o.slot,
        projectId: o.projectId,
        taskId: o.taskId,
      };
    }
    default:
      return null;
  }
}
