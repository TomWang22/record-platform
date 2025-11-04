#!/usr/bin/env bash
set -euo pipefail
NS=${NS:-record-platform}
PGURL=${PGURL:-'postgresql://postgres:postgres@localhost:5432/postgres'}

echo "==> Enabling track_io_timing at cluster level (ALTER SYSTEM)…"
kubectl -n "$NS" exec -i deploy/postgres -- psql "$PGURL" -v ON_ERROR_STOP=1 <<'SQL'
ALTER SYSTEM SET track_io_timing = on;
SELECT pg_reload_conf();
SHOW track_io_timing;
SQL

# Now ANALYZE app tables as a superuser (use your admin URL here if different)
APPURL=${APPURL:-'postgresql://postgres:postgres@localhost:5432/records'}
echo
echo "==> ANALYZE app tables (as superuser)…"
kubectl -n "$NS" exec -i deploy/postgres -- psql "$APPURL" -v ON_ERROR_STOP=1 <<'SQL'
ANALYZE records.records;
ANALYZE records.record_media;
ANALYZE records.records_staging;
ANALYZE records.record_aliases;
ANALYZE records.aliases_mv;
ANALYZE records.search_terms;
SQL
