#!/usr/bin/env bash
# Warm Anchor's weekly-review payload. Runs Sundays 18:25 local.
# Migrated from Perplexity cron 67fb0e91 on 2026-05-12 (Stage 12b).
set -euo pipefail

# shellcheck disable=SC2034  # JOB_TAG is read by _warm_lib.sh after sourcing
JOB_TAG="anchor-warm-weekly-review"

# shellcheck source=ops/jobs/_warm_lib.sh
. "$(dirname "$0")/_warm_lib.sh"

warm_run "weekly_review" \
  "$ANCHOR_BASE/api/weekly-review" "weekly-review" \
  "$ANCHOR_BASE/api/morning/today" "morning/today"
