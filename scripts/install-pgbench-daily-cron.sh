#!/usr/bin/env bash
# Print or install a crontab entry to run daily pgbench (all 8 DBs, deep, with result collection).
#
# Usage:
#   ./scripts/install-pgbench-daily-cron.sh           # print crontab line and instructions
#   ./scripts/install-pgbench-daily-cron.sh --install  # append to user crontab (backup first)
#
# Default schedule: 05:00 local (run daily pgbench; adjust if you prefer a different hour).
# Results: PGBENCH_RESULTS_PARENT/daily-pgbench-<timestamp>/ (default parent: /tmp).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Default 5 AM daily; override with PGBENCH_CRON_SCHEDULE (e.g. "0 6 * * *" for 6 AM)
CRON_SCHEDULE="${PGBENCH_CRON_SCHEDULE:-0 5 * * *}"
DAILY_SCRIPT="$REPO_ROOT/scripts/run-daily-pgbench-standalone-with-results.sh"
PARENT="${PGBENCH_RESULTS_PARENT:-/tmp}"

CRON_LINE="$CRON_SCHEDULE PGBENCH_RESULTS_PARENT=$PARENT $DAILY_SCRIPT"

echo "Daily pgbench cron"
echo "  Schedule: $CRON_SCHEDULE (5 AM local)"
echo "  Script:   $DAILY_SCRIPT"
echo "  Results:  $PARENT/daily-pgbench-<timestamp>/"
echo ""
echo "Crontab line:"
echo "  $CRON_LINE"
echo ""

if [[ "${1:-}" == "--install" ]]; then
  if [[ ! -x "$DAILY_SCRIPT" ]]; then
    echo "❌ Script not executable: $DAILY_SCRIPT (chmod +x it first)"
    exit 1
  fi
  ( crontab -l 2>/dev/null || true; echo "$CRON_LINE" ) | crontab -
  echo "✅ Appended to crontab. Verify with: crontab -l"
else
  echo "To install: ./scripts/install-pgbench-daily-cron.sh --install"
  echo "Prereq: Postgres 5433–5440 up (e.g. docker-compose); migrations applied."
fi
