// One-time importer: reads a Microsoft Graph dump of MS To Do lists+tasks and
// upserts them into Anchor's SQLite store. Run via `npm run import:mstodo`.
//
// Idempotent: re-running skips tasks whose msTodoId is already present.

import fs from "node:fs";
import path from "node:path";
import { storage } from "./storage";
import { mapListNameToDomain } from "./mstodo-mapping";

const DUMP_PATH = "/home/user/workspace/mstodo_all_tasks.json";
const DEFAULT_TARGET_NAME = "Tasks (default)";

interface MsTask {
  id: string;
  title: string;
  status: string; // notStarted / inProgress / completed
  importance?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  body?: { content?: string; contentType?: string };
  dueDateTime?: { dateTime: string; timeZone: string };
  "@odata.etag"?: string;
}

interface MsListBlock {
  list_name: string;
  list_id: string;
  task_count: number;
  active_count: number;
  completed_count: number;
  tasks: MsTask[];
}

interface Dump {
  fetched_at: string;
  lists: MsListBlock[];
}

function parseDueAt(dueDateTime: { dateTime: string; timeZone: string } | undefined): number | null {
  if (!dueDateTime?.dateTime) return null;
  // dateTime looks like "2026-05-08T00:00:00.0000000". Treat its calendar date
  // as a local AEST date and pin to 09:00 on that day.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dueDateTime.dateTime);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  // new Date(y, mo-1, d, 9) interprets in the runtime's local TZ. The deploy
  // box is configured for Australia/Melbourne via the SettingsBlob so this is
  // close enough for the importer; the live sync engine will refine.
  return new Date(y, mo - 1, d, 9, 0, 0).getTime();
}

function parseMsDate(s: string | undefined): number {
  if (!s) return Date.now();
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : Date.now();
}

function main() {
  if (!fs.existsSync(DUMP_PATH)) {
    console.error(`Dump file not found: ${DUMP_PATH}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(DUMP_PATH, "utf8");
  const dump: Dump = JSON.parse(raw);

  console.log(`Loaded dump from ${DUMP_PATH}`);
  console.log(`  fetched_at: ${dump.fetched_at}`);
  console.log(`  ${dump.lists.length} lists`);

  // 1. Upsert lists
  let listsUpserted = 0;
  for (const block of dump.lists) {
    const defaultDomain = mapListNameToDomain(block.list_name);
    const isDefaultTarget = block.list_name === DEFAULT_TARGET_NAME ? 1 : 0;
    storage.upsertMsTodoList({
      msListId: block.list_id,
      name: block.list_name,
      defaultDomain,
      isDefaultTarget,
      enabled: 1,
    });
    listsUpserted++;
  }
  console.log(`Upserted ${listsUpserted} lists.`);

  // 2. Import active (non-completed) tasks
  let imported = 0;
  let skipped = 0;
  let dueCount = 0;
  const now = Date.now();
  for (const block of dump.lists) {
    const domain = mapListNameToDomain(block.list_name);
    for (const t of block.tasks) {
      if (t.status === "completed") continue;
      // idempotent
      if (storage.getTaskByMsId(t.id)) {
        skipped++;
        continue;
      }
      const dueAt = parseDueAt(t.dueDateTime);
      if (dueAt !== null) dueCount++;
      const priority = dueAt !== null ? "deadline" : "iftime";
      const notesContent = t.body?.contentType === "text" ? t.body.content?.trim() : "";
      const notes = notesContent ? notesContent : null;
      storage.insertRawTask({
        title: t.title,
        status: "todo",
        priority,
        domain,
        estimateMinutes: 30,
        dueAt: dueAt ?? undefined,
        createdAt: parseMsDate(t.createdDateTime),
        notes,
        tag: block.list_name,
        msTodoId: t.id,
        msTodoListId: block.list_id,
        msTodoEtag: t["@odata.etag"] ?? null,
        lastSyncedAt: now,
        syncDirty: 0,
      });
      imported++;
    }
  }

  storage.appendSyncLog({
    at: now,
    kind: "import",
    msTaskId: null,
    summary: `Imported ${imported} active tasks from ${listsUpserted} lists`,
    detail: `skipped=${skipped} (already present); ${dueCount} had due dates`,
  });

  console.log(`\nImport complete:`);
  console.log(`  imported: ${imported}`);
  console.log(`  skipped (already present): ${skipped}`);
  console.log(`  with due date: ${dueCount}`);
  console.log(`  total ms-linked tasks now in DB: ${storage.countImportedTasks()}`);
}

main();
