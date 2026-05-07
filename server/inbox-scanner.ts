// Inbox-scan adapter.
//
// The previous Python prototype (live-sync/inbox_scanner.py) parsed Outlook
// emails for booking/appointment hints and saved them as proposals. The new
// architecture keeps the actual scanning OUT of the webapp \u2014 the
// orchestrator (cron) does the email reads and POSTs results to
// /api/inbox/suggestions. This module just defines the shape the orchestrator
// must use and a small helper for converting an approved suggestion into an
// actual task row.

import { storage } from "./storage";
import type { InboxScanItem, Task } from "@shared/schema";

export interface SuggestedAction {
  kind: "task" | "event";
  title: string;
  due?: string | null; // ISO date or null
  list?: string | null; // MS To Do list id
  domain?: string | null;
  estimateMinutes?: number;
  notes?: string | null;
}

export function parseSuggestedAction(raw: string): SuggestedAction | null {
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj.title === "string") return obj as SuggestedAction;
  } catch {
    // ignore
  }
  return null;
}

export function approveAsTask(item: InboxScanItem): Task | null {
  const sug = parseSuggestedAction(item.suggestedAction ?? "{}");
  if (!sug) return null;
  if (sug.kind !== "task") return null; // events are out of scope here
  const dueAt = sug.due ? Date.parse(sug.due) : null;
  const created = storage.insertRawTask({
    title: sug.title,
    status: "todo",
    priority: "iftime",
    domain: (sug.domain as Task["domain"]) ?? "work",
    estimateMinutes: sug.estimateMinutes ?? 30,
    dueAt: Number.isFinite(dueAt as number) ? (dueAt as number) : null,
    notes: sug.notes ?? null,
    createdAt: Date.now(),
    msTodoListId: sug.list ?? null,
    syncDirty: sug.list ? 1 : 0,
    tag: "Inbox",
  });
  return created;
}
