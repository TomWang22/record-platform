#!/usr/bin/env bash
set -Euo pipefail

usage() {
  cat <<USAGE
Usage: ${0##*/} [options]
  -p, --pod NAME           Postgres pod name (default: autodetect)
  -n, --namespace NS       Kubernetes namespace (default: record-platform)
  -u, --user UUID          Tenant UUID to benchmark (default: 0dc268d0-a86f-4e12-8d10-9db0f1b735e0)
  -q, --query TEXT         Search query string (default: "鄧麗君 album 263 cn-041 polygram")
  -d, --duration SEC       Duration per benchmark run (default: 60)
  -c, --clients LIST       Comma-separated client counts (default: 8,16,24,32,48,64)
  -t, --threads N          Worker threads (default: 12)
  -l, --limit N            LIMIT value for queries (default: 50)
  --pgoptions OPTS         Extra PGOPTIONS (default: '-c jit=off -c random_page_cost=1.0 -c cpu_index_tuple_cost=0.0005 -c cpu_tuple_cost=0.01')
  -h, --help               Show this help
USAGE
}

NS="record-platform"
POD=""
USER_UUID="0dc268d0-a86f-4e12-8d10-9db0f1b735e0"
QUERY='鄧麗君 album 263 cn-041 polygram'
DURATION=60
CLIENTS="8,16,24,32,48,64"
# Note: Can reduce to "8,16,24,32" for faster runs
THREADS=12 # Keep at 12 for consistency with gold run
LIMIT=50   # Keep at 50 for consistency with gold run
PGOPTIONS_EXTRA="-c jit=off -c enable_seqscan=off -c random_page_cost=1.0 \
  -c cpu_index_tuple_cost=0.0005 -c cpu_tuple_cost=0.01 \
  -c effective_cache_size=8GB -c work_mem=256MB \
  -c track_io_timing=on -c max_parallel_workers=12 \
  -c max_parallel_workers_per_gather=4 -c maintenance_work_mem=1GB \
  -c pg_trgm.similarity_threshold=${TRGM_THRESHOLD}"


# TRGM tuning: similarity threshold used by trgm / trgm_simple
TRGM_THRESHOLD="${TRGM_THRESHOLD:-0.30}"  # tweak this to 0.2–0.4 as you experiment

while [[ $# -gt 0 ]]; do
  case "$1" in
    -n|--namespace) NS="$2"; shift 2 ;;
    -p|--pod) POD="$2"; shift 2 ;;
    -u|--user) USER_UUID="$2"; shift 2 ;;
    -q|--query) QUERY="$2"; shift 2 ;;
    -d|--duration) DURATION="$2"; shift 2 ;;
    -c|--clients) CLIENTS="$2"; shift 2 ;;
    -t|--threads) THREADS="$2"; shift 2 ;;
    -l|--limit) LIMIT="$2"; shift 2 ;;
    --pgoptions) PGOPTIONS_EXTRA="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

# Resolve script_dir and repo root robustly: repo root = parent of this script
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$script_dir/.." && pwd)"

QUERY_LITERAL=$(printf "%s" "$QUERY" | sed "s/'/''/g")
PG_QUERY_ARG="'$QUERY_LITERAL'"

# Find a pod to run pgbench from (can be any pod with pgbench, or use local pgbench)
# Since Postgres is now external, we don't need the postgres pod specifically
USE_LOCAL_PGBENCH=false
if [[ -z "$POD" ]]; then
  # Try to find any pod that might have pgbench (postgres pod, or any pod)
  POD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' | awk 'NR==1{print $1}')
