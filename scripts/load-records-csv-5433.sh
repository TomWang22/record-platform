#!/usr/bin/env bash
# Load records from CSV (or records_chunks/*.csv) into external Postgres 5433/records.
# Requires: psql, PGPASSWORD, Postgres on localhost:5433. Schema must exist (run ensure-records-schema-on-5433.sh and ensure-all-schemas-and-tuning.sh first).
#
# Usage:
#   ./scripts/load-records-csv-5433.sh                          # load records_chunks/chunk_001.csv (or single file)
#   ./scripts/load-records-csv-5433.sh path/to/file.csv
#   ./scripts/load-records-csv-5433.sh records_chunks             # load all CSV in directory (sorted)

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

PORT="${PGPORT_RECORDS:-5433}"
DB=records
PGHOST="${PGHOST:-127.0.0.1}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
# CSV: user_id,artist,name,format,catalog_number,notes,purchased_at,price_paid,record_grade,sleeve_grade,release_year,release_date,pressing_year,label,label_code,has_insert,has_booklet,has_obi_strip,has_factory_sleeve,is_promo

INPUT="${1:-}"
if [[ -z "$INPUT" ]]; then
  CHUNK_DIR="$REPO_ROOT/records_chunks"
  if [[ -d "$CHUNK_DIR" ]]; then
    FILES=("$CHUNK_DIR"/*.csv)
  else
    FILES=("$REPO_ROOT/records_chunks/chunk_001.csv")
  fi
elif [[ -d "$INPUT" ]]; then
  FILES=("$INPUT"/*.csv)
else
  FILES=("$INPUT")
fi

if ! PGCONNECT_TIMEOUT=3 PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PORT" -U postgres -d postgres -tAc "SELECT 1" 2>/dev/null | grep -q 1; then
  echo "Postgres on $PORT not reachable." >&2
  exit 1
fi

# Load one CSV in a single psql session: ensure users, staging table, COPY, INSERT
load_one() {
  local f="$1"
  [[ ! -f "$f" ]] && return 1
  echo "-> Loading $(basename "$f") ..."
  {
    echo "SET client_encoding = 'UTF8';"
    echo "DROP TABLE IF EXISTS public._load_uu CASCADE; CREATE TABLE public._load_uu (uid uuid);"
  } | PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1
  cut -d, -f1 "$f" | tail -n +2 | sort -u | PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 -c "COPY public._load_uu (uid) FROM STDIN"
  PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 -c "INSERT INTO auth.users (id, email) SELECT uid, ('import+'||uid::text||'@local')::citext FROM public._load_uu ON CONFLICT (id) DO NOTHING; DROP TABLE public._load_uu;"
  {
    echo "SET client_encoding = 'UTF8';"
    echo "DROP TABLE IF EXISTS public._staging_records CASCADE;"
    echo "CREATE TABLE public._staging_records ("
    echo "  user_id text, artist text, name text, format text, catalog_number text, notes text,"
    echo "  purchased_at text, price_paid text, record_grade text, sleeve_grade text,"
    echo "  release_year text, release_date text, pressing_year text, label text, label_code text,"
    echo "  has_insert text, has_booklet text, has_obi_strip text, has_factory_sleeve text, is_promo text"
    echo ");"
  } | PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1
  cat "$f" | PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 -c "COPY public._staging_records FROM STDIN CSV HEADER"
  PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO records.records (
  user_id, artist, name, format, catalog_number, notes,
  purchased_at, price_paid, record_grade, sleeve_grade,
  release_year, release_date, pressing_year, label, label_code,
  has_insert, has_booklet, has_obi_strip, has_factory_sleeve, is_promo
)
SELECT
  user_id::uuid, artist, name, format, catalog_number, NULLIF(notes,''),
  NULLIF(purchased_at,'')::date, NULLIF(price_paid,'')::numeric(10,2), record_grade, sleeve_grade,
  NULLIF(release_year,'')::integer, NULLIF(release_date,'')::timestamptz, NULLIF(pressing_year,'')::integer,
  NULLIF(label,''), NULLIF(label_code,''),
  NULLIF(has_insert,'') IN ('True','true','t','1','yes'),
  NULLIF(has_booklet,'') IN ('True','true','t','1','yes'),
  NULLIF(has_obi_strip,'') IN ('True','true','t','1','yes'),
  NULLIF(has_factory_sleeve,'') IN ('True','true','t','1','yes'),
  NULLIF(is_promo,'') IN ('True','true','t','1','yes')
FROM public._staging_records;
DROP TABLE public._staging_records;
SQL
}

# Optional: truncate first (uncomment to replace all data)
# psql -h "$PGHOST" -p "$PORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 -c "TRUNCATE records.records RESTART IDENTITY CASCADE;"

for f in "${FILES[@]}"; do
  [[ -f "$f" ]] || continue
  load_one "$f" || { echo "Failed: $f" >&2; exit 1; }
done

PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 -c "ANALYZE records.records;"
echo "-> Row count: $(PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PORT" -U postgres -d "$DB" -tAc "SELECT to_char(count(*), '9,999,999') FROM records.records;")"
