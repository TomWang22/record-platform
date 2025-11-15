#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib.sh
source "$SCRIPT_DIR/../lib.sh"

: "${NS:=record-platform}"
: "${DB:=records}"

pod="$(get_pod)"
echo "-> using pod: $pod  ns: $NS  db: $DB"

echo "== Disk usage =="
psql_in -c "
SELECT 
  pg_size_pretty(pg_database_size('$DB')) AS database_size,
  pg_size_pretty(sum(pg_total_relation_size(schemaname||'.'||tablename))) AS tables_size
FROM pg_tables 
WHERE schemaname NOT IN ('pg_catalog', 'information_schema');
"

echo ""
echo "== Filesystem usage =="
bash_in "df -h /var/lib/postgresql/data /wal-archive 2>/dev/null || df -h /var/lib/postgresql/data"

echo ""
echo "== WAL archive usage =="
bash_in "du -sh /wal-archive 2>/dev/null || echo 'WAL archive not mounted'"

echo ""
echo "== Top 10 largest tables =="
psql_in -c "
SELECT 
  schemaname||'.'||tablename AS table_name,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables 
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
LIMIT 10;
"

