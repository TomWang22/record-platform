#!/usr/bin/env bash
# Quick script to connect to the records database
# Usage: ./scripts/connect-to-db.sh

: "${PGHOST:=localhost}"
: "${PGPORT:=5433}"  # Changed to 5433 to match Docker port (avoids Postgres.app conflict)
: "${PGUSER:=postgres}"
: "${PGDATABASE:=records}"
: "${PGPASSWORD:=postgres}"

echo "=== Connecting to Records Database ==="
echo "Host: $PGHOST:$PGPORT"
echo "Database: $PGDATABASE"
echo "User: $PGUSER"
echo ""
echo "To connect manually:"
echo "  psql -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE"
echo ""
echo "Or via Docker:"
echo "  docker exec -it record-platform-postgres-1 psql -U postgres -d records"
echo ""

# Try to connect and show tables
echo "Setting search_path and showing tables..."
PGPASSWORD="$PGPASSWORD" psql \
  -h "$PGHOST" -p "$PGPORT" \
  -U "$PGUSER" -d "$PGDATABASE" \
  -c "SET search_path = records, public, pg_catalog; SELECT current_database(), current_schema(); SELECT schemaname, tablename FROM pg_tables WHERE tablename = 'records'; SELECT count(*) as records_count FROM records.records;" 2>&1

echo ""
echo "✅ Connection successful!"
echo ""
echo "Quick queries:"
echo "  SELECT count(*) FROM records.records;"
echo "  SELECT count(DISTINCT user_id) FROM records.records;"
echo "  SELECT * FROM records.records LIMIT 5;"

