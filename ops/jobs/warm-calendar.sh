#!/usr/bin/env bash
# Warm Anchor's calendar cache. Runs twice daily (05:55 + 17:55 local).
# Migrated from Perplexity cron b4a58a27 on 2026-05-12 (Stage 12b).
set -euo pipefail

# shellcheck disable=SC2034  # JOB_TAG is read by _warm_lib.sh after sourcing
JOB_TAG="anchor-warm-calendar"

# shellcheck source=ops/jobs/_warm_lib.sh
. "$(dirname "$0")/_warm_lib.sh"

warm_run "calendar_sync" \
  "$ANCHOR_BASE/api/calendar-events?days=14" "calendar-events" \
  "$ANCHOR_BASE/api/today-events"            "today-events"
