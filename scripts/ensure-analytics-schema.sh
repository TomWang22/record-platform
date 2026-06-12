#!/usr/bin/env bash
# Apply analytics schema to database 'analytics' on port 5439 (canonical RP backup target).
# Requires postgres-analytics up: record-platform-postgres-analytics-1 on host port 5439
# Usage: PGPASSWORD=postgres ./scripts/ensure-analytics-schema.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SQL="$REPO_ROOT/infra/db/01-analytics-schema.sql"
PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5439}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

if [[ ! -f "$SQL" ]]; then
  echo "ERROR: $SQL not found" >&2
  exit 1
fi
if ! psql -h "$PGHOST" -p "$PGPORT" -U postgres -d analytics -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "ERROR: Cannot connect to analytics at $PGHOST:$PGPORT. Start postgres-analytics." >&2
  exit 1
fi
psql -h "$PGHOST" -p "$PGPORT" -U postgres -d analytics -v ON_ERROR_STOP=1 -f "$SQL"
SQL2="$REPO_ROOT/infra/db/02-analytics-projections.sql"
if [[ -f "$SQL2" ]]; then
  psql -h "$PGHOST" -p "$PGPORT" -U postgres -d analytics -v ON_ERROR_STOP=1 -f "$SQL2"
  echo "✅ Analytics projections (02) applied."
fi
SQL3="$REPO_ROOT/infra/db/03-analytics-recommendation.sql"
if [[ -f "$SQL3" ]]; then
  psql -h "$PGHOST" -p "$PGPORT" -U postgres -d analytics -v ON_ERROR_STOP=1 -f "$SQL3"
  echo "✅ Analytics recommendation (03) applied."
fi
SQL4="$REPO_ROOT/infra/db/03-analytics-outbox.sql"
if [[ -f "$SQL4" ]]; then
  psql -h "$PGHOST" -p "$PGPORT" -U postgres -d analytics -v ON_ERROR_STOP=1 -f "$SQL4"
  echo "✅ Analytics outbox (03) applied."
fi
SQL11="$REPO_ROOT/infra/db/11-analytics-ai-features.sql"
if [[ -f "$SQL11" ]]; then
  psql -h "$PGHOST" -p "$PGPORT" -U postgres -d analytics -v ON_ERROR_STOP=1 -f "$SQL11"
  echo "✅ Analytics AI features (11) applied."
fi
echo "✅ Analytics schema applied (port $PGPORT, database analytics)."