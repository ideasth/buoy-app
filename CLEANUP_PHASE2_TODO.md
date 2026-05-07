# Anchor cleanup — Phase 2 (in progress)

Phase 1 (completed 5 May 2026): Stripped 5 orphaned `/api/sync/*` routes from
`server/routes.ts`. Bundle shrank ~27KB. Live at https://anchor-jod.pplx.app.

Sweep 1 (completed 5 May 2026): Stripped MsTodoSection (Settings UI) +
Capture.tsx MS To Do list dropdown + 3 server routes (`GET /api/mstodo/lists`,
`PATCH /api/mstodo/lists/:id`, `GET /api/mstodo/sync-status`) + 5 storage
methods (`listMsTodoLists`, `updateMsTodoList`, `recentSyncLog`, `latestSyncAt`,
`countDirtyTasks`). Capture submit no longer sets `msTodoListId`/`tag`/
`syncDirty` on new tasks. Bundle: 985KB. Verified: removed routes return 401
(auth gate) for unauth requests AND fall through to SPA HTML 200 with
orchestrator secret — confirms handlers truly gone. Health check OK. Live at
same URL with data.db preserved.

What remains as decorative-but-harmless code debt:

## Server side

- [x] Sweep 2 — COMPLETE 5 May 2026.
  Removed:
  - `POST /api/sync/request` route (server/routes.ts) + comment cleanup at line 540
  - `server/sync-engine.ts` — entire file deleted (212 lines, 0 importers verified)
    - Took with it: `pullChanges`, `gatherPendingPushes`, `markPushed`, `applyDelete`, `taskToGraphPayload` (and unused interfaces)
  - Storage methods in server/storage.ts:
    - `enqueueSync`, `listSyncQueue`, `getSyncQueue`, `markSyncQueueResult` (Sync queue block — `getSyncQueue` was internal helper, dead after `markSyncQueueResult` removal)
    - `pendingPushTasks`, `markTaskPushed` (only callers were sync-engine.ts)
  - Storage imports trimmed: `syncQueue` table import + `SyncQueueItem`/`InsertSyncQueue` type imports
  - Stale comments updated (no longer reference deleted sync-engine module)

  KEPT (correctly):
  - `appendSyncLog` — still called by `import-mstodo.ts` script
  - `getMsTodoListByMsId`, `upsertMsTodoList` — still used by import script + Capture/Settings UI
  - `tasks.ms_todo_id`, `tasks.ms_todo_list_id`, `tasks.tag`, `tasks.last_synced_at` — provenance, schema decision deferred
  - `shared/schema.ts` types `SyncQueueItem`/`InsertSyncQueue` — table still exists, types are harmless (per schema decision)

  Build + smoke test:
  - `npm run build` clean (1007303 bytes dist/index.cjs)
  - Secret bake-in verified (1 occurrence)
  - Removed-symbol grep on dist: all 0 occurrences (`enqueueSync`, `listSyncQueue`, `markSyncQueueResult`, `pendingPushTasks`, `markTaskPushed`, `pullChanges`, `gatherPendingPushes`, `taskToGraphPayload`, `/api/sync/request`)
  - Published to existing site_id `77eb73a0-40d8-4ae2-9a78-4239f106294b` at https://anchor-jod.pplx.app
  - Smoke tests passed:
    - `GET /api/health` → 200 `{ok:true}`
    - `POST /api/sync/request` (unauth) → 200 SPA HTML (route gone, fell through to client)
    - `POST /api/sync/request` (with orchestrator secret) → 200 SPA HTML (route gone — confirms handler removed, not just gated)
    - `GET /api/morning/today` (unauth) → 401 (still-live secret-gated route correct)
    - `GET /api/inbox/count` (auth) → 200 `{pending:0}` (data.db preserved)
    - `GET /api/calendar-events?days=14` (auth) → 200, 37KB payload (calendar cache warm)

## Schema

**Decision logged 5 May 2026: DEFERRED INDEFINITELY (deliberate, not oversight).**