fi
if [[ -z "$POD" ]]; then
  # Try any running pod in the namespace
  POD=$(kubectl -n "$NS" get pod --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
fi
if [[ -z "$POD" ]]; then
  # Check if pgbench is available locally
  if command -v pgbench >/dev/null 2>&1; then
    echo "⚠️  No pod found in namespace $NS - will run pgbench locally" >&2
    echo "   Postgres is external (Docker), connecting to localhost:5432" >&2
    USE_LOCAL_PGBENCH=true
  else
    echo "❌ No pod found and pgbench not installed locally" >&2
    echo "   Please either:" >&2
    echo "   1. Install pgbench locally: brew install postgresql@16" >&2
    echo "   2. Or ensure a pod is running in namespace $NS" >&2
    exit 1
  fi
else
  echo "Using pod: $POD (namespace: $NS) for running pgbench"
fi

# CRITICAL: Helper function for psql - always uses the same DSN as pgbench
# Canonical external Postgres endpoint: localhost:5432
# This ensures psql_in_pod and pgbench connect to the SAME database
psql_in_pod() {
  : "${PGHOST:=localhost}"
  : "${PGPORT:=5432}"
  : "${PGUSER:=postgres}"
  : "${PGDATABASE:=records}"
  : "${PGPASSWORD:=postgres}"

  PGPASSWORD="$PGPASSWORD" psql \
    -h "$PGHOST" -p "$PGPORT" \
    -U "$PGUSER" -d "$PGDATABASE" \
    -X -P pager=off "$@"
}

# Force local pgbench when pgbench is available locally
# This ensures we use the same connection method (localhost:5432) for everything
if command -v pgbench >/dev/null 2>&1; then
  echo "✅ Using local pgbench (connecting to localhost:5432)"
  USE_LOCAL_PGBENCH=true
  POD=""
fi

# NOTE: Function creation moved to AFTER database restore check
# This ensures the function is created on the correct database

tmpdir=$(mktemp -d)
# On exit, always cd back to the repo root first so $tmpdir can be safely removed
trap 'cd "'"$REPO_ROOT"'" 2>/dev/null || true; rm -rf "$tmpdir"' EXIT

cat <<'SQL' > "$tmpdir/prepare.sql"
SET search_path = records, public;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pg_prewarm;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
SQL

cat <<'SQL' > "$tmpdir/prepare_table.sql"
SET search_path = records, public;
ALTER TABLE records.records ADD COLUMN IF NOT EXISTS search_norm text;
UPDATE records.records
  SET search_norm = lower(concat_ws(' ', artist, name, catalog_number))
  WHERE search_norm IS NULL;
SQL

cat <<'SQL' > "$tmpdir/create_indexes.sql"
SET search_path = records, public;
CREATE INDEX IF NOT EXISTS idx_records_partitioned_artist_trgm ON records.records USING gin (artist gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_records_partitioned_name_trgm ON records.records USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_records_partitioned_catalog_trgm ON records.records USING gin (catalog_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_records_partitioned_search_norm_gist ON records.records USING gist (search_norm gist_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_records_partitioned_search_norm_gin ON records.records USING gin (search_norm gin_trgm_ops);
ANALYZE records.records;
DO $$
DECLARE idx regclass;
BEGIN
  FOR idx IN
    SELECT c.oid
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'records'
      AND c.relkind = 'i'
      AND c.relname ~ '^records_p[0-9]{2}_(artist|name|catalog|search)_'
  LOOP
    PERFORM pg_prewarm(idx);
  END LOOP;
END
$$;
SQL

cat <<'SQL' > "$tmpdir/create_bench_schema.sql"
SET search_path = public, records;
CREATE SCHEMA IF NOT EXISTS bench;
CREATE TABLE IF NOT EXISTS bench.results (
  id bigserial PRIMARY KEY,
  ts_utc timestamptz DEFAULT now() NOT NULL,
  variant text NOT NULL,
  clients int NOT NULL,
  threads int NOT NULL,
  duration_s int NOT NULL,
  limit_rows int NOT NULL,
  tps numeric,
  lat_avg_ms numeric,
  lat_std_ms numeric,
  p50_ms numeric,
  p95_ms numeric,
  p99_ms numeric,
  p999_ms numeric,
  p9999_ms numeric,
  p100_ms numeric,
  notes text,
  git_rev text,
  git_branch text,
  host text,
  server_version text,
  track_io boolean,
  delta_blks_hit bigint,
  delta_blks_read bigint,
  delta_blk_read_ms numeric,
  delta_blk_write_ms numeric,
  delta_xact_commit bigint,
  delta_tup_returned bigint,
  delta_tup_fetched bigint,
  delta_stmt_total_ms numeric,
  delta_stmt_shared_hit bigint,
  delta_stmt_shared_read bigint,
  delta_stmt_shared_dirtied bigint,
  delta_stmt_shared_written bigint,
  delta_stmt_temp_read bigint,
  delta_stmt_temp_written bigint,
  delta_io_read_ms numeric,
  delta_io_write_ms numeric,
  delta_io_extend_ms numeric,
  delta_io_fsync_ms numeric,
  io_total_ms numeric,
  active_sessions numeric,
  cpu_share_pct numeric,
  ok_xacts bigint,
  fail_xacts bigint,
  err_pct numeric,
  delta_wal_records bigint,
  delta_wal_fpi bigint,
  delta_wal_bytes numeric,
  delta_ckpt_write_ms numeric,
  delta_ckpt_sync_ms numeric,
  delta_buf_checkpoint bigint,
  delta_buf_backend bigint,
  delta_buf_alloc bigint,
  hit_ratio_pct numeric
);
SQL

cat <<'SQL' > "$tmpdir/read_metrics.sql"
SELECT blks_hit, blks_read,
       COALESCE(blk_read_time, 0),
       COALESCE(blk_write_time, 0),
       xact_commit, tup_returned, tup_fetched
FROM pg_stat_database
WHERE datname = current_database();
SQL

# helper functions (bash)
percentile_idx() {
  awk -v p="$1" -v n="$2" 'BEGIN{
    x=p/100.0*n;
    i=int(x);
    if (x>i) i++;
    if (i<1) i=1;
    if (i>n) i=n;
    print i
  }'
}

calc_latency_metrics() {
  local lat="$1"
  local sorted="$lat.sorted"

  local N
  N=$(wc -l < "$lat" 2>/dev/null || echo 0)
  if [[ "$N" -le 0 ]]; then
    echo "NaN NaN NaN NaN NaN NaN NaN NaN"
    return
  fi

  sort -n "$lat" -o "$sorted"

  local avg std
  read -r avg std < <(awk '{
      s+=$1; ss+=$1*$1
    }
    END {
      if (NR>0) {
        m=s/NR;
        v=(ss/NR)-(m*m);
        if (v<0) v=0;
        sd=sqrt(v);
        printf "%.6f %.6f\n", m, sd
      }
    }' "$lat")

  local i50 i95 i99 i999 i9999
  i50=$(percentile_idx 50 "$N")
  i95=$(percentile_idx 95 "$N")
  i99=$(percentile_idx 99 "$N")
  i999=$(percentile_idx 99.9 "$N")
  i9999=$(percentile_idx 99.99 "$N")

  local p50 p95 p99 p999 p9999 max
  p50=$(sed -n "${i50}p" "$sorted")
  p95=$(sed -n "${i95}p" "$sorted")
  p99=$(sed -n "${i99}p" "$sorted")
  p999=$(sed -n "${i999}p" "$sorted")
  p9999=$(sed -n "${i9999}p" "$sorted")
  max=$(tail -n1 "$sorted")

  echo "$avg $std $p50 $p95 $p99 $p999 $p9999 $max"
}

# step 0: Check if database exists, restore if needed
echo "=== Checking if database exists ==="
if ! psql_in_pod -c "SELECT 1 FROM records.records LIMIT 1;" >/dev/null 2>&1; then
  echo "⚠️  Database 'records' is missing or empty, attempting restore..."
  if [[ -f "./scripts/restore-from-local-backup.sh" ]] && [[ -f "backups/records_final_20251113_060218.dump" ]]; then
    echo "Restoring from backup..."
    "$REPO_ROOT/scripts/restore-from-local-backup.sh" \
      "$REPO_ROOT/backups/records_final_20251113_060218.dump" 2>&1 | tail -10
    # Wait for restore to complete
    sleep 5
    # Verify restore
    if ! psql_in_pod -c "SELECT 1 FROM records.records LIMIT 1;" >/dev/null 2>&1; then
      echo "❌ Restore failed! Database still missing." >&2
      exit 1
    fi
    echo "✅ Database restored successfully"
  else
    echo "❌ Restore script or backup not found!" >&2
    exit 1
  fi
fi

# CRITICAL: Ensure canonical KNN function and performance tuning are applied AFTER database is ready
if [[ -x "$REPO_ROOT/scripts/optimize-db-for-performance.sh" ]]; then
  echo "=== Applying canonical DB optimizations (optimize-db-for-performance.sh) ==="
  NS="$NS" "$REPO_ROOT/scripts/optimize-db-for-performance.sh"
fi

echo "=== Ensuring clean public.record_aliases stub matching records.records.id ==="
psql_in_pod -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  id_type text;
BEGIN
  -- Drop any existing table or view; we want a known-good shape
  IF to_regclass('public.record_aliases') IS NOT NULL THEN
    EXECUTE 'DROP TABLE public.record_aliases CASCADE';
  END IF;

  -- Discover the type of records.records.id
  SELECT atttypid::regtype::text
  INTO   id_type
  FROM   pg_attribute
  WHERE  attrelid = 'records.records'::regclass
    AND  attname = 'id'
    AND  NOT attisdropped;

  IF id_type IS NULL THEN
    RAISE EXCEPTION 'Could not determine type of records.records.id';
  END IF;

  RAISE NOTICE 'Creating public.record_aliases(record_id %, term_norm text)', id_type;

  EXECUTE format(
    'CREATE TABLE public.record_aliases (
       record_id %s,
       term_norm text
     )',
    id_type
  );
END$$;

-- Show resulting schema for sanity
SELECT attname, atttypid::regtype::text AS type
FROM   pg_attribute
WHERE  attrelid = 'public.record_aliases'::regclass
  AND  attnum > 0
ORDER  BY attnum;
SQL

if [[ -x "$REPO_ROOT/scripts/create-knn-function.sh" ]]; then
  echo "=== (Re)creating canonical search_records_fuzzy_ids function ==="
  NS="$NS" "$REPO_ROOT/scripts/create-knn-function.sh"
  # Verify function was created
  if ! psql_in_pod -c "SELECT 1 FROM pg_proc WHERE proname = 'search_records_fuzzy_ids' AND pronamespace = 'public'::regnamespace AND pronargs = 4;" >/dev/null 2>&1; then
    echo "❌ Function creation failed!" >&2
    exit 1
  fi
  echo "✅ Function verified to exist"
fi

# step 0: prepare extensions and indexes
psql_in_pod < "$tmpdir/prepare.sql" >/dev/null 2>&1 || true

echo "--- pg_trgm / trigram opclass availability ---"
psql_in_pod <<'EOFSQL'
SELECT 'pg_trgm installed: ' || EXISTS (
  SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'
) AS pg_trgm;

SELECT 'has gin_trgm_ops: ' || EXISTS (
  SELECT 1 FROM pg_opclass WHERE opcname = 'gin_trgm_ops'
) AS has_gin_trgm_ops;

SELECT 'has gist_trgm_ops: ' || EXISTS (
  SELECT 1 FROM pg_opclass WHERE opcname = 'gist_trgm_ops'
) AS has_gist_trgm_ops;
EOFSQL

psql_in_pod < "$tmpdir/prepare_table.sql" >/dev/null 2>&1 || true
psql_in_pod < "$tmpdir/create_indexes.sql" >/dev/null 2>&1 || true
psql_in_pod < "$tmpdir/create_bench_schema.sql" >/dev/null 2>&1 || true

# Function and tuning are now handled by canonical scripts above

# Setup indexes and search_norm column (matching reference script)
echo "Setting up indexes and search_norm column (matching reference script)..."
psql_in_pod -v ON_ERROR_STOP=1 <<'SQL'
SET search_path = records, public;

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pg_prewarm;

-- Ensure the normalized search column exists and is populated
ALTER TABLE records.records ADD COLUMN IF NOT EXISTS search_norm text;

-- Populate missing values (one-time/online-friendly)
UPDATE records.records
SET search_norm = lower(concat_ws(' ', artist, name, catalog_number))
WHERE search_norm IS NULL;

-- Substring path (TRGM GIN) - matching reference script
DO $$
BEGIN
  BEGIN
    EXECUTE 'CREATE INDEX IF NOT EXISTS ix_records_artist_trgm
             ON records.records USING gin (artist gin_trgm_ops)';
  EXCEPTION WHEN undefined_object THEN
    RAISE NOTICE 'gin_trgm_ops not available; skipping ix_records_artist_trgm';
  END;

  BEGIN
    EXECUTE 'CREATE INDEX IF NOT EXISTS ix_records_name_trgm
             ON records.records USING gin (name gin_trgm_ops)';
  EXCEPTION WHEN undefined_object THEN
    RAISE NOTICE 'gin_trgm_ops not available; skipping ix_records_name_trgm';
  END;

  BEGIN
    EXECUTE 'CREATE INDEX IF NOT EXISTS ix_records_catalog_trgm
             ON records.records USING gin (catalog_number gin_trgm_ops)';
  EXCEPTION WHEN undefined_object THEN
    RAISE NOTICE 'gin_trgm_ops not available; skipping ix_records_catalog_trgm';
  END;

  -- NEW: GIN index that TRGM % on search_norm can use
  BEGIN
    EXECUTE 'CREATE INDEX IF NOT EXISTS ix_records_search_norm_gin
             ON records.records USING gin (search_norm gin_trgm_ops)';
  EXCEPTION WHEN undefined_object THEN
    RAISE NOTICE 'gin_trgm_ops not available; skipping ix_records_search_norm_gin';
  END;
END $$;

-- KNN path (TRGM GiST) on the real column (no expression)
DO $$
BEGIN
  BEGIN
    EXECUTE 'CREATE INDEX IF NOT EXISTS ix_records_search_norm_gist
             ON records.records USING gist (search_norm gist_trgm_ops)';
  EXCEPTION WHEN undefined_object THEN
    RAISE NOTICE 'gist_trgm_ops not available; skipping ix_records_search_norm_gist GiST index';
  END;
END $$;

ANALYZE records.records;

-- Prewarm the hot stuff
SELECT pg_prewarm('records.ix_records_artist_trgm'::regclass)
WHERE to_regclass('records.ix_records_artist_trgm') IS NOT NULL;
SELECT pg_prewarm('records.ix_records_name_trgm'::regclass)
WHERE to_regclass('records.ix_records_name_trgm') IS NOT NULL;
SELECT pg_prewarm('records.ix_records_catalog_trgm'::regclass)
WHERE to_regclass('records.ix_records_catalog_trgm') IS NOT NULL;
SELECT pg_prewarm('records.ix_records_search_norm_gist'::regclass)
WHERE to_regclass('records.ix_records_search_norm_gist') IS NOT NULL;
-- NEW:
SELECT pg_prewarm('records.ix_records_search_norm_gin'::regclass)
WHERE to_regclass('records.ix_records_search_norm_gin') IS NOT NULL;
SQL

# FORCE CLEAN: Prepare bench SQL files locally, then (optionally) copy into a pod
bench_sql_dir="$tmpdir/bench_sql"
mkdir -p "$bench_sql_dir"

echo "Generating bench SQL files locally..."
cat > "$bench_sql_dir/bench_knn.sql" <<'EOF'
SELECT count(*) FROM (
  SELECT r.id
  FROM records.records r,
       (SELECT public.norm_text(lower(:q::text)) AS qn) AS n
  WHERE r.user_id = :uid::uuid
  ORDER BY r.search_norm <-> n.qn
  LIMIT :lim::integer
) s;
EOF

# TRGM via search_records_fuzzy_ids (production-ish path)
cat > "$bench_sql_dir/bench_trgm.sql" <<'EOF'
-- search_path and similarity_threshold are set via PGOPTIONS

SELECT count(*) FROM public.search_records_fuzzy_ids(
  :uid::uuid,
  :q::text,
  :lim::bigint,
  0::bigint
);
EOF

# TRGM "simple": raw GIN+%+similarity on search_norm
cat > "$bench_sql_dir/bench_trgm_simple.sql" <<'EOF'
-- search_path and similarity_threshold are set via PGOPTIONS

WITH q AS (
  SELECT public.norm_text(lower(:q::text)) AS qn
)
SELECT count(*) FROM (
  SELECT r.id
  FROM records.records r, q
  WHERE r.user_id = :uid::uuid
    AND r.search_norm % q.qn
  ORDER BY similarity(r.search_norm, q.qn) DESC
  LIMIT :lim::integer
) s;
EOF

echo "Verifying SQL files are clean..."
if grep -q "<<<<<<<" "$bench_sql_dir/bench_knn.sql" 2>/dev/null || \
   grep -q "<<<<<<<" "$bench_sql_dir/bench_trgm.sql" 2>/dev/null || \
   grep -q "<<<<<<<" "$bench_sql_dir/bench_trgm_simple.sql" 2>/dev/null; then
  echo "FATAL ERROR: Merge conflict detected in bench SQL files!" >&2
  exit 1
fi

echo "✅ SQL files verified clean"

# If we're going to run pgbench from a Kubernetes pod, sync the SQL there now
if [[ "$USE_LOCAL_PGBENCH" != "true" ]] && [[ -n "$POD" ]]; then
  echo "Syncing bench SQL files into pod..."
  kubectl -n "$NS" exec "$POD" -c db -- bash -lc 'rm -rf /tmp/bench_sql && mkdir -p /tmp/bench_sql' >/dev/null 2>&1 || \
  kubectl -n "$NS" exec "$POD" -- bash -lc 'rm -rf /tmp/bench_sql && mkdir -p /tmp/bench_sql' >/dev/null 2>&1 || true
  kubectl -n "$NS" cp "$bench_sql_dir/." "$POD:/tmp/bench_sql" -c db >/dev/null 2>&1 || \
  kubectl -n "$NS" cp "$bench_sql_dir/." "$POD:/tmp/bench_sql" >/dev/null 2>&1 || true
fi

# Create pgbench runner script
# CRITICAL: Always use localhost:5432 to match psql_in_pod
cat <<'SH' > "$tmpdir/run_pgbench.sh"
#!/usr/bin/env bash
set -Eeuo pipefail
# Connection setup - always use localhost:5432 (same as psql_in_pod)
: "${PGHOST:=localhost}"
: "${PGPORT:=5432}"
: "${PGUSER:=postgres}"
: "${PGDATABASE:=records}"
: "${PGPASSWORD:=postgres}"
export PGPASSWORD
# Get PGOPTIONS from first arg, rest are pgbench args
if [[ $# -lt 1 ]]; then
  echo "usage: $0 <pgoptions> [pgbench args...]" >&2
  exit 1
fi
pgopts="$1"
shift
# Set PGOPTIONS to include search_path and tuning
# CRITICAL: public must be first in search_path so functions are found
# Also include pg_catalog for pg_trgm operators
export PGOPTIONS="$pgopts -c search_path=public,records,pg_catalog"

# Allow caller to choose log dir; fallback to /tmp
if [[ -n "${PGBENCH_LOG_DIR:-}" ]]; then
  cd "$PGBENCH_LOG_DIR"
else
  cd /tmp
fi

# Call pgbench with explicit connection to localhost Postgres
exec pgbench -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" "$@"
SH

# Copy script to pod if we have one, otherwise use local pgbench
if [[ "$USE_LOCAL_PGBENCH" != "true" ]] && [[ -n "$POD" ]]; then
  kubectl -n "$NS" cp "$tmpdir/run_pgbench.sh" "$POD:/tmp/run_pgbench.sh" -c db >/dev/null 2>&1 || \
  kubectl -n "$NS" cp "$tmpdir/run_pgbench.sh" "$POD:/tmp/run_pgbench.sh" >/dev/null 2>&1 || {
    echo "⚠️  Could not copy script to pod, will use local pgbench" >&2
    USE_LOCAL_PGBENCH=true
  }
  if [[ "$USE_LOCAL_PGBENCH" != "true" ]]; then
    kubectl -n "$NS" exec "$POD" -c db -- chmod +x /tmp/run_pgbench.sh >/dev/null 2>&1 || \
    kubectl -n "$NS" exec "$POD" -- chmod +x /tmp/run_pgbench.sh >/dev/null 2>&1 || true
  fi
fi

chmod +x "$tmpdir/run_pgbench.sh"

# CRITICAL: Verify objects exist BEFORE pgbench runs
echo "--- Pre-flight verification"
psql_in_pod -v ON_ERROR_STOP=1 <<'EOFSQL'
SET search_path = records, public;

-- Verify canonical function exists
DO $$
DECLARE
  func_exists boolean;
BEGIN
  SELECT EXISTS(
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'search_records_fuzzy_ids'
      AND p.pronargs = 4
      AND p.proargtypes[0] = 'uuid'::regtype::oid
      AND p.proargtypes[1] = 'text'::regtype::oid
      AND p.proargtypes[2] = 'bigint'::regtype::oid
      AND p.proargtypes[3] = 'bigint'::regtype::oid
  ) INTO func_exists;
  
  IF NOT func_exists THEN
    RAISE EXCEPTION 'Function public.search_records_fuzzy_ids(uuid, text, bigint, bigint) does not exist!';
  END IF;
  
  RAISE NOTICE '✅ Pre-flight check passed: canonical function exists';
END $$;
EOFSQL

if [[ $? -ne 0 ]]; then
  echo "FATAL: Pre-flight verification failed! Function is missing." >&2
  echo "Checking what exists..." >&2
  psql_in_pod <<'EOFSQL'
SET search_path = records, public;
SELECT n.nspname, p.proname, p.proargtypes::regtype[]::text AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname = 'search_records_fuzzy_ids'
ORDER BY n.nspname, p.oid;
EOFSQL
  exit 1
fi

echo "✅ Pre-flight verification passed"

# Sanity check: Print function definition for verification
echo "--- Verifying canonical function definition"
psql_in_pod <<'EOFSQL'
SELECT
  n.nspname,
  p.proname,
  p.proargtypes::regtype[]::text AS args,
  pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'search_records_fuzzy_ids'
  AND p.pronargs = 4;
EOFSQL

echo "--- Smoke check"
if [[ "$USE_LOCAL_PGBENCH" != "true" ]] && [[ -n "$POD" ]]; then
  for script in bench_knn.sql bench_trgm.sql bench_trgm_simple.sql; do
    echo "Testing $script..."
    if ! kubectl -n "$NS" exec "$POD" -c db -- /tmp/run_pgbench.sh "$PGOPTIONS_EXTRA" -n -M prepared -c 1 -T 2 -D uid="$USER_UUID" -D q="$PG_QUERY_ARG" -D lim="$LIMIT" -f "/tmp/bench_sql/$script" >/dev/null 2>&1; then
      echo "WARNING: pgbench smoke test failed for $script, but continuing..." >&2
    else
      echo "✓ $script smoke test passed"
    fi
  done
else
  echo "Skipping smoke tests (using local pgbench)"
fi

# CRITICAL: Warm cache and ensure fresh statistics before benchmarks
echo "--- Warming cache and refreshing statistics..."
psql_in_pod <<'SQL' >/dev/null 2>&1 || true
ANALYZE records.records;

SELECT pg_prewarm('records.ix_records_search_norm_gist'::regclass) WHERE to_regclass('records.ix_records_search_norm_gist') IS NOT NULL;
SELECT pg_prewarm('records.ix_records_search_norm_gin'::regclass) WHERE to_regclass('records.ix_records_search_norm_gin') IS NOT NULL;
SELECT pg_prewarm('records.ix_records_artist_trgm'::regclass) WHERE to_regclass('records.ix_records_artist_trgm') IS NOT NULL;
SELECT pg_prewarm('records.ix_records_name_trgm'::regclass) WHERE to_regclass('records.ix_records_name_trgm') IS NOT NULL;
SELECT pg_prewarm('records.ix_records_catalog_trgm'::regclass) WHERE to_regclass('records.ix_records_catalog_trgm') IS NOT NULL;

SELECT count(*) FROM public.search_records_fuzzy_ids('0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid, 'test', 10::bigint, 0::bigint);
SELECT count(*) FROM (
  SELECT r.id FROM records.records r WHERE r.user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid ORDER BY r.search_norm <-> 'test' LIMIT 10
) s;
SQL

echo "--- Running sweep"
IFS=',' read -r -a client_array <<< "$CLIENTS"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
results_csv="$tmpdir/bench_sweep_${TIMESTAMP}.csv"
if [[ ! -f "$results_csv" ]]; then
  echo "ts_utc,variant,clients,threads,duration_s,limit_rows,tps,ok_xacts,fail_xacts,err_pct,avg_ms,std_ms,p50_ms,p95_ms,p99_ms,p999_ms,p9999_ms,max_ms,git_rev,git_branch,host,server_version,track_io,delta_blks_hit,delta_blks_read,delta_blk_read_ms,delta_blk_write_ms,delta_xact_commit,delta_tup_returned,delta_tup_fetched,delta_stmt_total_ms,delta_stmt_shared_hit,delta_stmt_shared_read,delta_stmt_shared_dirtied,delta_stmt_shared_written,delta_stmt_temp_read,delta_stmt_temp_written,delta_io_read_ms,delta_io_write_ms,delta_io_extend_ms,delta_io_fsync_ms,io_total_ms,active_sessions,cpu_share_pct,delta_wal_records,delta_wal_fpi,delta_wal_bytes,delta_ckpt_write_ms,delta_ckpt_sync_ms,delta_buf_checkpoint,delta_buf_backend,delta_buf_alloc,hit_ratio_pct" > "$results_csv"
fi

read_metrics() {
  psql_in_pod -At < "$tmpdir/read_metrics.sql" | tr '|' ' '
}

read_stmt_metrics() {
  local out
  if ! out=$(psql_in_pod -At <<'EOFSQL' 2>/dev/null
    SELECT
      COALESCE(sum(total_exec_time),0),
      COALESCE(sum(shared_blks_hit),0),
      COALESCE(sum(shared_blks_read),0),
      COALESCE(sum(shared_blks_dirtied),0),
      COALESCE(sum(shared_blks_written),0),
      COALESCE(sum(temp_blks_read),0),
      COALESCE(sum(temp_blks_written),0)
    FROM pg_catalog.pg_stat_statements
    WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database());
EOFSQL
  ); then
    echo "0 0 0 0 0 0 0"
  else
    if [[ -z "$out" ]]; then
      echo "0 0 0 0 0 0 0"
    else
      echo "$out" | tr '|' ' '
    fi
  fi
}

read_io_metrics() {
  psql_in_pod -At <<'SQL' | tr '|' ' '
    SELECT
      COALESCE(sum(read_time),0),
      COALESCE(sum(write_time),0),
      COALESCE(sum(extend_time),0),
      COALESCE(sum(fsync_time),0)
    FROM pg_stat_io;
SQL
}

read_wal_metrics() {
  psql_in_pod -At <<'SQL' | tr '|' ' '
    SELECT COALESCE(wal_records,0), COALESCE(wal_fpi,0), COALESCE(wal_bytes,0)
    FROM pg_stat_wal;
SQL
}

read_ckpt_metrics() {
  psql_in_pod -At <<'SQL' | tr '|' ' '
    SELECT
      COALESCE(checkpoint_write_time,0),
      COALESCE(checkpoint_sync_time,0),
      COALESCE(buffers_checkpoint,0),
      COALESCE(buffers_backend,0),
      COALESCE(buffers_alloc,0)
    FROM pg_stat_bgwriter;
SQL
}

git_rev=$(git rev-parse --short HEAD 2>/dev/null || echo na)
git_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo na)

run_variant() {
  local variant="$1" sql_file="$2" clients="$3"
  local wd rc
  wd=$(mktemp -d)
  pushd "$wd" >/dev/null

  echo "Disabling autovacuum (table-level) and optimizing for benchmark..."
  psql_in_pod <<'SQL' >/dev/null 2>&1 || true
ALTER TABLE records.records SET (autovacuum_enabled = false);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'aliases_mv' AND relnamespace = 'records'::regnamespace::oid) THEN
    ALTER TABLE records.aliases_mv SET (autovacuum_enabled = false);
  END IF;
END $$;

SET maintenance_work_mem = '1GB';
SET checkpoint_timeout = '1h';
SET checkpoint_completion_target = 0.9;
SET work_mem = '256MB';
SET effective_cache_size = '8GB';
SET random_page_cost = 1.0;
SET cpu_index_tuple_cost = 0.0005;
SET cpu_tuple_cost = 0.01;
SET enable_seqscan = off;
SET jit = off;
SET max_parallel_workers_per_gather = 4;
SET max_parallel_workers = 12;
SQL

  local metrics_before stmt_before io_before wal_before ckpt_before
  read -r metrics_before <<< "$(read_metrics)"
  read -r stmt_before <<< "$(read_stmt_metrics)"
  read -r io_before <<< "$(read_io_metrics)"
  read -r wal_before <<< "$(read_wal_metrics)"
  read -r ckpt_before <<< "$(read_ckpt_metrics)"

  local actual_threads
  actual_threads="$THREADS"

  if [[ "$USE_LOCAL_PGBENCH" == "true" ]]; then
    echo "Running pgbench locally (connecting to Postgres at localhost:5432)..."
    rm -f "$wd"/pgbench_log.* 2>/dev/null || true
    PGBENCH_LOG_DIR="$wd" bash "$tmpdir/run_pgbench.sh" "$PGOPTIONS_EXTRA" \
     -n -M prepared \
      -P 5 --progress-timestamp \
      -T "$DURATION" -c "$clients" -j "$actual_threads" \
      -D uid="$USER_UUID" -D q="$PG_QUERY_ARG" -D lim="$LIMIT" \
      -D trgm_threshold="$TRGM_THRESHOLD" \
      -l -f "$bench_sql_dir/$sql_file" | tee out.txt
  else
    kubectl -n "$NS" exec "$POD" -c db -- bash -lc 'rm -f /tmp/pgbench_log.*' >/dev/null 2>&1 || \
    kubectl -n "$NS" exec "$POD" -- bash -lc 'rm -f /tmp/pgbench_log.*' >/dev/null 2>&1 || true

    kubectl -n "$NS" cp "$tmpdir/run_pgbench.sh" "$POD:/tmp/run_pgbench.sh" -c db >/dev/null 2>&1 || \
    kubectl -n "$NS" cp "$tmpdir/run_pgbench.sh" "$POD:/tmp/run_pgbench.sh" >/dev/null 2>&1 || true
    kubectl -n "$NS" exec "$POD" -c db -- chmod +x /tmp/run_pgbench.sh >/dev/null 2>&1 || \
    kubectl -n "$NS" exec "$POD" -- chmod +x /tmp/run_pgbench.sh >/dev/null 2>&1 || true
    kubectl -n "$NS" exec "$POD" -c db -- mkdir -p /tmp/bench_sql >/dev/null 2>&1 || \
    kubectl -n "$NS" exec "$POD" -- mkdir -p /tmp/bench_sql >/dev/null 2>&1 || true
    kubectl -n "$NS" cp "$tmpdir/bench_sql/." "$POD:/tmp/bench_sql" -c db >/dev/null 2>&1 || \
    kubectl -n "$NS" cp "$tmpdir/bench_sql/." "$POD:/tmp/bench_sql" >/dev/null 2>&1 || true

    kubectl -n "$NS" exec "$POD" -c db -- /tmp/run_pgbench.sh "$PGOPTIONS_EXTRA" \
  -n -M prepared \
  -P 5 --progress-timestamp \
  -T "$DURATION" -c "$clients" -j "$actual_threads" \
  -D uid="$USER_UUID" -D q="$PG_QUERY_ARG" -D lim="$LIMIT" \
  -D trgm_threshold="$TRGM_THRESHOLD" \
  -l -f "/tmp/bench_sql/$sql_file" | tee out.txt || \
kubectl -n "$NS" exec "$POD" -- /tmp/run_pgbench.sh "$PGOPTIONS_EXTRA" \
  -n -M prepared \
  -P 5 --progress-timestamp \
  -T "$DURATION" -c "$clients" -j "$actual_threads" \
  -D uid="$USER_UUID" -D q="$PG_QUERY_ARG" -D lim="$LIMIT" \
  -D trgm_threshold="$TRGM_THRESHOLD" \
  -l -f "/tmp/bench_sql/$sql_file" | tee out.txt

    if kubectl -n "$NS" exec "$POD" -c db -- bash -lc 'cd /tmp && compgen -G "pgbench_log.*" >/dev/null' 2>/dev/null; then
      kubectl -n "$NS" exec "$POD" -c db -- bash -lc 'cd /tmp && tar cf - pgbench_log.*' | tar xf - -C "$wd" 2>/dev/null || \
      kubectl -n "$NS" exec "$POD" -- bash -lc 'cd /tmp && tar cf - pgbench_log.*' | tar xf - -C "$wd" 2>/dev/null || true
      kubectl -n "$NS" exec "$POD" -c db -- bash -lc 'rm -f /tmp/pgbench_log.*' >/dev/null 2>&1 || \
      kubectl -n "$NS" exec "$POD" -- bash -lc 'rm -f /tmp/pgbench_log.*' >/dev/null 2>&1 || true
    fi
  fi

  rc=${PIPESTATUS[0]}

  psql_in_pod <<'SQL' >/dev/null 2>&1 || true
ALTER TABLE records.records SET (autovacuum_enabled = true);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'aliases_mv' AND relnamespace = 'records'::regnamespace::oid) THEN
    ALTER TABLE records.aliases_mv SET (autovacuum_enabled = true);
  END IF;
END $$;
SQL

  if [[ $rc -ne 0 ]]; then
    echo "pgbench failed for $variant (clients=$clients)" >&2
    popd >/dev/null
    rm -rf "$wd"
    return $rc
  fi

  local tps ok fail err_pct
  tps=$(sed -n "s/^tps = \([0-9.][0-9.]*\) .*/\1/p" out.txt | tail -n1)
  ok=$(sed -n 's/^number of transactions actually processed: \([0-9][0-9]*\).*/\1/p' out.txt | tail -n1)
  [[ -z "$ok" ]] && ok=0
  fail=$(sed -n 's/^number of failed transactions: \([0-9][0-9]*\).*/\1/p' out.txt | tail -n1)
  [[ -z "$fail" ]] && fail=0
  err_pct=$(awk -v ok="$ok" -v fail="$fail" 'BEGIN{t=ok+fail; if (t>0) printf "%.3f", 100.0*fail/t; else printf "0.000"}')

  # Defaults (in case we can't parse logs)
  local avg std p50 p95 p99 p999 p9999 pmax
  avg=$(sed -n 's/^latency average = \([0-9.][0-9.]*\) ms$/\1/p' out.txt | tail -n1)
  std=$(sed -n 's/^latency stddev = \([0-9.][0-9.]*\) ms$/\1/p' out.txt | tail -n1)
  p50=""; p95=""; p99=""; p999=""; p9999=""; pmax=""

  # If per-transaction logs exist, compute percentiles from them (like old harness)
  if ls pgbench_log.* >/dev/null 2>&1; then
    # Extract latency column (µs) and convert to ms; prefer $2, else $3
    awk '{
      if ($2 ~ /^[0-9]+$/)      printf("%.3f\n", $2/1000.0);
      else if ($3 ~ /^[0-9]+$/) printf("%.3f\n", $3/1000.0);
    }' pgbench_log.* > lat.txt 2>/dev/null || true

    if [[ -s lat.txt ]]; then
      read -r avg std p50 p95 p99 p999 p9999 pmax < <(calc_latency_metrics lat.txt)
    fi
  fi

  local metrics_after stmt_after io_after wal_after ckpt_after
  read -r metrics_after <<< "$(read_metrics)"
  read -r stmt_after <<< "$(read_stmt_metrics)"
  read -r io_after <<< "$(read_io_metrics)"
  read -r wal_after <<< "$(read_wal_metrics)"
  read -r ckpt_after <<< "$(read_ckpt_metrics)"

  IFS=' ' read -r blks_hit_before blks_read_before read_ms_before write_ms_before xact_before tup_ret_before tup_fetch_before <<< "$metrics_before"
  IFS=' ' read -r blks_hit_after blks_read_after read_ms_after write_ms_after xact_after tup_ret_after tup_fetch_after <<< "$metrics_after"
  IFS=' ' read -r stmt_ms_before stmt_hit_before stmt_read_before stmt_dirty_before stmt_written_before stmt_temp_read_before stmt_temp_write_before <<< "$stmt_before"
  IFS=' ' read -r stmt_ms_after stmt_hit_after stmt_read_after stmt_dirty_after stmt_written_after stmt_temp_read_after stmt_temp_write_after <<< "$stmt_after"
  IFS=' ' read -r io_read_before io_write_before io_extend_before io_fsync_before <<< "$io_before"
  IFS=' ' read -r io_read_after io_write_after io_extend_after io_fsync_after <<< "$io_after"
  IFS=' ' read -r wal_rec_before wal_fpi_before wal_bytes_before <<< "$wal_before"
  IFS=' ' read -r wal_rec_after wal_fpi_after wal_bytes_after <<< "$wal_after"
  IFS=' ' read -r ckpt_write_before ckpt_sync_before buf_ckpt_before buf_backend_before buf_alloc_before <<< "$ckpt_before"
  IFS=' ' read -r ckpt_write_after ckpt_sync_after buf_ckpt_after buf_backend_after buf_alloc_after <<< "$ckpt_after"

  local d_blks_hit=$((blks_hit_after - blks_hit_before))
  local d_blks_read=$((blks_read_after - blks_read_before))
  local d_xact=$((xact_after - xact_before))
  local d_tup_ret=$((tup_ret_after - tup_ret_before))
  local d_tup_fetch=$((tup_fetch_after - tup_fetch_before))
  local d_stmt_ms
  d_stmt_ms=$(awk -v a="$stmt_ms_before" -v b="$stmt_ms_after" 'BEGIN{printf "%.3f", b-a}')
  local d_stmt_hit=$((stmt_hit_after - stmt_hit_before))
  local d_stmt_read=$((stmt_read_after - stmt_read_before))
  local d_stmt_dirty=$((stmt_dirty_after - stmt_dirty_before))
  local d_stmt_written=$((stmt_written_after - stmt_written_before))
  local d_temp_read=$((stmt_temp_read_after - stmt_temp_read_before))
  local d_temp_written=$((stmt_temp_write_after - stmt_temp_write_before))
  local d_read_ms d_write_ms d_io_read d_io_write d_io_extend d_io_fsync
  d_read_ms=$(awk -v a="$read_ms_before" -v b="$read_ms_after" 'BEGIN{printf "%.3f", b-a}')
  d_write_ms=$(awk -v a="$write_ms_before" -v b="$write_ms_after" 'BEGIN{printf "%.3f", b-a}')
  d_io_read=$(awk -v a="$io_read_before" -v b="$io_read_after" 'BEGIN{printf "%.3f", b-a}')
  d_io_write=$(awk -v a="$io_write_before" -v b="$io_write_after" 'BEGIN{printf "%.3f", b-a}')
  d_io_extend=$(awk -v a="$io_extend_before" -v b="$io_extend_after" 'BEGIN{printf "%.3f", b-a}')
  d_io_fsync=$(awk -v a="$io_fsync_before" -v b="$io_fsync_after" 'BEGIN{printf "%.3f", b-a}')
  local io_total
  io_total=$(awk -v r="$d_io_read" -v w="$d_io_write" -v e="$d_io_extend" -v f="$d_io_fsync" 'BEGIN{printf "%.3f", r+w+e+f}')
  local d_wal_rec=$((wal_rec_after - wal_rec_before))
  local d_wal_fpi=$((wal_fpi_after - wal_fpi_before))
  local d_wal_bytes
  d_wal_bytes=$(awk -v a="$wal_bytes_before" -v b="$wal_bytes_after" 'BEGIN{printf "%.3f", b-a}')
  local d_ckpt_write d_ckpt_sync
  d_ckpt_write=$(awk -v a="$ckpt_write_before" -v b="$ckpt_write_after" 'BEGIN{printf "%.3f", b-a}')
  d_ckpt_sync=$(awk -v a="$ckpt_sync_before" -v b="$ckpt_sync_after" 'BEGIN{printf "%.3f", b-a}')
  local d_buf_ckpt=$((buf_ckpt_after - buf_ckpt_before))
  local d_buf_backend=$((buf_backend_after - buf_backend_before))
  local d_buf_alloc=$((buf_alloc_after - buf_alloc_before))
  local hit_ratio
  hit_ratio=$(awk -v h="$d_blks_hit" -v r="$d_blks_read" 'BEGIN{t=h+r; if (t>0) printf "%.3f", 100.0*h/t; else printf ""}')

  local active_sessions
  active_sessions=$(awk -v st="$d_stmt_ms" -v dur="$DURATION" 'BEGIN{if (dur>0 && st>0) printf "%.3f", st/(dur*1000.0); else printf ""}')

  local cpu_share_pct
  cpu_share_pct=$(awk -v st="$d_stmt_ms" -v io="$io_total" 'BEGIN{
    if (st>0) {
      x=(st-io)/st*100;
      if (x<0) x=0;
      if (x>100) x=100;
      printf "%.2f", x
    } else printf ""
  }')

  local ts host track_io
  ts=$(date -u +%FT%TZ)
  host="$POD"
  track_io=$(psql_in_pod -At -c "SHOW track_io_timing" | tr 'A-Z' 'a-z')
  track_io=$([[ "$track_io" == "on" ]] && echo true || echo false)

  echo "$ts,$variant,$clients,$actual_threads,$DURATION,$LIMIT,$tps,$ok,$fail,$err_pct,$avg,$std,$p50,$p95,$p99,$p999,$p9999,$pmax,$git_rev,$git_branch,$host,$(psql_in_pod -At -c 'SHOW server_version'),$track_io,$d_blks_hit,$d_blks_read,$d_read_ms,$d_write_ms,$d_xact,$d_tup_ret,$d_tup_fetch,$d_stmt_ms,$d_stmt_hit,$d_stmt_read,$d_stmt_dirty,$d_stmt_written,$d_temp_read,$d_temp_written,$d_io_read,$d_io_write,$d_io_extend,$d_io_fsync,$io_total,$active_sessions,$cpu_share_pct,$d_wal_rec,$d_wal_fpi,$d_wal_bytes,$d_ckpt_write,$d_ckpt_sync,$d_buf_ckpt,$d_buf_backend,$d_buf_alloc,$hit_ratio" >> "$results_csv"

  psql_in_pod -v ON_ERROR_STOP=1 \
    -v variant="$variant" -v clients="$clients" -v threads="$actual_threads" \
    -v duration="$DURATION" -v lim="$LIMIT" -v tps="$tps" -v ok="$ok" \
    -v fail="$fail" -v err_pct="$err_pct" -v avg="$avg" -v std="$std" \
    -v p50="$p50" -v p95="$p95" -v p99="$p99" -v p999="$p999" \
    -v p9999="$p9999" -v p100="$pmax" -v notes="rev=$git_rev branch=$git_branch host=$host variant=$variant lim=$LIMIT" \
    -v git_rev="$git_rev" -v git_branch="$git_branch" -v host="$host" \
    -v server_version="$(psql_in_pod -At -c 'SHOW server_version')" \
    -v track_io="$track_io" -v dH="$d_blks_hit" -v dR="$d_blks_read" \
    -v dRT="$d_read_ms" -v dWT="$d_write_ms" -v dXC="$d_xact" -v dTR="$d_tup_ret" \
    -v dTF="$d_tup_fetch" -v dST="$d_stmt_ms" -v dSH="$d_stmt_hit" \
    -v dSR="$d_stmt_read" -v dSD="$d_stmt_dirty" -v dSW="$d_stmt_written" \
    -v dTBR="$d_temp_read" -v dTBW="$d_temp_written" -v dIOR="$d_io_read" \
    -v dIOW="$d_io_write" -v dIOE="$d_io_extend" -v dIOF="$d_io_fsync" \
    -v io_total="$io_total" -v act_sess="$active_sessions" -v cpu_share="$cpu_share_pct" \
    -v dWR="$d_wal_rec" -v dWFPI="$d_wal_fpi" \
    -v dWBY="$d_wal_bytes" -v dCKW="$d_ckpt_write" -v dCKS="$d_ckpt_sync" \
    -v dBCK="$d_buf_ckpt" -v dBBE="$d_buf_backend" -v dBAL="$d_buf_alloc" \
    -v hit_ratio="$hit_ratio" \
    -f - <<'EOSQL'
      \echo 'Inserting bench.results row variant=' :'variant' ', clients=' :'clients' ', tps=' :'tps'
      INSERT INTO bench.results(
        variant, clients, threads, duration_s, limit_rows,
        tps, ok_xacts, fail_xacts, err_pct,
        lat_avg_ms, lat_std_ms, p50_ms, p95_ms, p99_ms, p999_ms, p9999_ms, p100_ms, notes,
        git_rev, git_branch, host, server_version, track_io,
        delta_blks_hit, delta_blks_read, delta_blk_read_ms, delta_blk_write_ms,
        delta_xact_commit, delta_tup_returned, delta_tup_fetched,
        delta_stmt_total_ms, delta_stmt_shared_hit, delta_stmt_shared_read,
        delta_stmt_shared_dirtied, delta_stmt_shared_written, delta_stmt_temp_read,
        delta_stmt_temp_written, delta_io_read_ms, delta_io_write_ms, delta_io_extend_ms,
        delta_io_fsync_ms, io_total_ms, active_sessions, cpu_share_pct,
        delta_wal_records, delta_wal_fpi, delta_wal_bytes,
        delta_ckpt_write_ms, delta_ckpt_sync_ms, delta_buf_checkpoint, delta_buf_backend,
        delta_buf_alloc, hit_ratio_pct
      ) VALUES (
        :'variant', :'clients'::int, :'threads'::int, :'duration'::int, :'lim'::int,
        NULLIF(:'tps','')::numeric, NULLIF(:'ok','')::bigint, NULLIF(:'fail','')::bigint, NULLIF(:'err_pct','')::numeric,
        NULLIF(NULLIF(:'avg','NaN'),'')::numeric, NULLIF(NULLIF(:'std','NaN'),'')::numeric,
        NULLIF(NULLIF(:'p50','NaN'),'')::numeric, NULLIF(NULLIF(:'p95','NaN'),'')::numeric,
        NULLIF(NULLIF(:'p99','NaN'),'')::numeric, NULLIF(NULLIF(:'p999','NaN'),'')::numeric,
        NULLIF(NULLIF(:'p9999','NaN'),'')::numeric, NULLIF(NULLIF(:'p100','NaN'),'')::numeric,
        :'notes', :'git_rev', :'git_branch', :'host', :'server_version', :'track_io'::boolean,
        NULLIF(:'dH','')::bigint, NULLIF(:'dR','')::bigint, NULLIF(:'dRT','')::numeric, NULLIF(:'dWT','')::numeric,
        NULLIF(:'dXC','')::bigint, NULLIF(:'dTR','')::bigint, NULLIF(:'dTF','')::bigint,
        NULLIF(:'dST','')::numeric, NULLIF(:'dSH','')::bigint, NULLIF(:'dSR','')::bigint,
        NULLIF(:'dSD','')::bigint, NULLIF(:'dSW','')::bigint, NULLIF(:'dTBR','')::bigint,
        NULLIF(:'dTBW','')::bigint, NULLIF(:'dIOR','')::numeric, NULLIF(:'dIOW','')::numeric, NULLIF(:'dIOE','')::numeric,
        NULLIF(:'dIOF','')::numeric, NULLIF(:'io_total','')::numeric, NULLIF(:'act_sess','')::numeric, NULLIF(:'cpu_share','')::numeric,
        NULLIF(:'dWR','')::bigint, NULLIF(:'dWFPI','')::bigint, NULLIF(:'dWBY','')::numeric,
        NULLIF(:'dCKW','')::numeric, NULLIF(:'dCKS','')::numeric, NULLIF(:'dBCK','')::bigint, NULLIF(:'dBBE','')::bigint,
        NULLIF(:'dBAL','')::bigint, NULLIF(:'hit_ratio','')::numeric
      );
EOSQL

  popd >/dev/null
  rm -rf "$wd"
}

