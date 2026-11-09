// filepath: /home/user/workspace/anchor/server/ontime/mailsync.ts
// Stage 30 — Outlook labels + Done/Dismissed filing (extends Stage 29 flags).
//
// When Oliver sorts an email in Buoy:
//   open + act_today/reply_week/waiting/fyi -> one "Buoy: ..." category
//     (replaces any earlier Buoy category; his own categories are kept)
//   done / dismissed -> Buoy flag + Buoy label removed, then the email is
//     moved to Archive > Buoy-DoneDismissed
//   reopened after Buoy filed it -> moved back to Inbox, then labelled
// Flags follow Stage 29 rules (decideFlag). Nothing is deleted, sent or
// marked read. Each switch is independent and defaults OFF.
//
// Outlook gives a message a new id whenever it moves, so every move
// records the new id (and webLink) on the triage row.

import { decideFlag, type FlagAction } from "./flagsync";
import type { TriageRow } from "./store";

export const BUOY_LABEL_PREFIX = "Buoy: ";
export const BUOY_LABELS: Record<string, string> = {
  act_today: "Buoy: Act today",
  reply_week: "Buoy: Reply this week",
  waiting: "Buoy: Waiting",
  fyi: "Buoy: FYI",
};
export const FILED_DONE = "buoy_done";

type Row = Pick<TriageRow, "source" | "status" | "category" | "flag_state" | "buoy_label" | "filed_folder">;

export interface MailPlan {
  flag: FlagAction;
  label: string | null | undefined; // undefined = leave labels alone
  move: "file" | "inbox" | null;
}

export function planMailSync(row: Row, opts: { flags: boolean; filing: boolean }): MailPlan {
  const plan: MailPlan = { flag: null, label: undefined, move: null };
  if (row.source !== "graph") return plan;
  if (opts.flags) plan.flag = decideFlag(row);
  if (opts.filing) {
    const closed = row.status === "done" || row.status === "dismissed";
    const want = !closed && row.status === "new" ? BUOY_LABELS[String(row.category ?? "")] ?? null : null;
    if ((row.buoy_label ?? null) !== want) plan.label = want;
    if (closed && row.filed_folder !== FILED_DONE) plan.move = "file";
    else if (!closed && row.filed_folder === FILED_DONE) plan.move = "inbox";
  }
  return plan;
}

export function isEmptyPlan(p: MailPlan): boolean {
  return !p.flag && p.label === undefined && !p.move;
}

/** Replace any Buoy category with `label`, keeping everything else. */
export function mergeCategories(current: string[], label: string | null): string[] {
  const kept = current.filter((c) => !c.startsWith(BUOY_LABEL_PREFIX));
  return label ? [...kept, label] : kept;
}

export interface MailOps {
  getCategories(messageId: string): Promise<string[]>;
  patchMessage(messageId: string, body: Record<string, unknown>): Promise<void>;
  move(messageId: string, dest: "file" | "inbox"): Promise<{ id: string; webLink: string | null }>;
}

export interface MailRecord {
  externalId?: string;
  webLink?: string | null;
  flagState?: "flagged" | "cleared";
  buoyLabel?: string | null;
  filedFolder?: string | null;
  error: string | null;
}

export async function runMailSync(
  ops: MailOps, record: (id: number, r: MailRecord) => void,
  row: Pick<TriageRow, "id" | "external_id">, plan: MailPlan,
): Promise<{ ok: boolean; error?: string }> {
  let msgId = row.external_id;
  try {
    if (plan.move === "inbox") {
      const r = await ops.move(msgId, "inbox");
      msgId = r.id;
      record(row.id, { externalId: r.id, webLink: r.webLink, filedFolder: null, error: null });
    }
    const body: Record<string, unknown> = {};
    if (plan.flag) body.flag = { flagStatus: plan.flag === "flag" ? "flagged" : "notFlagged" };
    if (plan.label !== undefined) body.categories = mergeCategories(await ops.getCategories(msgId), plan.label);
    if (Object.keys(body).length) {
      await ops.patchMessage(msgId, body);
      record(row.id, {
        ...(plan.flag ? { flagState: plan.flag === "flag" ? "flagged" : "cleared" } : {}),
        ...(plan.label !== undefined ? { buoyLabel: plan.label } : {}),
        error: null,
      } as MailRecord);
    }
    if (plan.move === "file") {
      const r = await ops.move(msgId, "file");
      record(row.id, { externalId: r.id, webLink: r.webLink, filedFolder: FILED_DONE, error: null });
    }
    return { ok: true };
  } catch (e) {
    const error = (e as Error).message.slice(0, 200);
    record(row.id, { error });
    return { ok: false, error };
  }
}

/** One sync at a time per email, so rapid re-sorts apply in order. */
export class PerRowQueue {
  private tails = new Map<number, Promise<unknown>>();
  run<T>(id: number, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(id) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(fn);
    this.tails.set(id, next);
    void next.finally(() => { if (this.tails.get(id) === next) this.tails.delete(id); }).catch(() => undefined);
    return next;
  }
}
