# Sync Orchestrator (cron-side runbook)

The Anchor webapp is intentionally token-free. It does not call Microsoft Graph
itself. Instead, an **orchestrator** (cron job, run by the parent agent) bridges
between Anchor's HTTP surface and the MS To Do connector.

## Endpoints the orchestrator uses

All endpoints are on the Anchor server. The orchestrator runs in the same
sandbox that hosts Anchor's data.db, so use base URL `http://localhost:5000`.

### 1. `POST /api/sync/dirty-tasks`

Body: `{}` (empty)

Returns:

```jsonc
{
  "tasks": [
    {
      "action": "create" | "update" | "complete",
      "task": { /* full Task row */ },
      "graphPayload": { "title": "…", "status": "notStarted", "dueDateTime": {…}? }
    }
  ]
}
```

For each entry, the orchestrator should:

- `create` → call MS Graph `POST /me/todo/lists/{task.msTodoListId}/tasks` with
  `graphPayload`. On success: read returned `id` and `@odata.etag`, then
  `POST /api/sync/mark-pushed` with `{ taskId: task.id, msTodoId, etag }`.
- `update` → `PATCH /me/todo/lists/{task.msTodoListId}/tasks/{task.msTodoId}`
  with `graphPayload`. On success, also call `mark-pushed` with the same id +
  new etag.
- `complete` → set `graphPayload.status = "completed"` and PATCH. Then
  `mark-pushed` (this clears `pendingAction` and `syncDirty`).

### 2. `POST /api/sync/mark-pushed`

Body: `{ taskId: number, msTodoId: string, etag?: string }`

Clears `syncDirty`, sets `lastSyncedAt`, sets `msTodoId` and `msTodoEtag`.

### 3. `POST /api/sync/pull`

Body: `{ listId: string, tasks: GraphTask[] }`

Hands a freshly fetched MS To Do list to the engine. Anchor will field-merge
each task by `msTodoId`, soft-delete locals missing from remote, and append a
sync-log row. Returns `{ created, updated, softDeleted }`.

### 4. `POST /api/sync/result` and `GET /api/sync/queue`

The webapp users (e.g. Settings → Sync now) enqueue requests via
`POST /api/sync/request`. The orchestrator polls `/api/sync/queue` for items
where `processedAt` is null, executes them, and reports back via
`/api/sync/result` with `{ queueId, ok, error? }`.

### 5. `POST /api/inbox/suggestions`

Body: `{ items: Suggestion[] }` where each Suggestion is:

```jsonc
{
  "sourceMessageId": "AAMkAD…",
  "subject": "Appointment confirmation \u2014 12 May",
  "fromAddress": "noreply@clinic.com.au",
  "receivedAt": 1715040000000,
  "suggestedAction": {
    "kind": "task",
    "title": "Confirm 12 May 14:00 ENT review",
    "due": "2026-05-12",
    "domain": "health",
    "estimateMinutes": 30,
    "notes": "Address: …",
    "list": "<ms list id, optional>"
  }
}
```

## Graph ↔ Anchor field mapping

| Anchor field          | MS Graph field               | Notes                                  |
| --------------------- | ---------------------------- | -------------------------------------- |
| `title`               | `title`                      | identical                              |
| `notes`               | `body.content`               | `body.contentType = "text"`            |
| `status="todo"`       | `status="notStarted"`        |                                        |
| `status="doing"`      | `status="inProgress"`        |                                        |
| `status="done"`       | `status="completed"`         |                                        |
| `status="dropped"`    | `status="completed"`         | Anchor delete → remote complete        |
| `dueAt` (unix ms)     | `dueDateTime.dateTime` + tz  | tz=`Australia/Melbourne`, time=00:00   |
| `priority="anchor"`   | `importance="high"`          | (orchestrator may set; not enforced)   |
| `msTodoId`            | `id`                         | unique per Anchor task                 |
| `msTodoEtag`          | `@odata.etag`                | for change detection                   |
| `lastSyncedAt`        | (none)                       | unix ms when Anchor last touched it    |

## Conflict resolution rule

`pullChanges` (server/sync-engine.ts) uses **last-modified-wins per field**.
If `remote.lastModifiedDateTime > local.lastSyncedAt`, the remote field
overrides. Local edits made after `lastSyncedAt` keep `syncDirty=1`, which
the next push reconciles.

## Soft-delete from remote

If a task with `msTodoId` belongs to a list and is missing from the remote
dump for that list, Anchor sets `status="dropped"` and writes a sync-log row.
Anchor never hard-deletes a task that has ever been synced.
