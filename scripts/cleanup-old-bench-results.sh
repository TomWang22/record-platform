#!/usr/bin/env bash
set -euo pipefail

# Clean up old benchmark results and logs to free disk space
# Usage: ./scripts/cleanup-old-bench-results.sh [days] [--dry-run]

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DAYS="${1:-7}"  # Default: keep last 7 days
DRY_RUN="${2:-}"

if [[ "$DRY_RUN" == "--dry-run" ]]; then
  echo "🔍 DRY RUN: Would delete files older than $DAYS days"
  echo ""
  echo "Benchmark CSVs:"
  find bench_logs/ -name "*.csv" -type f -mtime +$DAYS -ls 2>/dev/null | wc -l | xargs echo "  Files to delete:"
  echo ""
  echo "Benchmark logs:"
  find bench_logs/ -name "*.txt" -type f -mtime +$DAYS -ls 2>/dev/null | wc -l | xargs echo "  Files to delete:"
  echo ""
  echo "Benchmark PNGs:"
  find bench_logs/ -name "*.png" -type f -mtime +$DAYS -ls 2>/dev/null | wc -l | xargs echo "  Files to delete:"
  echo ""
  echo "Old benchmark directories:"
  find bench_logs/ -type d -mtime +$DAYS -ls 2>/dev/null | wc -l | xargs echo "  Directories to delete:"
  exit 0
fi

echo "🧹 Cleaning up benchmark results older than $DAYS days..."

# Count files before
BEFORE_CSV=$(find bench_logs/ -name "*.csv" -type f 2>/dev/null | wc -l | tr -d ' ')
BEFORE_TXT=$(find bench_logs/ -name "*.txt" -type f 2>/dev/null | wc -l | tr -d ' ')
BEFORE_PNG=$(find bench_logs/ -name "*.png" -type f 2>/dev/null | wc -l | tr -d ' ')

# Delete old files
DELETED_CSV=$(find bench_logs/ -name "*.csv" -type f -mtime +$DAYS -delete -print 2>/dev/null | wc -l | tr -d ' ')
DELETED_TXT=$(find bench_logs/ -name "*.txt" -type f -mtime +$DAYS -delete -print 2>/dev/null | wc -l | tr -d ' ')
DELETED_PNG=$(find bench_logs/ -name "*.png" -type f -mtime +$DAYS -delete -print 2>/dev/null | wc -l | tr -d ' ')
DELETED_DIRS=$(find bench_logs/ -type d -empty -mtime +$DAYS -delete -print 2>/dev/null | wc -l | tr -d ' ')

echo "✅ Cleanup complete:"
echo "  Deleted $DELETED_CSV CSV files (kept $((BEFORE_CSV - DELETED_CSV)))"
echo "  Deleted $DELETED_TXT text files (kept $((BEFORE_TXT - DELETED_TXT)))"
echo "  Deleted $DELETED_PNG PNG files (kept $((BEFORE_PNG - DELETED_PNG)))"
echo "  Deleted $DELETED_DIRS empty directories"

# Also clean up old bench.results rows if needed
echo ""
echo "💡 Tip: To clean up old bench.results rows in the database, run:"
echo "   PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d records -c \"DELETE FROM bench.results WHERE ts_utc < now() - interval '${DAYS} days';\""

