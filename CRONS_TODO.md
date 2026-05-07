# Crons to wire (orchestrator-side, after this build pass)

Three crons run in the parent agent's environment. They call the Anchor HTTP
surface (localhost:5000 inside the sandbox) and, for the sync cron, the
Microsoft To Do connector (`microsoft_todo`).

All times are Australia/Melbourne (AEST = UTC+10, AEDT = UTC+11). For cron
expressions in UTC, account for DST. The values below assume **AEST (UTC+10)**.
Re-tune when AEDT switches.

## 1. Daily 06:00 AEST briefing

**Purpose:** Ensure today's `morning_routines` row exists; fire a notification
linking to `/morning`.

- **Cron (UTC):** `0 20 * * *` (06:00 AEST = 20:00 UTC previous day)
- **Steps:**
  1. `GET http://localhost:5000/api/morning/today` (creates the row if absent)
  2. `GET http://localhost:5000/api/briefing` (warm cache)
  3. Send notification with deep link to the Anchor URL + `#/morning`
- **api_credentials:** none for the Anchor calls; whatever push channel is used
  (e.g. an internal `notify` connector) for step 3.

## 2. Weekly Sun 18:30 AEST review

**Purpose:** Summarise the week and notify.

- **Cron (UTC):** `30 8 * * 0` (Sun 18:30 AEST = Sun 08:30 UTC)
- **Steps:**
  1. `GET http://localhost:5000/api/weekly-review` → completed/dropped counts,
     adhd-tax coefficient, energy avg, reflections.
  2. `GET http://localhost:5000/api/morning/today` and additionally read the
     last 7 morning_routines rows via direct SQL or a future endpoint.
  3. Compose summary; send notification with link to `#/review`.
- **api_credentials:** none for Anchor; push channel only.

## 3. 2-hour MS To Do + inbox sync (06:00\u201322:00 AEST)

**Purpose:** Push dirty tasks, pull each enabled list, ingest inbox suggestions.

- **Cron (UTC):** `0 20,22,0,2,4,6,8,10,12 * * *` (every 2h between 06:00 and
  22:00 AEST)
- **Steps per run:**

  **Push:**
  1. `POST http://localhost:5000/api/sync/dirty-tasks` → for each
     `{ action, task, graphPayload }`:
     - `create` → `microsoft_todo.create_task(list_id=task.msTodoListId, **graphPayload)`,
       capture `id` and `@odata.etag`, then
       `POST /api/sync/mark-pushed { taskId, msTodoId, etag }`.
     - `update` → `microsoft_todo.update_task(list_id, task_id, **graphPayload)`,
       then `mark-pushed` with new etag.
     - `complete` → set `graphPayload.status="completed"`, update_task, then
       `mark-pushed`.

  **Pull:**
  2. `GET http://localhost:5000/api/mstodo/lists` → for each list with
     `enabled=1`:
     - `microsoft_todo.list_tasks(list_id=l.msListId)` → returns Graph tasks
     - `POST http://localhost:5000/api/sync/pull { listId: l.msListId, tasks }`

  **Queue drain:**
  3. `GET /api/sync/queue` → for each item where `processedAt` is null,
     execute by re-running steps 1\u20132 (already idempotent) and
     `POST /api/sync/result { queueId, ok: true }`.

  **Inbox scan:**
  4. Call `microsoft_outlook.search_email` (or equivalent) for unread mail
     since last run. For each candidate, build a `suggestedAction` payload (see
     SYNC_ORCHESTRATOR.md) and `POST /api/inbox/suggestions { items }`.

- **api_credentials:**
  - `microsoft_todo` (for tasks)
  - `microsoft_outlook` or whatever connector covers Outlook search (for
    inbox scan)
  - none for the Anchor HTTP calls

## Cron run self-logging (FOLLOW-UP REQUIRED)

The credit usage tracker (`/api/usage/cron-run`) is ready to receive run logs from
each cron task. **You need to update each orchestrator-side cron task** to POST a
run record at the end of every execution (success or failure).

Add this step at the **end of each cron task body**:

```bash
curl -s -X POST http://localhost:5000/api/usage/cron-run \
  -H "Content-Type: application/json" \
  -H "X-Anchor-Sync-Secret: $(cat /home/user/workspace/.secrets/anchor_sync_secret)" \
  -d "{
    \"cronId\": \"<id>\",
    \"cronType\": \"<type>\",
    \"startedAt\": <unix ms when run started>,
    \"endedAt\": $(date +%s)000,
    \"ok\": <true|false>,
    \"notes\": \"<optional error message>\"
  }"
```

Use these `cronId` / `cronType` values for each cron:

| Cron                        | cronId              | cronType          |
|-----------------------------|---------------------|-------------------|
| Daily 06:00 AEST briefing   | `daily_morning`     | `daily_morning`   |
| Weekly Sun 18:30 AEST       | `weekly_review`     | `weekly_review`   |
| 2-hour MS To Do + inbox sync| `two_hour_sync`     | `two_hour_sync`   |
| Calendar sync (if separate) | `calendar_sync`     | `calendar_sync`   |
| Manual agent sessions       | `agent_session`     | `agent_session`   |

The endpoint is allowlisted (no session cookie required) and protected by the
`X-Anchor-Sync-Secret` header. Logs feed into the self-calibrating credit
estimator — the more runs you log, the more accurate the estimates become.

---

## Idempotency & safety

- Anchor's pull merges by `msTodoId`. Re-pulling is safe.
- `/api/sync/mark-pushed` is safe to call repeatedly with the same id/etag.
- `/api/inbox/suggestions` does not de-duplicate by `sourceMessageId`. The
  orchestrator should track which message ids it has already submitted, e.g.
  in a tiny side-state file under `/home/user/workspace/anchor-cron-state/`.
- All endpoints respond JSON. Non-2xx should be retried up to 3 times with
  exponential backoff, then surfaced as a sync-log error via
  `POST /api/sync/result { queueId, ok: false, error }`.
