#!/usr/bin/env bash
# Shared helpers for Anchor warm-cache cron jobs running on the VPS.
#
# Sourced (not executed) by the per-job wrappers in this directory. Each
# wrapper sets a small amount of config then calls warm_run.
#
# Provides:
#   warm_init        — load secret, set BASE, AUTH_HDR, START
#   warm_get  <url> <label>     — GET with auth, log status (best-effort)
#   warm_self_log <cronType> <ok> [notes]
#                    — POST a /api/usage/cron-run record
#   warm_run <cronType> <get1_url> <get1_label> [<get2_url> <get2_label>] ...
#                    — full pattern: warm_init, hit each URL, self-log.
#
# Conventions:
#   - All output goes to stdout/stderr (journalctl picks it up).
#   - Never echo the secret value.
#   - Best-effort: a failed warm GET still counts as a successful run as
#     long as we self-logged. The receipt-verifier cron cares about staleness,
#     not transient 5xx on a warm endpoint.

set -uo pipefail

ANCHOR_BASE="${ANCHOR_BASE:-https://anchor.thinhalo.com}"
ANCHOR_SECRET_FILE="${ANCHOR_SECRET_FILE:-/opt/anchor/.secrets/anchor_sync_secret}"

log() { printf '[%s] [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${JOB_TAG:-anchor-warm}" "$*"; }
die() { log "FAIL: $*"; exit 1; }

warm_init() {
  [ -r "$ANCHOR_SECRET_FILE" ] || die "secret file missing: $ANCHOR_SECRET_FILE"
  SECRET=$(cat "$ANCHOR_SECRET_FILE")
  [ -n "$SECRET" ] || die "secret file empty: $ANCHOR_SECRET_FILE"
  AUTH_HDR="X-Anchor-Sync-Secret: $SECRET"
  START_MS=$(($(date +%s) * 1000))
  log "init: BASE=$ANCHOR_BASE (secret ${#SECRET} bytes)"
}

# Usage: warm_get URL LABEL
warm_get() {
  local url="$1" label="$2"
  local code
  code=$(curl -sS --max-time 60 -H "$AUTH_HDR" "$url" -o /dev/null -w '%{http_code}' || echo 'curl-err')
  log "  $label: HTTP $code"
  case "$code" in
    2*) return 0 ;;
    *) return 1 ;;
  esac
}

# Usage: warm_self_log CRON_TYPE OK [NOTES]
warm_self_log() {
  local cron_type="$1" ok="$2" notes="${3:-}"
  local end_ms
  end_ms=$(($(date +%s) * 1000))

  # Build JSON safely with python3 (avoids shell-quoting headaches if notes
  # ever contains a quote, paren, etc).
  local payload
  payload=$(CRON_TYPE="$cron_type" OK="$ok" NOTES="$notes" START="$START_MS" END="$end_ms" \
            python3 -c 'import json,os; print(json.dumps({
              "cronId": os.environ["CRON_TYPE"],
              "cronType": os.environ["CRON_TYPE"],
              "startedAt": int(os.environ["START"]),
              "endedAt":   int(os.environ["END"]),
              "ok":        os.environ["OK"] == "true",
              **({"notes": os.environ["NOTES"]} if os.environ["NOTES"] else {}),
            }))')

  local code
  code=$(curl -sS --max-time 15 -X POST "$ANCHOR_BASE/api/usage/cron-run" \
           -H 'Content-Type: application/json' \
           -H "$AUTH_HDR" \
           -d "$payload" \
           -o /dev/null -w '%{http_code}' || echo 'curl-err')
  log "  self-log [$cron_type ok=$ok]: HTTP $code"
}

# Usage: warm_run CRON_TYPE URL1 LABEL1 [URL2 LABEL2 ...]
warm_run() {
  local cron_type="$1"; shift
  warm_init
  local all_ok=true
  while [ $# -ge 2 ]; do
    if ! warm_get "$1" "$2"; then
      all_ok=false
    fi
    shift 2
  done
  if $all_ok; then
    warm_self_log "$cron_type" "true"
    log "OK"
  else
    warm_self_log "$cron_type" "false" "one or more warm GETs returned non-2xx"
    log "OK (some warm GETs failed — see above; self-log recorded ok=false)"
  fi
}
