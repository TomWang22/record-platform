# file: scripts/pg_catalog_to_log.sh
#!/usr/bin/env bash
set -Eeuo pipefail

# --- required env ---
: "${NS:?export NS=record-platform}"
: "${PGURL:?export PGURL=postgresql://postgres@localhost:5432/records}"

# --- optional env/args ---
LOG_FILE="${LOG_FILE:-out/pg_catalog_$(date +%Y%m%d_%H%M%S).csv}"  # set to override
GZIP="${GZIP:-0}"                                                   # GZIP=1 to compress
CONSOLE="${CONSOLE:-1}"                                             # CONSOLE=0 to skip console print

mkdir -p "$(dirname "$LOG_FILE")"

read -r -d '' SQL_QUERY <<'SQL'
SELECT n.nspname AS schema,
       p.proname AS name,
       pg_catalog.pg_get_function_arguments(p.oid) AS args,
       l.lanname AS language,
       p.proparallel AS parallel,
       p.provolatile AS volatility
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language l ON l.oid = p.prolang
ORDER BY 1, 2;
SQL

if [[ "$CONSOLE" = "1" ]]; then
  # Why wrapped: keeps console readable without flooding ultra-wide rows.
  kubectl -n "$NS" exec -i deploy/postgres -- \
    psql "$PGURL" -X -v ON_ERROR_STOP=1 \
      -P pager=off -P border=0 -P footer=off -P format=wrapped -P "columns=${COLUMNS:-120}" <<SQL
$SQL_QUERY
SQL
fi

# Proper CSV for logs (compact, machine-friendly, quoted)
if [[ "$GZIP" = "1" ]]; then
  kubectl -n "$NS" exec -i deploy/postgres -- \
    psql "$PGURL" -X -v ON_ERROR_STOP=1 -P pager=off <<'PSQL' | gzip -c > "${LOG_FILE%.csv}.csv.gz"
\copy (
SELECT n.nspname AS schema,
       p.proname AS name,
       pg_catalog.pg_get_function_arguments(p.oid) AS args,
       l.lanname AS language,
       p.proparallel AS parallel,
       p.provolatile AS volatility
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language l ON l.oid = p.prolang
ORDER BY 1, 2
) TO STDOUT WITH CSV HEADER
PSQL
  printf 'wrote %s\n' "${LOG_FILE%.csv}.csv.gz"
else
  kubectl -n "$NS" exec -i deploy/postgres -- \
    psql "$PGURL" -X -v ON_ERROR_STOP=1 -P pager=off <<'PSQL' > "$LOG_FILE"
\copy (
SELECT n.nspname AS schema,
       p.proname AS name,
       pg_catalog.pg_get_function_arguments(p.oid) AS args,
       l.lanname AS language,
       p.proparallel AS parallel,
       p.provolatile AS volatility
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language l ON l.oid = p.prolang
ORDER BY 1, 2
) TO STDOUT WITH CSV HEADER
PSQL
  printf 'wrote %s\n' "$LOG_FILE"
fi