declare -a variants=("knn" "trgm" "trgm_simple")

for clients in "${client_array[@]}"; do
  for variant in "${variants[@]}"; do
    variant_label=$(printf '%s' "$variant" | tr '[:lower:]' '[:upper:]')
    echo "== ${variant_label}, clients=$clients =="

    if [[ "$variant" == "trgm" ]]; then
      echo "Recreating function before TRGM benchmark..."
      if [[ -x "$REPO_ROOT/scripts/create-knn-function.sh" ]]; then
        if ! NS="$NS" "$REPO_ROOT/scripts/create-knn-function.sh"; then
          echo "❌ create-knn-function.sh failed before TRGM run" >&2
          exit 1
        fi
      fi

      echo "--- Function signature (for sanity) ---"
      psql_in_pod <<'EOFSQL'
SET search_path = public, records, pg_catalog;
SELECT n.nspname,
       p.proname,
       p.proargtypes::regtype[]::text AS args
FROM   pg_proc p
JOIN   pg_namespace n ON n.oid = p.pronamespace
WHERE  p.proname = 'search_records_fuzzy_ids'
ORDER  BY n.nspname, p.oid;
EOFSQL

      echo "--- Diagnostic call to search_records_fuzzy_ids ---"
      echo "If there is an error, it will be printed below but will NOT abort the sweep."
      if ! psql_in_pod -c \
        "SET search_path = public, records, pg_catalog; \
         SELECT count(*) \
         FROM public.search_records_fuzzy_ids('$USER_UUID'::uuid, 'test', 10::bigint, 0::bigint);" ; then
        echo "⚠️ search_records_fuzzy_ids('test') raised an error above." >&2
        echo "⚠️ TRGM pgbench may fail for the same reason; keeping it visible for debugging." >&2
      else
        echo "✅ Diagnostic call to search_records_fuzzy_ids succeeded"
      fi
    fi

    run_variant "$variant" "bench_${variant}.sql" "$clients"
    echo
  done
