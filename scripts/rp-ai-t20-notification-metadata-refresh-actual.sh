#!/usr/bin/env bash
# T20.10N — Bounded notification metadata-only refresh (metadata column only).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

TARGET_USER_ID="${TARGET_USER_ID:-}"
APPLY="${APPLY:-0}"
REPORT_JSON="${REPORT_JSON:-$REPO_ROOT/bench_logs/ai-platform/t20-10n-notification-metadata-refresh-actual.json}"
REPORT_MD="${REPORT_MD:-$REPO_ROOT/bench_logs/ai-platform/t20-10n-notification-metadata-refresh-actual.md}"

export TARGET_USER_ID APPLY REPORT_JSON REPORT_MD
export PGHOST="${PGHOST:-127.0.0.1}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

if [[ -z "$TARGET_USER_ID" ]]; then
  echo "ERROR: TARGET_USER_ID is required" >&2
  exit 2
fi

echo "=== T20.10N notification metadata-only refresh ==="
echo "TARGET_USER_ID=${TARGET_USER_ID}"
echo "APPLY=${APPLY} (set APPLY=1 for actual writes)"

node "$SCRIPT_DIR/rp-ai-t20-notification-metadata-refresh-actual.mjs"
