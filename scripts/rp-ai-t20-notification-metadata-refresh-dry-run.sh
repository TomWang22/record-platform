#!/usr/bin/env bash
# T20.10M — Bounded notification metadata refresh dry-run (read-only).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

TARGET_USER_ID="${TARGET_USER_ID:-2ed75568-7deb-4c29-91b0-6919f24a0c9f}"
REPORT_JSON="${REPORT_JSON:-$REPO_ROOT/bench_logs/ai-platform/t20-10m-notification-metadata-refresh-dry-run.json}"
REPORT_MD="${REPORT_MD:-$REPO_ROOT/bench_logs/ai-platform/t20-10m-notification-metadata-refresh-dry-run.md}"

export TARGET_USER_ID REPORT_JSON REPORT_MD
export PGHOST="${PGHOST:-127.0.0.1}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

echo "=== T20.10M notification metadata refresh dry-run (read-only) ==="
echo "TARGET_USER_ID=${TARGET_USER_ID}"

node "$SCRIPT_DIR/rp-ai-t20-notification-metadata-refresh-dry-run.mjs"