done

echo "--- Exporting results"
psql_in_pod <<'SQL'
\copy (SELECT * FROM bench.results ORDER BY ts_utc DESC LIMIT 1000) TO '/tmp/bench_export.csv' CSV HEADER
SQL

echo "CSV (sweep log): $results_csv"

output_dir="$REPO_ROOT"
mkdir -p "$output_dir"

cp -f "$results_csv" "$output_dir/bench_sweep_${TIMESTAMP}.csv" 2>/dev/null || true
cp -f "$results_csv" "$output_dir/bench_sweep.csv" 2>/dev/null || true

remote_export="$output_dir/bench_export_${TIMESTAMP}.csv"
if [[ -n "$POD" ]] && [[ "$USE_LOCAL_PGBENCH" != "true" ]]; then
  kubectl -n "$NS" cp "$POD:/tmp/bench_export.csv" "$remote_export" -c db >/dev/null 2>&1 || true
fi
if [[ ! -s "$remote_export" || $(wc -l < "$remote_export" 2>/dev/null || echo 0) -le 1 ]]; then
  echo "bench.results empty or unavailable, using local sweep data for bench_export."
  cp -f "$results_csv" "$remote_export" 2>/dev/null || true
fi
cp -f "$remote_export" "$output_dir/bench_export.csv" 2>/dev/null || true

echo "✅ Wrote $output_dir/bench_sweep_${TIMESTAMP}.csv"
echo "✅ Wrote $output_dir/bench_export_${TIMESTAMP}.csv"
echo "✅ Also wrote: $output_dir/bench_sweep.csv (latest)"
echo ""

echo "=== Creating automatic backup ==="
if [[ -f "$REPO_ROOT/scripts/create-comprehensive-backup.sh" ]]; then
  NS="${NS:-record-platform}"
  PGPOD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' | awk 'NR==1{print $1}')
  if [[ -n "$PGPOD" ]]; then
    echo "Waiting for pod to be ready..."
    kubectl -n "$NS" wait pod "$PGPOD" --for=condition=Ready --timeout=60s >/dev/null 2>&1 || true
    sleep 2
    for i in $(seq 1 10); do
      if psql_in_pod -c "SELECT 1;" >/dev/null 2>&1; then
        break
      fi
      sleep 1
    done
  fi
  "$REPO_ROOT/scripts/create-comprehensive-backup.sh"
else
  echo "⚠️  Backup script not found, skipping automatic backup"
fi