Audited `data.db` (158 tasks, 42 ms_todo_lists, 98 sync_log, 0 sync_queue).
Weighed migration risk against benefit and chose to leave the schema as-is.

Reasoning:

- Benefit is purely cosmetic. Dead columns/tables in SQLite have no runtime
  cost — no perf hit, no query confusion (kept routes don't reference them),
  negligible file size delta.
- Migration risk on a populated, live `data.db` is non-zero. SQLite
  `DROP COLUMN` involves table-rewrite mechanics under Drizzle. Recovery from
  a botched migration on the published sandbox is awkward.
- Provenance is genuinely useful. `tasks.ms_todo_id` + `tasks.ms_todo_list_id`
  are populated on ALL 158 tasks — they're the only record of where each task
  originated. Cost to keep: zero. Value if ever auditing/reconciling: real.
- Phase 1 already captured the meaningful win (removing callable dead routes).
  Schema is inert by comparison.

If revisiting later, the candidates were:

- **Keep regardless** (provenance / still-used): `tasks.ms_todo_id`,
  `tasks.ms_todo_list_id`, `tasks.last_synced_at`, `tasks.tag`,
  `ms_todo_lists` table (still backs Capture dropdown + Settings UI).
- **Drop candidates** (low value, all empty or stale):
  `sync_queue` table (0 rows), `sync_log` table (98 rows pure history),
  `tasks.ms_todo_etag` (55/158, only meaningful for live sync),
  `tasks.sync_dirty` (1 row=1, no longer meaningful),
  `tasks.pending_action` (0 rows).

⚠️ If you ever do migrate: test on a copy of `data.db` first. Use
`publish_website`'s auto-snapshot to roll back if something breaks.

## Client side

✅ **Done in Sweep 1 (5 May 2026):**
- `Settings.tsx`: removed `MsTodoSection` function + render callsite +
  `SyncStatus` interface + `fmtRelative` helper + unused `MsTodoList` /
  `SyncLog` type imports.
- `Capture.tsx`: removed list dropdown (`<Select>` + `listsQ` + `enabledLists`
  + `defaultListId` + `listChoice` state + default-selection effect) +
  unused `MsTodoList` import + unused `useMemo` + unused `Select*` imports +
  `NO_LIST_VALUE` const. Submit payload no longer sets `msTodoListId`,
  `tag`, or `syncDirty` on new tasks.
- Voice capture verified independent (separate refs/effects, untouched).

## After Phase 2 — DONE 5 May 2026

- Rebuilt + published to existing site_id (data.db auto-preserved). ✓
- Smoke tests confirm removed routes fall through to SPA HTML 200 even with
  orchestrator secret (proves handlers gone, not just gated). ✓
- File retained as historical record of the cleanup; safe to delete.

## Future cleanup candidates (low priority, not urgent)

- `shared/schema.ts` `syncQueue` table + `SyncQueueItem`/`InsertSyncQueue` types
  — table is unreferenced by any handler after Sweep 2. Drop only if a future
  schema migration is being done anyway (per schema decision: not worth its
  own migration).
- Confirm `import-mstodo.ts` script is still occasionally run; if retired,
  `appendSyncLog`, `getMsTodoListByMsId`, `upsertMsTodoList`, `syncLog`,
  `msTodoLists` all become dead code in one further sweep.

## Cron context (already done in Phase 1)

Four crons in this thread, replacing four old crons in the previous thread:

- `51e88e18` — calendar refresh (06:00 + 18:00 AEST)
- `31f13a59` — daily morning briefing (06:00 AEST)
- `3f8b835c` — weekly review (Sun 18:30 AEST)
- `a6c5cc04` — Outlook + Capture bridge (every 2h, 06:00–22:00 AEST,
  reads from `Inbox_Braindump` MS To Do list)

Old crons (still in previous thread, awaiting deletion):
`3f164f99`, `439fe8f7`, `a54bd4f0`, `fc8f3f3c`.
