#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib.sh
source "$SCRIPT_DIR/lib.sh"

CSV="${1:-records.csv}"  # local path to CSV
CHUNK_DIR="${CSV%.csv}_chunks"

FILES=()
if [[ -d "$CHUNK_DIR" ]]; then
  while IFS= read -r path; do
    FILES+=("$path")
  done < <(find "$CHUNK_DIR" -maxdepth 1 -type f -name '*.csv' | sort)
fi

if [[ ${#FILES[@]} -eq 0 ]]; then
  FILES=("$CSV")
fi

pod="$(get_pod)"
echo "-> using pod: $pod"

echo "-> truncating tables"
psql_in <<'SQL'
\set ON_ERROR_STOP on
SET client_encoding = 'UTF8';
TRUNCATE records.records RESTART IDENTITY CASCADE;
TRUNCATE records.aliases RESTART IDENTITY CASCADE;
SQL

for file in "${FILES[@]}"; do
  abs="$(cd "$(dirname "$file")" && pwd)/$(basename "$file")"
  echo "-> copying chunk: $abs"
  kubectl -n "$NS" cp "$abs" "$pod:/tmp/chunk.csv" -c db

  psql_in <<'SQL'
\set ON_ERROR_STOP on
SET client_encoding = 'UTF8';
BEGIN;

CREATE TEMP TABLE uu(uid uuid);
COPY uu (uid)
FROM PROGRAM $$cut -d, -f1 /tmp/chunk.csv | tail -n +2 | sort -u$$;

INSERT INTO auth.users(id, email)
SELECT uid, ('import+'||uid::text||'@local')::citext
FROM uu u
ON CONFLICT (id) DO NOTHING;

COPY records.records(
  user_id,artist,name,format,catalog_number,notes,
  purchased_at,price_paid,record_grade,sleeve_grade,
  release_year,release_date,pressing_year,label,label_code,
  has_insert,has_booklet,has_obi_strip,has_factory_sleeve,is_promo
)
FROM '/tmp/chunk.csv' CSV HEADER;

COMMIT;
SQL

  kubectl -n "$NS" exec "$pod" -c db -- rm -f /tmp/chunk.csv
done

echo "-> refreshing stats + materialized views"
psql_in <<'SQL'
\set ON_ERROR_STOP on
ANALYZE records.records;
DO $$
BEGIN
  IF to_regclass('records.aliases_mv')    IS NOT NULL THEN EXECUTE 'REFRESH MATERIALIZED VIEW records.aliases_mv';    END IF;
  IF to_regclass('records.search_doc_mv') IS NOT NULL THEN EXECUTE 'REFRESH MATERIALIZED VIEW records.search_doc_mv'; END IF;
END$$;
SQL

echo "-> row count:"
psql_in -c "SELECT to_char(count(*), '9,999,999') AS rows FROM records.records;"
