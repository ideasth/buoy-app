// filepath: /home/user/workspace/anchor/server/ontime/flagsync.ts
// Stage 29 — flag-only Outlook sync.
//
// When Oliver sorts an email in Buoy:
//   act_today / reply_week (open)      -> flag it in Outlook
//   done / dismissed / waiting / fyi   -> clear the flag, but ONLY if Buoy set it
// Nothing else in Outlook changes. Only Graph-sourced rows are eligible
// (uploads have no Outlook message id). Off unless config.flagSyncEnabled.

import type { TriageRow } from "./store";

export type FlagAction = "flag" | "clear" | null;

const FLAG_CATEGORIES = new Set(["act_today", "reply_week"]);

export function decideFlag(row: Pick<TriageRow, "source" | "status" | "category" | "flag_state">): FlagAction {
  if (row.source !== "graph") return null;
  const buoyFlagged = row.flag_state === "flagged";
  const open = row.status === "new";
  const wantsFlag = open && FLAG_CATEGORIES.has(String(row.category ?? ""));
  if (wantsFlag && !buoyFlagged) return "flag";
  if (!wantsFlag && buoyFlagged) return "clear";
  return null;
}

export interface FlagSyncDeps {
  setFlag: (externalId: string, status: "flagged" | "notFlagged") => Promise<void>;
  record: (id: number, state: "flagged" | "cleared" | null, error: string | null) => void;
}

export async function applyFlag(
  deps: FlagSyncDeps, row: Pick<TriageRow, "id" | "external_id" | "source">, action: Exclude<FlagAction, null>,
): Promise<{ ok: boolean; error?: string }> {
  if (row.source !== "graph") return { ok: false, error: "not an Outlook email" };
  try {
    await deps.setFlag(row.external_id, action === "flag" ? "flagged" : "notFlagged");
    deps.record(row.id, action === "flag" ? "flagged" : "cleared", null);
    return { ok: true };
  } catch (e) {
    const error = (e as Error).message.slice(0, 200);
    deps.record(row.id, null, error);
    return { ok: false, error };
  }
}
