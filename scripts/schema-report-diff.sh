#!/usr/bin/env bash
# Run diff between the two schema reports and write to docs/CURRENT_DB_SCHEMA_REPORT_diff.txt.
# Normalizes the "Generated: ..." timestamp line so only structural differences appear (timestamp-only diff → 0 lines).
# Exits 0 so pipelines don't fail.
#
# Usage: ./scripts/schema-report-diff.sh
#   BASE=docs/CURRENT_DB_SCHEMA_REPORT.md           (default)
#   AFTER=docs/CURRENT_DB_SCHEMA_REPORT_after_restore.md  (default)
#   OUT=docs/CURRENT_DB_SCHEMA_REPORT_diff.txt      (default)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

BASE="${BASE:-docs/CURRENT_DB_SCHEMA_REPORT.md}"
AFTER="${AFTER:-docs/CURRENT_DB_SCHEMA_REPORT_after_restore.md}"
OUT="${OUT:-docs/CURRENT_DB_SCHEMA_REPORT_diff.txt}"

if [[ ! -f "$BASE" ]]; then
  echo "Baseline not found: $BASE. Run: PGPASSWORD=postgres ./scripts/inspect-external-db-schemas.sh $BASE" >&2
  exit 1
fi
if [[ ! -f "$AFTER" ]]; then
  echo "After-restore report not found: $AFTER. Run: PGPASSWORD=postgres ./scripts/inspect-external-db-schemas.sh $AFTER" >&2
  exit 1
fi

# Normalize "Generated: ..." line so timestamp-only diff shows as no diff
norm_base=$(mktemp)
norm_after=$(mktemp)
trap 'rm -f "$norm_base" "$norm_after"' EXIT
sed -E 's/^Generated: .+ — run .+ to refresh\.$/Generated: (normalized) — run ... to refresh./' "$BASE"  > "$norm_base"
sed -E 's/^Generated: .+ — run .+ to refresh\.$/Generated: (normalized) — run ... to refresh./' "$AFTER" > "$norm_after"

diff -u "$norm_base" "$norm_after" > "$OUT" || true
lines=$(wc -l < "$OUT" | tr -d ' ')
echo "Wrote $OUT ($lines lines)"
[[ "$lines" -eq 0 ]] && echo "No structural differences (schemas match)."
exit 0
