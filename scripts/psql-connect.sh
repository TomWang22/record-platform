#!/usr/bin/env bash
# Interactive psql connection with correct search_path
# Usage: ./scripts/psql-connect.sh

: "${PGHOST:=localhost}"
: "${PGPORT:=5433}"
: "${PGUSER:=postgres}"
: "${PGDATABASE:=records}"
: "${PGPASSWORD:=postgres}"

echo "=== Connecting to Records Database ==="
echo "Host: $PGHOST:$PGPORT"
echo "Database: $PGDATABASE"
echo ""
echo "💡 Tip: Use \dt records.* to see tables in records schema"
echo "   Or: SET search_path = records, public; then \dt"
echo ""

# Connect with search_path set
PGPASSWORD="$PGPASSWORD" psql \
  -h "$PGHOST" -p "$PGPORT" \
  -U "$PGUSER" -d "$PGDATABASE" \
  -v ON_ERROR_STOP=0 \
  -c "SET search_path = records, public, pg_catalog; SELECT '✅ Connected! Schema: ' || current_schema() || ', Database: ' || current_database();" \
  "$@"

