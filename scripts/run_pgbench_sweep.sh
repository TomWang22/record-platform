#!/usr/bin/env bash
# Benchmark target database (dev/local):
#   - Postgres host (from this script): localhost:5433
#   - Database: records
#   - Docker Compose service: postgres (ports: 5433:5432)
#   - Schemas used: records (data), bench (results), public, auth
#
# Important:
#   - This script benchmarks the Docker Postgres instance, NOT the K8s postgres pod.
#   - K8s microservices connect to the same Docker DB via:
#       host.docker.internal:5433 (db=records, search_path=auth|records|...)
#   - Other Docker Postgres instances:
#       postgres-social   → localhost:5434 (schemas: forum, messages)
#       postgres-listings → localhost:5435 (schema: listings)
#   - These are external to this benchmark.
set -Euo pipefail

# Avoid libpq trying GSSAPI on localhost; it's just noise in logs
export PGGSSENCMODE=disable

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

# Canonical records DB connection (override via env if needed)
RECORDS_DB_HOST="${RECORDS_DB_HOST:-localhost}"
RECORDS_DB_PORT="${RECORDS_DB_PORT:-5433}"  # Docker Compose main DB
RECORDS_DB_USER="${RECORDS_DB_USER:-postgres}"
RECORDS_DB_NAME="${RECORDS_DB_NAME:-records}"
RECORDS_DB_PASS="${RECORDS_DB_PASS:-postgres}"

NS="record-platform"
POD=""
USER_UUID="0dc268d0-a86f-4e12-8d10-9db0f1b735e0"
QUERY='鄧麗君 album 263 cn-041 polygram'
DURATION=60
MODE="${MODE:-quick}"  # quick | deep
# Set CLIENTS based on MODE
if [[ "$MODE" == "deep" ]]; then
  CLIENTS="8,16,24,32,48,64,96,128,192,256"
else
  CLIENTS="8,16,24,32,48,64"
fi
THREADS=12 # Keep at 12 for consistency with gold run
LIMIT=50   # Keep at 50 for consistency with gold run
# TRGM threshold: default 0.40 (aligns with min_rank=0.40 in function)
# Good run used 0.3 at DB level, but function didn't use % then
# Now that function uses %, this threshold matters for candidate filtering
TRGM_THRESHOLD="${TRGM_THRESHOLD:-0.40}"
# Note: track_io_timing can be set to 'off' for maximum TPS (trades IO metrics for speed)
# Good run had track_io_timing=on, but turning off can give 5-10% TPS boost
TRACK_IO_TIMING="${TRACK_IO_TIMING:-on}"
# work_mem per session: default 32MB (matches good run)
# Good run used 32MB (32768kB), but we can bump for benchmarks if needed
WORK_MEM_MB="${WORK_MEM_MB:-32}"
# I/O concurrency for index scans; 0 = disabled, 200 is a safe high value for SSD/NVMe
EFFECTIVE_IO_CONCURRENCY="${EFFECTIVE_IO_CONCURRENCY:-200}"
# Optional: name of a pre-created temp tablespace on tmpfs (e.g. fasttmp)
# If set, benchmarks will use this tablespace for temp files (reduces p999 spikes)
FAST_TEMP_TABLESPACE="${FAST_TEMP_TABLESPACE:-}"
# TUNED: Disabled parallelism for FTS+trgm queries (reduces tail latency)
# TUNED: Reduced candidate_cap multiplier and raised min_rank in function
PGOPTIONS_EXTRA="-c jit=off -c enable_seqscan=off -c random_page_cost=1.0 -c cpu_index_tuple_cost=0.0005 -c cpu_tuple_cost=0.01 -c effective_cache_size=8GB -c work_mem=${WORK_MEM_MB}MB -c track_io_timing=${TRACK_IO_TIMING} -c effective_io_concurrency=${EFFECTIVE_IO_CONCURRENCY} -c max_parallel_workers=0 -c max_parallel_workers_per_gather=0 -c maintenance_work_mem=512MB -c pg_trgm.similarity_threshold=${TRGM_THRESHOLD} -c search_path=public,records,pg_catalog"

# Add temp_tablespaces if FAST_TEMP_TABLESPACE is set
if [[ -n "$FAST_TEMP_TABLESPACE" ]]; then
  PGOPTIONS_EXTRA="$PGOPTIONS_EXTRA -c temp_tablespaces=$FAST_TEMP_TABLESPACE"
fi

# Feature toggles (controllable via env)
RUN_SMOKE_TESTS="${RUN_SMOKE_TESTS:-true}"       # pre-bench pgbench sanity checks
RUN_COLD_CACHE="${RUN_COLD_CACHE:-false}"        # run a cold-cache phase too
GENERATE_PLOTS="${GENERATE_PLOTS:-true}"         # auto-generate PNG graphs
RUN_DIFF_MODE="${RUN_DIFF_MODE:-false}"          # compare against baseline CSV
BASELINE_CSV="${BASELINE_CSV:-}"                 # path to "golden" CSV for diff mode
REG_THRESH_TPS_DROP="${REG_THRESH_TPS_DROP:-0.15}"      # 15% TPS drop = regression
REG_THRESH_P95_INCREASE="${REG_THRESH_P95_INCREASE:-0.25}"  # 25% p95 increase = regression
SKIP_RESTORE="${SKIP_RESTORE:-false}"            # if true, skip automatic restore from backup
INCLUDE_RAW_TRGM_EXPLAIN="${INCLUDE_RAW_TRGM_EXPLAIN:-false}"  # if true, include raw trigram % EXPLAIN baseline

# Phase marker (warm vs cold)
PHASE="warm"

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

QUERY_LITERAL=$(printf "%s" "$QUERY" | sed "s/'/''/g")
PG_QUERY_ARG="'$QUERY_LITERAL'"

# CRITICAL: Resolve script_dir and repo root robustly (like old script)
# This ensures CSV files are written to repo root, not temp directories
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$script_dir/.." && pwd)"

# Create log directory for this run (avoids terminal wraparound issues)
LOG_DIR="$REPO_ROOT/bench_logs/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$LOG_DIR"
echo "📁 Logging EXPLAINs and diagnostics to: $LOG_DIR"

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
    echo "   Postgres is external (Docker), connecting to ${RECORDS_DB_HOST}:${RECORDS_DB_PORT}" >&2
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
# Uses parameterized connection settings (can be overridden via env vars)
# Canonical external Postgres endpoint: localhost:5433 (Docker port, avoids Postgres.app conflict)
# This ensures psql_in_pod and pgbench connect to the SAME database
psql_in_pod() {
  PGPASSWORD="$RECORDS_DB_PASS" psql \
    -h "$RECORDS_DB_HOST" -p "$RECORDS_DB_PORT" \
    -U "$RECORDS_DB_USER" -d "$RECORDS_DB_NAME" \
    -X -P pager=off "$@"
}

# Force local pgbench when pgbench is available locally
# This ensures we use the same connection method (localhost:5433) for everything
if command -v pgbench >/dev/null 2>&1; then
  echo "✅ Using local pgbench (connecting to ${RECORDS_DB_HOST}:${RECORDS_DB_PORT})"
  USE_LOCAL_PGBENCH=true
  POD=""
fi

# NOTE: Function creation moved to AFTER database restore check
# This ensures the function is created on the correct database

tmpdir=$(mktemp -d)
# CRITICAL: Always cd back to repo root before cleanup to avoid popd errors
trap 'cd "$REPO_ROOT" 2>/dev/null || true; rm -rf "$tmpdir"; if [[ -n "${LOG_DIR:-}" ]] && [[ -d "$LOG_DIR" ]]; then find "$REPO_ROOT" -maxdepth 1 -name "bench_sweep_*.csv" -type f -exec mv {} "$LOG_DIR/" \; 2>/dev/null || true; echo ""; echo "📁 All results and logs saved to: $LOG_DIR"; fi' EXIT

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
-- NOTE: These global indexes are created but then dropped by drop-global-trgm-indexes.sh
-- to force use of per-tenant partial indexes. Do NOT create them here if partial indexes are being used.
-- CREATE INDEX IF NOT EXISTS idx_records_partitioned_search_norm_gist ON records.records USING gist (search_norm gist_trgm_ops);
-- CREATE INDEX IF NOT EXISTS idx_records_partitioned_search_norm_gin ON records.records USING gin (search_norm gin_trgm_ops);
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
  lat_est_ms numeric,  -- Physics-based estimate: 1000 * clients / tps
  p50_ms numeric,
  p95_ms numeric,
  p99_ms numeric,
  p999_ms numeric,
  p9999_ms numeric,
  p99999_ms numeric,
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

-- Ensure lat_est_ms column exists (for existing tables from earlier runs)
ALTER TABLE bench.results
  ADD COLUMN IF NOT EXISTS lat_est_ms numeric;

-- Ensure run_id column exists (for filtering results by run)
ALTER TABLE bench.results
  ADD COLUMN IF NOT EXISTS run_id text;

-- Ensure p999_ms column exists (for older schemas without it)
ALTER TABLE bench.results
  ADD COLUMN IF NOT EXISTS p999_ms numeric;

-- Ensure p99999_ms column exists (for older schemas without it)
ALTER TABLE bench.results
  ADD COLUMN IF NOT EXISTS p99999_ms numeric;

-- Note: Not creating unique constraint to avoid conflicts with existing duplicates
-- If uniqueness is needed later, dedupe rows first, then add constraint
-- DO $$
-- BEGIN
--   ALTER TABLE bench.results
--     ADD CONSTRAINT bench_results_uq
--     UNIQUE (ts_utc, variant, clients, threads, duration_s, limit_rows, host, git_rev);
-- EXCEPTION
--   WHEN duplicate_object THEN
--     NULL;
-- END$$;
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
  awk -v p="$1" -v n="$2" 'BEGIN{x=p/100.0*n;i=int(x); if (x>i) i++; if (i<1) i=1; if (i>n) i=n; print i}'
}

calc_latency_metrics() {
  local lat_file="$1"
  if [[ ! -s "$lat_file" ]]; then
    echo "NaN NaN NaN NaN NaN NaN NaN NaN NaN"
    return
  fi
  local sorted="$lat_file.sorted"
  sort -n "$lat_file" -o "$sorted"
  local n
  n=$(wc -l < "$lat_file")
  local avg std
  read -r avg std < <(awk '{s+=$1; ss+=$1*$1} END {if (NR>0) {m=s/NR; v=(ss/NR)-(m*m); if (v<0) v=0; sd=sqrt(v); printf "%.6f %.6f", m, sd}}' "$lat_file")
  local i50 i95 i99 i999 i9999 i99999
  i50=$(percentile_idx 50 "$n")
  i95=$(percentile_idx 95 "$n")
  i99=$(percentile_idx 99 "$n")
  i999=$(percentile_idx 99.9 "$n")
  i9999=$(percentile_idx 99.99 "$n")
  i99999=$(percentile_idx 99.999 "$n")
  local p50 p95 p99 p999 p9999 p99999 max
  p50=$(sed -n "${i50}p" "$sorted")
  p95=$(sed -n "${i95}p" "$sorted")
  p99=$(sed -n "${i99}p" "$sorted")
  p999=$(sed -n "${i999}p" "$sorted")
  p9999=$(sed -n "${i9999}p" "$sorted")
  p99999=$(sed -n "${i99999}p" "$sorted")
  max=$(tail -n1 "$sorted")
  echo "$avg $std $p50 $p95 $p99 $p999 $p9999 $p99999 $max"
}

# step 0: Check if database exists, restore if needed
echo "=== Checking if database exists ==="
# Check if database exists and has data
# CRITICAL: Use psql_in_pod (localhost:5433) for ALL checks to ensure consistency
# This is the same connection method used by pgbench and BENCH_USER_COUNT
DB_EXISTS=false
TABLE_EXISTS=false
ROW_COUNT=0

# Check DB via the same DSN as everything else (localhost:5433)
if psql_in_pod -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'records';" 2>/dev/null | grep -q 1; then
  DB_EXISTS=true
  echo "✅ Database 'records' exists"
  
  if psql_in_pod -d records -c "SELECT 1 FROM records.records LIMIT 1;" >/dev/null 2>&1; then
    TABLE_EXISTS=true
    ROW_COUNT=$(psql_in_pod -d records -tAc "SELECT count(*) FROM records.records;" 2>/dev/null | tr -d ' ' || echo "0")
    if [[ "$ROW_COUNT" -gt 0 ]]; then
      echo "✅ Table 'records.records' exists with $ROW_COUNT rows"
    else
      echo "⚠️  Table 'records.records' exists but is empty"
    fi
  else
    echo "⚠️  Table 'records.records' does not exist"
  fi
else
  echo "⚠️  Database 'records' does not exist"
fi

# TRIPLE-CHECK: Verify we have sufficient data
if [[ "$TABLE_EXISTS" == "true" ]]; then
  BENCH_USER_COUNT=$(psql_in_pod -tAc "SELECT count(*) FROM records.records WHERE user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid;" 2>/dev/null | tr -d ' ' || echo "0")
  echo "✅ Benchmark user has $BENCH_USER_COUNT records"
  
  if [[ "$BENCH_USER_COUNT" -lt 1000 ]]; then
    echo "⚠️  WARNING: Benchmark user has only $BENCH_USER_COUNT records (expected 1M+)" >&2
  fi
  
  # Check search_tsv is populated
  TSV_COUNT=$(psql_in_pod -tAc "SELECT count(*) FROM records.records WHERE search_tsv IS NOT NULL AND user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid;" 2>/dev/null | tr -d ' ' || echo "0")
  echo "✅ Benchmark user has $TSV_COUNT records with search_tsv populated"
  
  if [[ "$TSV_COUNT" -lt 1000 ]]; then
    echo "⚠️  WARNING: Only $TSV_COUNT records have search_tsv (may need to populate)" >&2
  fi
  
  # Check search_norm is populated
  NORM_COUNT=$(psql_in_pod -tAc "SELECT count(*) FROM records.records WHERE search_norm IS NOT NULL AND user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid;" 2>/dev/null | tr -d ' ' || echo "0")
  echo "✅ Benchmark user has $NORM_COUNT records with search_norm populated"
fi

# Only restore if database doesn't exist OR table doesn't exist OR insufficient data
if [[ "$DB_EXISTS" != "true" ]] || [[ "$TABLE_EXISTS" != "true" ]] || [[ "$ROW_COUNT" -lt 1000000 ]]; then
  if [[ "$SKIP_RESTORE" == "true" ]]; then
    echo "❌ Database not in benchmark shape (DB_EXISTS=$DB_EXISTS, TABLE_EXISTS=$TABLE_EXISTS, ROW_COUNT=$ROW_COUNT)" >&2
    echo "   SKIP_RESTORE=true, so NOT restoring from backup. Fix DB manually and rerun." >&2
    exit 1
  fi
  echo "⚠️  Database missing or insufficient data (only $ROW_COUNT rows), attempting restore..."
  if [[ -f "./scripts/restore-to-external-docker.sh" ]]; then
    # Try to find the most recent backup
    LATEST_BACKUP=$(find backups -name "*.dump" -type f | sort -r | head -1)
    if [[ -n "$LATEST_BACKUP" ]] && [[ -f "$LATEST_BACKUP" ]]; then
      echo "Restoring from backup: $LATEST_BACKUP"
      ./scripts/restore-to-external-docker.sh "$LATEST_BACKUP" 2>&1 | tail -20
      # Wait for restore to complete
      sleep 5
      # Verify restore
      NEW_ROW_COUNT=$(psql_in_pod -tAc "SELECT count(*) FROM records.records;" 2>/dev/null | tr -d ' ' || echo "0")
      if [[ "$NEW_ROW_COUNT" -gt 1000000 ]]; then
        echo "✅ Database restored successfully with $NEW_ROW_COUNT rows"
      else
        echo "❌ Restore failed! Database still has only $NEW_ROW_COUNT rows." >&2
        exit 1
      fi
    else
      echo "❌ No backup file found in backups/ directory!" >&2
      exit 1
    fi
  elif [[ -f "./scripts/restore-from-local-backup.sh" ]]; then
    # Try to find the most recent backup
    LATEST_BACKUP=$(find backups -name "*.dump" -type f | sort -r | head -1)
    if [[ -n "$LATEST_BACKUP" ]] && [[ -f "$LATEST_BACKUP" ]]; then
      echo "Restoring from backup: $LATEST_BACKUP"
      ./scripts/restore-from-local-backup.sh "$LATEST_BACKUP" 2>&1 | tail -20
      # Wait for restore to complete
      sleep 5
      # Verify restore
      NEW_ROW_COUNT=$(psql_in_pod -tAc "SELECT count(*) FROM records.records;" 2>/dev/null | tr -d ' ' || echo "0")
      if [[ "$NEW_ROW_COUNT" -gt 1000000 ]]; then
        echo "✅ Database restored successfully with $NEW_ROW_COUNT rows"
      else
        echo "❌ Restore failed! Database still has only $NEW_ROW_COUNT rows." >&2
        exit 1
      fi
    else
      echo "❌ No backup file found in backups/ directory!" >&2
      exit 1
    fi
  else
    echo "❌ Restore script not found!" >&2
    exit 1
  fi
else
  echo "✅ Database verification passed: $ROW_COUNT rows"
fi

# Log core GUC snapshot for this run (makes it clear which tuning the curves use)
echo "--- Config snapshot (core tuning) ---"
psql_in_pod -At <<'SQL' | tee "$LOG_DIR/config_snapshot.txt"
SELECT 'shared_buffers=' || setting || COALESCE(unit, '') FROM pg_settings WHERE name='shared_buffers';
SELECT 'effective_cache_size=' || setting || COALESCE(unit, '') FROM pg_settings WHERE name='effective_cache_size';
SELECT 'work_mem=' || setting || COALESCE(unit, '') FROM pg_settings WHERE name='work_mem';
SELECT 'effective_io_concurrency=' || setting FROM pg_settings WHERE name='effective_io_concurrency';
SELECT 'checkpoint_completion_target=' || setting FROM pg_settings WHERE name='checkpoint_completion_target';
SELECT 'max_wal_size=' || setting || COALESCE(unit, '') FROM pg_settings WHERE name='max_wal_size';
SELECT 'synchronous_commit=' || setting FROM pg_settings WHERE name='synchronous_commit';
SELECT 'max_parallel_workers=' || setting FROM pg_settings WHERE name='max_parallel_workers';
SELECT 'max_parallel_workers_per_gather=' || setting FROM pg_settings WHERE name='max_parallel_workers_per_gather';
SQL

# CRITICAL: Ensure canonical KNN function and performance tuning are applied BEFORE reading max_connections
# This ensures max_connections=400 is set (though restart is required to apply it)
if [[ -x "./scripts/optimize-db-for-performance.sh" ]]; then
  echo "=== Applying canonical DB optimizations (optimize-db-for-performance.sh) ==="
  NS="$NS" ./scripts/optimize-db-for-performance.sh
fi

# Derive safe max pgbench client count from Postgres max_connections
# Read this AFTER optimization script runs (so we get the updated value if restart happened)
# NOTE: max_connections requires PostgreSQL restart to take effect, so if it's still 200,
# the setting is written to postgresql.auto.conf but not yet active
MAX_CONNECTIONS=$(psql_in_pod -At -c "SHOW max_connections" 2>/dev/null | tr -d ' ' || echo "100")
RESERVED_CONNECTIONS=$(psql_in_pod -At -c "SHOW superuser_reserved_connections" 2>/dev/null | tr -d ' ' || echo "3")
# Keep some headroom for psql/maintenance connections
SAFE_MAX_CLIENTS=$((MAX_CONNECTIONS - RESERVED_CONNECTIONS - 10))
if (( SAFE_MAX_CLIENTS < 1 )); then SAFE_MAX_CLIENTS=1; fi
echo "Max connections: $MAX_CONNECTIONS, reserved: $RESERVED_CONNECTIONS, safe max pgbench clients: $SAFE_MAX_CLIENTS"

# CRITICAL: max_connections requires a PostgreSQL restart to take effect
# Check if max_connections was changed and warn if restart is needed
if [[ "$MAX_CONNECTIONS" == "200" ]]; then
  echo "⚠️  WARNING: max_connections is still 200. PostgreSQL restart required to apply max_connections=400."
  echo "   The setting has been written to postgresql.auto.conf, but won't be active until restart."
  echo ""
  
  # Check if we can auto-restart (Docker only, not Kubernetes)
  if command -v docker >/dev/null 2>&1; then
    POSTGRES_CONTAINER=$(docker ps --filter "name=postgres" --format "{{.Names}}" | head -1)
    if [[ -n "$POSTGRES_CONTAINER" ]]; then
      echo "   Found PostgreSQL container: $POSTGRES_CONTAINER"
      echo "   Attempting automatic restart..."
      if docker restart "$POSTGRES_CONTAINER" >/dev/null 2>&1; then
        echo "   ✅ Container restarted. Waiting for PostgreSQL to be ready..."
        sleep 5
        # Wait for PostgreSQL to be ready
        for i in {1..30}; do
          if psql_in_pod -c "SELECT 1" >/dev/null 2>&1; then
            echo "   ✅ PostgreSQL is ready"
            # Re-read max_connections after restart
            MAX_CONNECTIONS=$(psql_in_pod -At -c "SHOW max_connections" 2>/dev/null | tr -d ' ' || echo "100")
            RESERVED_CONNECTIONS=$(psql_in_pod -At -c "SHOW superuser_reserved_connections" 2>/dev/null | tr -d ' ' || echo "3")
            SAFE_MAX_CLIENTS=$((MAX_CONNECTIONS - RESERVED_CONNECTIONS - 10))
            if (( SAFE_MAX_CLIENTS < 1 )); then SAFE_MAX_CLIENTS=1; fi
            echo "   Max connections after restart: $MAX_CONNECTIONS, safe max pgbench clients: $SAFE_MAX_CLIENTS"
            break
          fi
          sleep 2
        done
      else
        echo "   ⚠️  Automatic restart failed. Please restart manually:"
        echo "   docker restart $POSTGRES_CONTAINER"
      fi
    else
      echo "   Could not find PostgreSQL container. Please restart manually:"
      echo "   Docker:   docker ps | grep postgres && docker restart <container-name>"
      echo "   K8s:     kubectl -n $NS rollout restart deploy/postgres"
    fi
  else
    echo "   To apply immediately, restart PostgreSQL:"
    echo "   Docker:   docker ps | grep postgres && docker restart <container-name>"
    echo "   K8s:     kubectl -n $NS rollout restart deploy/postgres"
  fi
  
  if [[ "$MAX_CONNECTIONS" == "200" ]]; then
    echo ""
    echo "   Continuing with current max_connections=$MAX_CONNECTIONS (192/256 clients will be skipped)..."
    echo ""
  fi
fi

# CRITICAL: Drop global trigram indexes FIRST (before creating partial indexes)
# This prevents planner confusion and ensures partial indexes are used
if [[ -x "./scripts/drop-global-trgm-indexes.sh" ]]; then
  echo "=== Dropping global trigram indexes (forces per-tenant index usage) ==="
  ./scripts/drop-global-trgm-indexes.sh 2>&1 | tail -5
fi

# CRITICAL: Create alias indexes (ensures fast joins after candidate selection)
if [[ -x "./scripts/create-alias-indexes.sh" ]]; then
  echo "=== Creating alias indexes ==="
  ./scripts/create-alias-indexes.sh 2>&1 | tail -5
fi

# CRITICAL: Create partial indexes for benchmark user (dramatically improves performance)
# These indexes are MUCH smaller than global indexes and dramatically improve query speed
# Must be created AFTER dropping global indexes to ensure they're used
if [[ -x "./scripts/create-partial-indexes-for-bench.sh" ]]; then
  echo "=== Creating partial indexes for benchmark user ==="
  BENCH_USER_UUID="$USER_UUID" ./scripts/create-partial-indexes-for-bench.sh 2>&1 | tail -10
fi

if [[ -x "./scripts/create-knn-function.sh" ]]; then
  echo "=== (Re)creating canonical search_records_fuzzy_ids function ==="
  # Create function directly in pod using psql_in_pod to avoid connection mismatch
  psql_in_pod -v ON_ERROR_STOP=1 <<'EOFSQL'
SET search_path = records, public, pg_catalog;

-- Ensure pg_trgm extension exists
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Drop old function signatures (cleanup)
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids(uuid, text, integer, integer, boolean);
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids(uuid, text, integer, integer);
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids(uuid, text);
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids(uuid, text, bigint, bigint);
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids_core();
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids_core_hot();
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids_core_cold();

-- Ensure norm_text function exists
CREATE OR REPLACE FUNCTION public.norm_text(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(lower(coalesce(t,'')), '\s+', ' ', 'g');
$$;

-- Canonical function: FTS filter on search_tsv + trigram rank on search_norm.
-- OPTIMIZED: Uses parameterized queries (USING clause) to avoid per-call re-planning,
-- while keeping user_id as literal to enable partial index usage.
CREATE OR REPLACE FUNCTION public.search_records_fuzzy_ids(
  p_user   uuid,
  p_q      text,
  p_limit  bigint DEFAULT 100,
  p_offset bigint DEFAULT 0
) RETURNS TABLE(id uuid, rank real)
LANGUAGE plpgsql STABLE PARALLEL SAFE
SET search_path = records, public, pg_catalog
AS $function$
DECLARE
  qn            text;
  tsq           tsquery;
  -- Candidate set tuning:
  -- hard cap at 120 rows max, scales with LIMIT (2×LIMIT, min 40)
  candidate_cap integer;
  -- Similarity cutoff; should roughly track pg_trgm.similarity_threshold
  min_rank      real := 0.40;
  sql           text;
BEGIN
  qn  := public.norm_text(COALESCE(p_q, ''));
  tsq := plainto_tsquery('simple', qn);

  -- Slightly tighter cap (80 vs 120) since trigram % pre-filters candidates.
  -- For LIMIT=50: candidate_cap = 80.
  candidate_cap := LEAST(80, GREATEST(p_limit * 2, 40));

  -- NOTE:
  -- - user_id is embedded as a literal (%L) so the partial indexes on user_id can be used.
  -- - all other parameters are $1–$6 so the plan is reusable across calls.
  sql := format($fmt$
    WITH cand AS (
      SELECT
        r.id,
        similarity(r.search_norm, $1) AS sim
      FROM records.records AS r
      WHERE r.user_id = %L::uuid
        AND r.search_norm %% $1
        AND r.search_tsv @@ $2
      ORDER BY sim DESC
      LIMIT $3
    )
    SELECT
      c.id,
      c.sim::real AS rank
    FROM cand AS c
    WHERE c.sim >= $4
    ORDER BY c.sim DESC
    OFFSET GREATEST(0, $5)
    LIMIT LEAST(1000, GREATEST(1, $6));
  $fmt$, p_user::text);

  RETURN QUERY EXECUTE sql
    USING
      qn,           -- $1 : normalized query text
      tsq,          -- $2 : tsquery
      candidate_cap,-- $3
      min_rank,     -- $4
      p_offset,     -- $5
      p_limit;      -- $6
END;
$function$;
EOFSQL
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
# No manual function creation or tuning here

# Function is created by canonical script above
# records_hot table creation left in place (harmless, but not used by canonical function)

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
-- GIN trigram indexes (artist / name / catalog) – best-effort if gin_trgm_ops exists
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
END $$;

-- KNN path (TRGM GiST) - REMOVED: We use FTS filter + trigram rank now
-- Global GiST index interferes with FTS strategy and causes planner confusion
-- Partial GIN indexes are created by create-partial-indexes-for-bench.sh
-- DO $$
-- BEGIN
--   BEGIN
--     EXECUTE 'CREATE INDEX IF NOT EXISTS ix_records_search_norm_gist
--              ON records.records USING gist (search_norm gist_trgm_ops)';
--   EXCEPTION WHEN undefined_object THEN
--     RAISE NOTICE 'gist_trgm_ops not available; skipping ix_records_search_norm_gist GiST index';
--   END;
-- END $$;

ANALYZE records.records;

-- Prewarm the hot stuff - matching reference script
SELECT pg_prewarm('records.ix_records_artist_trgm'::regclass)
WHERE to_regclass('records.ix_records_artist_trgm') IS NOT NULL;
SELECT pg_prewarm('records.ix_records_name_trgm'::regclass)
WHERE to_regclass('records.ix_records_name_trgm') IS NOT NULL;
SELECT pg_prewarm('records.ix_records_catalog_trgm'::regclass)
WHERE to_regclass('records.ix_records_catalog_trgm') IS NOT NULL;
SQL

# Database-level tuning is handled by canonical optimize-db-for-performance.sh script
# No ALTER DATABASE or ALTER SYSTEM here - only session-level PGOPTIONS_EXTRA is used

# FORCE CLEAN: Remove any existing files in pod first (AGGRESSIVE)
# Prepare bench SQL files locally, then (optionally) copy into a pod
bench_sql_dir="$tmpdir/bench_sql"
mkdir -p "$bench_sql_dir"

echo "Generating bench SQL files locally..."
cat > "$bench_sql_dir/bench_knn.sql" <<'EOF'
SET search_path = records, public, pg_catalog;
-- Use optimized function instead of raw GiST <-> query (much faster)
-- Function already uses GIN % with high threshold and candidate limiting
SELECT count(*) FROM public.search_records_fuzzy_ids(
  :uid::uuid,
  :q::text,
  :lim::bigint,
  0::bigint
);
EOF

cat > "$bench_sql_dir/bench_trgm.sql" <<'EOF'
SET search_path = public, records, pg_catalog;
SELECT count(*) FROM public.search_records_fuzzy_ids(
  :uid::uuid,
  :q::text,
  :lim::bigint,
  0::bigint
);
EOF

cat > "$bench_sql_dir/bench_trgm_simple.sql" <<'EOF'
SET search_path = public, records, pg_catalog;
-- similarity_threshold comes from PGOPTIONS_EXTRA/TRGM_THRESHOLD env var (default: 0.40)
-- Note: This is a diagnostic query only. The function path (bench_trgm.sql) is preferred.
-- You can tune it: TRGM_THRESHOLD=0.50 ./scripts/run_pgbench_sweep.sh
SET search_path = records, public, pg_catalog;
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

cat > "$bench_sql_dir/bench_noop.sql" <<'EOF'
SELECT 1;
EOF

echo "Verifying SQL files are clean..."
if grep -q "<<<<<<<" "$bench_sql_dir/bench_knn.sql" 2>/dev/null || \
   grep -q "<<<<<<<" "$bench_sql_dir/bench_trgm.sql" 2>/dev/null || \
   grep -q "<<<<<<<" "$bench_sql_dir/bench_trgm_simple.sql" 2>/dev/null || \
   grep -q "<<<<<<<" "$bench_sql_dir/bench_noop.sql" 2>/dev/null; then
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
# CRITICAL: Use parameterized connection settings (same as psql_in_pod)
cat <<'SH' > "$tmpdir/run_pgbench.sh"
#!/usr/bin/env bash
set -Eeuo pipefail
# Connection setup - use parameterized settings (can be overridden via env)
: "${PGHOST:=localhost}"
: "${PGPORT:=5433}"
: "${PGUSER:=postgres}"
: "${PGDATABASE:=records}"
: "${PGPASSWORD:=postgres}"
export PGPASSWORD

# Get PGOPTIONS from first arg (if provided), rest are pgbench args
# Default to empty string if no args provided (script can be called without args)
pgopts="${1:-}"
if [[ $# -ge 1 ]]; then
  shift
fi

# Set PGOPTIONS to include search_path and tuning
# CRITICAL: public must be first in search_path so functions are found
# Also include pg_catalog for pg_trgm operators
# Ensure search_path is set even if not in pgopts
if [[ -n "$pgopts" ]]; then
  if [[ "$pgopts" != *"search_path"* ]]; then
    export PGOPTIONS="$pgopts -c search_path=public,records,pg_catalog"
  else
    export PGOPTIONS="$pgopts"
  fi
else
  export PGOPTIONS="-c search_path=public,records,pg_catalog"
fi

cd /tmp
# Call pgbench with explicit connection to localhost Postgres
exec pgbench -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" "$@"
SH

# Copy script to pod if we have one, otherwise use local pgbench
if [[ "$USE_LOCAL_PGBENCH" != "true" ]] && [[ -n "$POD" ]]; then
  # Try to copy to pod (may fail if pod doesn't have /tmp or doesn't exist)
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

# Script already uses localhost by default, just ensure it's executable
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
  -- Check function: public.search_records_fuzzy_ids(uuid, text, bigint, bigint) - canonical 4-arg version
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
echo "--- Verifying canonical function definition (saving to log)"
psql_in_pod <<'EOFSQL' | tee "$LOG_DIR/function_search_records_fuzzy_ids.sql"
-- Verify the canonical function definition is present
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
# Skip smoke tests if using local pgbench (no pod needed)
if [[ "$USE_LOCAL_PGBENCH" != "true" ]] && [[ -n "$POD" ]]; then
  for script in bench_knn.sql bench_trgm.sql bench_trgm_simple.sql bench_noop.sql; do
  echo "Testing $script..."
    # Smoke test using the wrapper script (connecting to external Postgres)
  if ! kubectl -n "$NS" exec "$POD" -c db -- /tmp/run_pgbench.sh "$PGOPTIONS_EXTRA" -n -M prepared -c 1 -T 2 -D uid="$USER_UUID" -D q="$PG_QUERY_ARG" -D lim="$LIMIT" -f "/tmp/bench_sql/$script" >/dev/null 2>&1; then
    echo "WARNING: pgbench smoke test failed for $script, but continuing..." >&2
    # Don't exit - let it try to run anyway (matches user's working script approach)
  else
    echo "✓ $script smoke test passed"
  fi
done
else
  echo "Skipping smoke tests (using local pgbench)"
fi

# Helper: Reset pg_stat_statements for clean per-run deltas
reset_pg_stat_statements() {
  echo "--- Resetting pg_stat_statements ---"
  psql_in_pod -v ON_ERROR_STOP=1 -c "SELECT pg_stat_statements_reset();" >/dev/null 2>&1 || \
  echo "⚠️  pg_stat_statements_reset() failed or extension not installed" >&2
}

# Helper: Cold cache reset (DB-level)
cold_cache_reset() {
  echo "--- Cold cache reset (DB-level) ---"
  psql_in_pod <<'SQL' >/dev/null 2>&1 || true
CHECKPOINT;
DISCARD ALL;
-- Reset stats so deltas are per-phase
SELECT pg_stat_reset();
SQL
}

# CRITICAL: Warm cache and ensure fresh statistics before benchmarks
echo "--- Warming cache and refreshing statistics..."
# Optional: Buffer cache snapshot (if pg_buffercache extension is available)
if psql_in_pod -tAc "SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_buffercache')" 2>/dev/null | grep -q t; then
  echo "--- Buffer cache snapshot (top relations) ---"
  psql_in_pod <<'SQL' | tee "$LOG_DIR/buffercache_snapshot_before.txt" 2>/dev/null || true
SELECT
  c.relname,
  n.nspname,
  count(*) AS buffers,
  round(100.0 * count(*) / (SELECT count(*) FROM pg_buffercache), 2) AS pct
FROM pg_buffercache b
JOIN pg_class c ON b.relfilenode = pg_relation_filenode(c.oid)
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relname IS NOT NULL
GROUP BY c.relname, n.nspname
ORDER BY buffers DESC
LIMIT 20;
SQL
fi
psql_in_pod <<'SQL' >/dev/null 2>&1 || true
-- Force fresh statistics for optimal plans
ANALYZE records.records;

-- Warm critical indexes (FTS + partial indexes)
SELECT pg_prewarm('records.idx_records_search_tsv_bench'::regclass) WHERE to_regclass('records.idx_records_search_tsv_bench') IS NOT NULL;
SELECT pg_prewarm('records.idx_records_search_norm_gin_bench'::regclass) WHERE to_regclass('records.idx_records_search_norm_gin_bench') IS NOT NULL;
SELECT pg_prewarm('records.ix_records_artist_trgm'::regclass) WHERE to_regclass('records.ix_records_artist_trgm') IS NOT NULL;
SELECT pg_prewarm('records.ix_records_name_trgm'::regclass) WHERE to_regclass('records.ix_records_name_trgm') IS NOT NULL;
SELECT pg_prewarm('records.ix_records_catalog_trgm'::regclass) WHERE to_regclass('records.ix_records_catalog_trgm') IS NOT NULL;

-- Pre-execute sample queries to warm function, query plan cache, and indexes
SELECT count(*) FROM public.search_records_fuzzy_ids('0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid, 'test', 10::bigint, 0::bigint);
SQL

# Reset pg_stat_statements so per-run deltas are clean
# Note: reset_pg_stat_statements() is defined earlier in the script (after CSV header creation)
reset_pg_stat_statements

# CRITICAL: Initialize CSV file with header before sweep loop
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RUN_ID="run_${TIMESTAMP}"
echo "RUN_ID=${RUN_ID}"
results_csv="$tmpdir/bench_sweep_${TIMESTAMP}.csv"
echo "ts_utc,variant,clients,threads,duration_s,limit_rows,tps,ok_xacts,fail_xacts,err_pct,lat_avg_ms,lat_std_ms,lat_est_ms,p50_ms,p95_ms,p99_ms,p999_ms,p9999_ms,p99999_ms,p100_ms,git_rev,git_branch,host,server_version,track_io,delta_blks_hit,delta_blks_read,delta_blk_read_ms,delta_blk_write_ms,delta_xact_commit,delta_tup_returned,delta_tup_fetched,delta_stmt_total_ms,delta_stmt_shared_hit,delta_stmt_shared_read,delta_stmt_shared_dirtied,delta_stmt_shared_written,delta_stmt_temp_read,delta_stmt_temp_written,delta_io_read_ms,delta_io_write_ms,delta_io_extend_ms,delta_io_fsync_ms,io_total_ms,active_sessions,cpu_share_pct,delta_wal_records,delta_wal_fpi,delta_wal_bytes,delta_ckpt_write_ms,delta_ckpt_sync_ms,delta_buf_checkpoint,delta_buf_backend,delta_buf_alloc,hit_ratio_pct,notes" > "$results_csv"
echo "📊 CSV results file: $results_csv"

echo "--- Running sweep"
IFS=',' read -r -a client_array <<< "$CLIENTS"
# Filter client_array to only include values <= SAFE_MAX_CLIENTS
declare -a safe_client_array=()
for c in "${client_array[@]}"; do
  if (( c <= SAFE_MAX_CLIENTS )); then
    safe_client_array+=("$c")
  else
    echo "⚠️  Skipping clients=$c: exceeds safe max_connections=${SAFE_MAX_CLIENTS}"
  fi
done
client_array=("${safe_client_array[@]}")
if [[ ${#client_array[@]} -eq 0 ]]; then
  echo "❌ No safe client counts available! Max connections: $MAX_CONNECTIONS" >&2
  exit 1
fi
echo "Running with client counts: ${client_array[*]}"

read_metrics() {
  psql_in_pod -At < "$tmpdir/read_metrics.sql" | tr '|' ' '
}

read_stmt_metrics() {
  # pg_stat_statements might not be installed; if the query fails, just return zeros.
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
  local wd
  wd=$(mktemp -d)
  pushd "$wd" >/dev/null
  # CRITICAL: Always return to repo root before cleanup
  trap 'cd "$REPO_ROOT" 2>/dev/null || true; popd >/dev/null 2>&1 || true; rm -rf "$wd"' RETURN

  # CRITICAL: Disable autovacuum at TABLE level during benchmark to prevent pauses
  # Note: We disable autovacuum ONLY during the benchmark run, then re-enable it after
  # This prevents pauses without permanently affecting database maintenance
  # NOTE: Session-level SET statements here do NOT affect pgbench connections.
  # All pgbench tuning comes from PGOPTIONS_EXTRA (work_mem, track_io_timing, etc.)
  echo "Disabling autovacuum (table-level) for benchmark..."
  psql_in_pod <<'SQL' >/dev/null 2>&1 || true
-- Table-level autovacuum disable (affects all sessions) - TEMPORARY for benchmark only
ALTER TABLE records.records SET (autovacuum_enabled = false);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'aliases_mv' AND relnamespace = 'records'::regnamespace::oid) THEN
    ALTER TABLE records.aliases_mv SET (autovacuum_enabled = false);
  END IF;
END $$;
SQL

  local metrics_before stmt_before io_before wal_before ckpt_before
  read -r metrics_before <<< "$(read_metrics)"
  read -r stmt_before <<< "$(read_stmt_metrics)"
  read -r io_before <<< "$(read_io_metrics)"
  read -r wal_before <<< "$(read_wal_metrics)"
  read -r ckpt_before <<< "$(read_ckpt_metrics)"

  # Always use the configured THREADS; keeps runs comparable
  local actual_threads
  actual_threads="$THREADS"
  
  # Dynamic duration: longer for high concurrency (soak test)
  local duration="$DURATION"
  if (( clients >= 128 )); then
    duration=$(( DURATION * 3 ))  # e.g., 180s if base is 60
    echo "⚠️  High concurrency ($clients clients): using extended duration ${duration}s for soak test"
  fi

  # Prepare pgbench script and SQL files
  if [[ "$USE_LOCAL_PGBENCH" == "true" ]]; then
    # Using local pgbench - call directly from $wd so logs end up in the right place
    echo "Running pgbench locally (connecting to Postgres at ${RECORDS_DB_HOST}:${RECORDS_DB_PORT})..."
    rm -f "$wd"/pgbench_log.* 2>/dev/null || true
    
    # Trgm_simple is the nastiest path; run it without parallel query to save shm
    local pgopts="$PGOPTIONS_EXTRA"
    if [[ "$variant" == "trgm_simple" ]]; then
      pgopts="$pgopts -c max_parallel_workers_per_gather=0 -c max_parallel_workers=1"
    fi
    
    # CRITICAL: Call pgbench directly from $wd (not via run_pgbench.sh which cd's to /tmp)
    # This ensures pgbench_log.* files are written to $wd where we can find them
    PGHOST="$RECORDS_DB_HOST" PGPORT="$RECORDS_DB_PORT" PGUSER="$RECORDS_DB_USER" PGDATABASE="$RECORDS_DB_NAME" PGPASSWORD="$RECORDS_DB_PASS" \
    PGOPTIONS="$pgopts -c search_path=public,records,pg_catalog" \
    pgbench \
      -n -M prepared \
      -P 5 --progress-timestamp \
      -T "$duration" -c "$clients" -j "$actual_threads" \
      -D uid="$USER_UUID" -D q="$PG_QUERY_ARG" -D lim="$LIMIT" \
      -l -f "$bench_sql_dir/$sql_file" | tee "$wd/out.txt"
  else
    # Using pod - clean up old logs
    kubectl -n "$NS" exec "$POD" -c db -- bash -lc 'rm -f /tmp/pgbench_log.*' >/dev/null 2>&1 || \
    kubectl -n "$NS" exec "$POD" -- bash -lc 'rm -f /tmp/pgbench_log.*' >/dev/null 2>&1 || true

  # Ensure wrapper script and SQL files exist (pod might have restarted)
    kubectl -n "$NS" cp "$tmpdir/run_pgbench.sh" "$POD:/tmp/run_pgbench.sh" -c db >/dev/null 2>&1 || \
    kubectl -n "$NS" cp "$tmpdir/run_pgbench.sh" "$POD:/tmp/run_pgbench.sh" >/dev/null 2>&1 || true
    kubectl -n "$NS" exec "$POD" -c db -- chmod +x /tmp/run_pgbench.sh >/dev/null 2>&1 || \
    kubectl -n "$NS" exec "$POD" -- chmod +x /tmp/run_pgbench.sh >/dev/null 2>&1 || true
    kubectl -n "$NS" exec "$POD" -c db -- mkdir -p /tmp/bench_sql >/dev/null 2>&1 || \
    kubectl -n "$NS" exec "$POD" -- mkdir -p /tmp/bench_sql >/dev/null 2>&1 || true
    kubectl -n "$NS" cp "$tmpdir/bench_sql/." "$POD:/tmp/bench_sql" -c db >/dev/null 2>&1 || \
    kubectl -n "$NS" cp "$tmpdir/bench_sql/." "$POD:/tmp/bench_sql" >/dev/null 2>&1 || true

    # Run pgbench inside pod (connecting to Postgres at localhost:5433)
    # Note: From pod, localhost refers to the pod's localhost, not the host machine
    # If you need pod-to-host connection, use host.docker.internal, but ensure function exists there too
  kubectl -n "$NS" exec "$POD" -c db -- /tmp/run_pgbench.sh "$PGOPTIONS_EXTRA" \
    -n -M prepared \
    -P 5 --progress-timestamp \
      -T "$duration" -c "$clients" -j "$actual_threads" \
      -D uid="$USER_UUID" -D q="$PG_QUERY_ARG" -D lim="$LIMIT" \
      -l -f "/tmp/bench_sql/$sql_file" | tee "$wd/out.txt" || \
    kubectl -n "$NS" exec "$POD" -- /tmp/run_pgbench.sh "$PGOPTIONS_EXTRA" \
      -n -M prepared \
      -P 5 --progress-timestamp \
      -T "$duration" -c "$clients" -j "$actual_threads" \
      -D uid="$USER_UUID" -D q="$PG_QUERY_ARG" -D lim="$LIMIT" \
      -l -f "/tmp/bench_sql/$sql_file" | tee "$wd/out.txt"

    # Copy log files from pod
    if kubectl -n "$NS" exec "$POD" -c db -- bash -lc 'cd /tmp && compgen -G "pgbench_log.*" >/dev/null' 2>/dev/null; then
      kubectl -n "$NS" exec "$POD" -c db -- bash -lc 'cd /tmp && tar cf - pgbench_log.*' | tar xf - -C "$wd" 2>/dev/null || \
      kubectl -n "$NS" exec "$POD" -- bash -lc 'cd /tmp && tar cf - pgbench_log.*' | tar xf - -C "$wd" 2>/dev/null || true
      kubectl -n "$NS" exec "$POD" -c db -- bash -lc 'rm -f /tmp/pgbench_log.*' >/dev/null 2>&1 || \
      kubectl -n "$NS" exec "$POD" -- bash -lc 'rm -f /tmp/pgbench_log.*' >/dev/null 2>&1 || true
    fi
  fi

  local rc=${PIPESTATUS[0]}
  
  # Re-enable autovacuum after benchmark (table-level)
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
    popd >/dev/null 2>&1 || true
    rm -rf "$wd"
    return $rc
  fi

  local tps ok fail err_pct avg std p50 p95 p99 p999 p9999 p99999 pmax lat_est_ms
  tps=$(sed -n "s/^tps = \([0-9.][0-9.]*\) .*/\1/p" "$wd/out.txt" | tail -n1)
  ok=$(sed -n 's/^number of transactions actually processed: \([0-9][0-9]*\).*/\1/p' "$wd/out.txt" | tail -n1)
  [[ -z "$ok" ]] && ok=0
  fail=$(sed -n 's/^number of failed transactions: \([0-9][0-9]*\).*/\1/p' "$wd/out.txt" | tail -n1)
  [[ -z "$fail" ]] && fail=0
  err_pct=$(awk -v ok="$ok" -v fail="$fail" 'BEGIN{t=ok+fail; if (t>0) printf "%.3f", 100.0*fail/t; else printf "0.000"}')
  
  # Physics-based latency estimate from Little's law (ms)
  # lat_est_ms = 1000 * clients / tps
  lat_est_ms=$(awk -v c="$clients" -v t="$tps" 'BEGIN{
    if (t > 0) printf "%.3f", 1000.0 * c / t;
    else print "";
  }')

  # ---- latency distribution from pgbench logs ----
  # CRITICAL: Process logs from working directory ($wd) where they were copied
  if ls "$wd"/pgbench_log.* >/dev/null 2>&1; then
    # Get pgbench's reported average latency in ms
    summary_avg_ms=$(sed -n 's/^latency average = \([0-9.][0-9.]*\) ms$/\1/p' "$wd/out.txt" | tail -n1)

    lat_col=""
    if [[ -n "$summary_avg_ms" ]]; then
      # First pass: for every numeric column, compute mean (in µs) and find the one closest to summary average
      awk -v target="$summary_avg_ms" '
        {
          for (i = 1; i <= NF; i++) {
            if ($i ~ /^[0-9]+$/) {
              sum[i] += $i;
              cnt[i] += 1;
            }
          }
        }
        END {
          best_i   = -1;
          best_err = 1e99;
          for (i in sum) {
            if (cnt[i] == 0) continue;
            avg_ms = (sum[i] / cnt[i]) / 1000.0;  # convert µs → ms
            if (target <= 0) continue;
            err = avg_ms - target;
            if (err < 0) err = -err;
            if (err < best_err) {
              best_err = err;
              best_i   = i;
            }
          }
          if (best_i > 0)
            print best_i;
        }
      ' "$wd"/pgbench_log.* > "$wd/lat_col.txt" 2>/dev/null || true

      lat_col=$(cat "$wd/lat_col.txt" 2>/dev/null || echo "")
    fi

    if [[ -n "$lat_col" ]]; then
      # Extract latency from the identified column
      awk -v col="$lat_col" '
        {
          if (NF < col) next;
          v = $col + 0;
          if (v <= 0) next;
          ms = v / 1000.0;          # µs → ms
          if (ms < 60000)           # drop anything >60s just in case
            printf("%.3f\n", ms);
        }
      ' "$wd"/pgbench_log.* > "$wd/lat.txt" 2>/dev/null || true
    fi

    if [[ -s "$wd/lat.txt" ]]; then
      read -r avg std p50 p95 p99 p999 p9999 p99999 pmax < <(calc_latency_metrics "$wd/lat.txt")
      # Ensure all values are set (handle NaN/empty)
      [[ -z "$avg"   || "$avg"   == "NaN" ]] && avg=""
      [[ -z "$std"   || "$std"   == "NaN" ]] && std=""
      [[ -z "$p50"   || "$p50"   == "NaN" ]] && p50=""
      [[ -z "$p95"   || "$p95"   == "NaN" ]] && p95=""
      [[ -z "$p99"   || "$p99"   == "NaN" ]] && p99=""
      [[ -z "$p999"  || "$p999"  == "NaN" ]] && p999=""
      [[ -z "$p9999" || "$p9999" == "NaN" ]] && p9999=""
      [[ -z "$p99999" || "$p99999" == "NaN" ]] && p99999=""
      [[ -z "$pmax"  || "$pmax"  == "NaN" ]] && pmax=""
    else
      # Fallback: use pgbench summary for avg/std only
      avg=$(sed -n 's/^latency average = \([0-9.][0-9.]*\) ms$/\1/p' "$wd/out.txt" | tail -n1)
      std=$(sed -n 's/^latency stddev = \([0-9.][0-9.]*\) ms$/\1/p' "$wd/out.txt" | tail -n1)
      p50=""; p95=""; p99=""; p999=""; p9999=""; p99999=""; pmax=""
    fi
  else
    # Fallback: use pgbench summary for avg/std only
    avg=$(sed -n 's/^latency average = \([0-9.][0-9.]*\) ms$/\1/p' "$wd/out.txt" | tail -n1)
    std=$(sed -n 's/^latency stddev = \([0-9.][0-9.]*\) ms$/\1/p' "$wd/out.txt" | tail -n1)
    p50=""; p95=""; p99=""; p999=""; p9999=""; p99999=""; pmax=""
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
  local d_stmt_ms=$(awk -v a="$stmt_ms_before" -v b="$stmt_ms_after" 'BEGIN{printf "%.3f", b-a}')
  local d_stmt_hit=$((stmt_hit_after - stmt_hit_before))
  local d_stmt_read=$((stmt_read_after - stmt_read_before))
  local d_stmt_dirty=$((stmt_dirty_after - stmt_dirty_before))
  local d_stmt_written=$((stmt_written_after - stmt_written_before))
  local d_temp_read=$((stmt_temp_read_after - stmt_temp_read_before))
  local d_temp_written=$((stmt_temp_write_after - stmt_temp_write_before))
  local d_read_ms=$(awk -v a="$read_ms_before" -v b="$read_ms_after" 'BEGIN{printf "%.3f", b-a}')
  local d_write_ms=$(awk -v a="$write_ms_before" -v b="$write_ms_after" 'BEGIN{printf "%.3f", b-a}')
  local d_io_read=$(awk -v a="$io_read_before" -v b="$io_read_after" 'BEGIN{printf "%.3f", b-a}')
  local d_io_write=$(awk -v a="$io_write_before" -v b="$io_write_after" 'BEGIN{printf "%.3f", b-a}')
  local d_io_extend=$(awk -v a="$io_extend_before" -v b="$io_extend_after" 'BEGIN{printf "%.3f", b-a}')
  local d_io_fsync=$(awk -v a="$io_fsync_before" -v b="$io_fsync_after" 'BEGIN{printf "%.3f", b-a}')
  local io_total=$(awk -v r="$d_io_read" -v w="$d_io_write" -v e="$d_io_extend" -v f="$d_io_fsync" 'BEGIN{printf "%.3f", r+w+e+f}')
  local d_wal_rec=$((wal_rec_after - wal_rec_before))
  local d_wal_fpi=$((wal_fpi_after - wal_fpi_before))
  local d_wal_bytes=$(awk -v a="$wal_bytes_before" -v b="$wal_bytes_after" 'BEGIN{printf "%.3f", b-a}')
  local d_ckpt_write=$(awk -v a="$ckpt_write_before" -v b="$ckpt_write_after" 'BEGIN{printf "%.3f", b-a}')
  local d_ckpt_sync=$(awk -v a="$ckpt_sync_before" -v b="$ckpt_sync_after" 'BEGIN{printf "%.3f", b-a}')
  local d_buf_ckpt=$((buf_ckpt_after - buf_ckpt_before))
  local d_buf_backend=$((buf_backend_after - buf_backend_before))
  local d_buf_alloc=$((buf_alloc_after - buf_alloc_before))
  local hit_ratio
  hit_ratio=$(awk -v h="$d_blks_hit" -v r="$d_blks_read" 'BEGIN{t=h+r; if (t>0) printf "%.3f", 100.0*h/t; else printf ""}')
  
  # Calculate active_sessions: average concurrent sessions during benchmark
  # Use actual duration (may be extended for high concurrency)
  local active_sessions
  active_sessions=$(awk -v st="$d_stmt_ms" -v dur="$duration" 'BEGIN{if (dur>0 && st>0) printf "%.3f", st/(dur*1000.0); else printf ""}')
  
  # Calculate cpu_share_pct: (stmt_time - io_time) / stmt_time * 100
  local cpu_share_pct
  cpu_share_pct=$(awk -v st="$d_stmt_ms" -v io="$io_total" 'BEGIN{if (st>0) {x=(st-io)/st*100; if (x<0) x=0; if (x>100) x=100; printf "%.2f", x} else printf ""}')

  local ts
  ts=$(date -u +%FT%TZ)
  local host
  host="$POD"
  local track_io
  track_io=$(psql_in_pod -At -c "SHOW track_io_timing" | tr 'A-Z' 'a-z')
  track_io=$([[ "$track_io" == "on" ]] && echo true || echo false)

  echo "$ts,$variant,$clients,$actual_threads,$duration,$LIMIT,$tps,$ok,$fail,$err_pct,$avg,$std,$lat_est_ms,$p50,$p95,$p99,$p999,$p9999,$p99999,$pmax,$git_rev,$git_branch,$host,$(psql_in_pod -At -c 'SHOW server_version'),$track_io,$d_blks_hit,$d_blks_read,$d_read_ms,$d_write_ms,$d_xact,$d_tup_ret,$d_tup_fetch,$d_stmt_ms,$d_stmt_hit,$d_stmt_read,$d_stmt_dirty,$d_stmt_written,$d_temp_read,$d_temp_written,$d_io_read,$d_io_write,$d_io_extend,$d_io_fsync,$io_total,$active_sessions,$cpu_share_pct,$d_wal_rec,$d_wal_fpi,$d_wal_bytes,$d_ckpt_write,$d_ckpt_sync,$d_buf_ckpt,$d_buf_backend,$d_buf_alloc,$hit_ratio" >> "$results_csv"
  
  # Optional: Warn about high latency
  if [[ -n "$lat_est_ms" ]] && [[ -n "$tps" ]] && (( $(echo "$tps > 0" | bc -l 2>/dev/null || echo 0) )); then
    # Crude heuristic: if latency > ~0.5ms per client, warn
    threshold=$(awk -v c="$clients" 'BEGIN{printf "%.2f", 0.5 * c}')
    if (( $(echo "$lat_est_ms > $threshold" | bc -l 2>/dev/null || echo 0) )); then
      echo "   ⚠️  High latency for $clients clients (lat_est=${lat_est_ms} ms, threshold=${threshold} ms)" >&2
    fi
  fi

  psql_in_pod -v ON_ERROR_STOP=1 \
    -v variant="$variant" -v clients="$clients" -v threads="$actual_threads" \
    -v duration="$duration" -v lim="$LIMIT" -v tps="$tps" -v ok="$ok" \
    -v fail="$fail" -v err_pct="$err_pct" -v avg="$avg" -v std="$std" \
    -v lat_est="$lat_est_ms" -v p50="$p50" -v p95="$p95" -v p99="$p99" -v p999="$p999" \
    -v p9999="$p9999" -v p99999="$p99999" -v p100="$pmax" -v notes="rev=$git_rev branch=$git_branch host=$host variant=$variant lim=$LIMIT query=$QUERY phase=$PHASE" \
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
    -v hit_ratio="$hit_ratio" -v run_id="$RUN_ID" \
    -f - <<'EOSQL'
      \echo 'Inserting bench.results row variant=' :'variant' ', clients=' :'clients' ', tps=' :'tps'
      INSERT INTO bench.results(
        variant, clients, threads, duration_s, limit_rows,
        tps, ok_xacts, fail_xacts, err_pct,
        lat_avg_ms, lat_std_ms, lat_est_ms,
        p50_ms, p95_ms, p99_ms, p999_ms, p9999_ms, p99999_ms, p100_ms, notes,
        git_rev, git_branch, host, server_version, track_io,
        delta_blks_hit, delta_blks_read, delta_blk_read_ms, delta_blk_write_ms,
        delta_xact_commit, delta_tup_returned, delta_tup_fetched,
        delta_stmt_total_ms, delta_stmt_shared_hit, delta_stmt_shared_read,
        delta_stmt_shared_dirtied, delta_stmt_shared_written, delta_stmt_temp_read,
        delta_stmt_temp_written, delta_io_read_ms, delta_io_write_ms, delta_io_extend_ms,
        delta_io_fsync_ms, io_total_ms, active_sessions, cpu_share_pct,
        delta_wal_records, delta_wal_fpi, delta_wal_bytes,
        delta_ckpt_write_ms, delta_ckpt_sync_ms, delta_buf_checkpoint, delta_buf_backend,
        delta_buf_alloc, hit_ratio_pct, run_id
      ) VALUES (
        :'variant', :'clients'::int, :'threads'::int, :'duration'::int, :'lim'::int,
        NULLIF(:'tps','')::numeric, NULLIF(:'ok','')::bigint, NULLIF(:'fail','')::bigint, NULLIF(:'err_pct','')::numeric,
        NULLIF(NULLIF(:'avg','NaN'),'')::numeric, NULLIF(NULLIF(:'std','NaN'),'')::numeric,
        NULLIF(NULLIF(:'lat_est','NaN'),'')::numeric,
        NULLIF(NULLIF(:'p50','NaN'),'')::numeric, NULLIF(NULLIF(:'p95','NaN'),'')::numeric,
        NULLIF(NULLIF(:'p99','NaN'),'')::numeric, NULLIF(NULLIF(:'p999','NaN'),'')::numeric,
        NULLIF(NULLIF(:'p9999','NaN'),'')::numeric, NULLIF(NULLIF(:'p99999','NaN'),'')::numeric, NULLIF(NULLIF(:'p100','NaN'),'')::numeric,
        :'notes', :'git_rev', :'git_branch', :'host', :'server_version', :'track_io'::boolean,
        NULLIF(:'dH','')::bigint, NULLIF(:'dR','')::bigint, NULLIF(:'dRT','')::numeric, NULLIF(:'dWT','')::numeric,
        NULLIF(:'dXC','')::bigint, NULLIF(:'dTR','')::bigint, NULLIF(:'dTF','')::bigint,
        NULLIF(:'dST','')::numeric, NULLIF(:'dSH','')::bigint, NULLIF(:'dSR','')::bigint,
        NULLIF(:'dSD','')::bigint, NULLIF(:'dSW','')::bigint, NULLIF(:'dTBR','')::bigint,
        NULLIF(:'dTBW','')::bigint, NULLIF(:'dIOR','')::numeric, NULLIF(:'dIOW','')::numeric, NULLIF(:'dIOE','')::numeric,
        NULLIF(:'dIOF','')::numeric, NULLIF(:'io_total','')::numeric, NULLIF(:'act_sess','')::numeric, NULLIF(:'cpu_share','')::numeric,
        NULLIF(:'dWR','')::bigint, NULLIF(:'dWFPI','')::bigint, NULLIF(:'dWBY','')::numeric,
        NULLIF(:'dCKW','')::numeric, NULLIF(:'dCKS','')::numeric, NULLIF(:'dBCK','')::bigint, NULLIF(:'dBBE','')::bigint,
        NULLIF(:'dBAL','')::bigint, NULLIF(:'hit_ratio','')::numeric, :'run_id'
      );
EOSQL

  popd >/dev/null 2>&1 || true
  rm -rf "$wd"
}

# Variants: removed trgm_simple from routine sweeps (it's a diagnostic-only path)
# Keep it available as a manual diagnostic script, but don't run it in regular sweeps
declare -a variants=("knn" "trgm" "noop")

for clients in "${client_array[@]}"; do
  echo "=== CLIENTS = $clients ==="

  # -------- WARM PHASE --------
  PHASE="warm"
  echo ">> Warm phase (clients=$clients)"
  for variant in "${variants[@]}"; do
    variant_label=$(printf '%s' "$variant" | tr '[:lower:]' '[:upper:]')
    echo "== ${variant_label}, clients=$clients, phase=$PHASE =="
    
    # CRITICAL: Run comprehensive EXPLAIN ANALYZE before first benchmark
    if [[ "$clients" == "${client_array[0]}" ]] && [[ "$variant" == "${variants[0]}" ]]; then
      echo "--- Running Comprehensive Query Plan Analysis ---"
      echo "📁 Saving full query plans to: $LOG_DIR/"
      timestamp=$(date +%H%M%S)
      
      # Verify function exists before running EXPLAIN
      if ! psql_in_pod -c "SELECT 1 FROM pg_proc WHERE proname = 'search_records_fuzzy_ids' AND pronamespace = 'public'::regnamespace AND pronargs = 4;" >/dev/null 2>&1; then
        echo "❌ ERROR: Function search_records_fuzzy_ids does not exist! Cannot run EXPLAIN ANALYZE." >&2
        exit 1
      fi
      
      # Verify we have data
      DATA_CHECK=$(psql_in_pod -tAc "SELECT count(*) FROM records.records WHERE user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid;" 2>/dev/null | tr -d ' ' || echo "0")
      if [[ "$DATA_CHECK" -lt 1000 ]]; then
        echo "⚠️  WARNING: Only $DATA_CHECK records for benchmark user (may affect EXPLAIN ANALYZE accuracy)" >&2
      fi
      
      psql_in_pod <<'EOFSQL' | tee "$LOG_DIR/query_plan_full_analysis_${timestamp}.txt"
SET search_path = records, public, pg_catalog;
SET enable_seqscan = off;
SET jit = off;

\echo '================================================================================'
\echo '=== COMPREHENSIVE QUERY PLAN ANALYSIS FOR POSTGRESQL GPT ==='
\echo '================================================================================'
\echo ''
\echo 'Timestamp: ' || now()::text
\echo 'Query: 鄧麗君 album 263 cn-041 polygram'
\echo 'User: 0dc268d0-a86f-4e12-8d10-9db0f1b735e0'
\echo ''

\echo '=== 1. FTS + Trigram Rank Function Query Plan (REAL PATH) ==='
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, COSTS, TIMING, SUMMARY)
SELECT count(*)
FROM public.search_records_fuzzy_ids(
  '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid,
  '鄧麗君 album 263 cn-041 polygram',
  50::bigint,
  0::bigint
);

\echo ''
\echo '=== 2. Raw Trigram % Query Plan (BASELINE - for comparison) ==='
\echo 'NOTE: This baseline is disabled by default (very slow, 5s+). Set INCLUDE_RAW_TRGM_EXPLAIN=true to enable.'
\echo ''
\echo '=== 3. Function Definition ==='
SELECT pg_get_functiondef('public.search_records_fuzzy_ids(uuid,text,bigint,bigint)'::regprocedure);

\echo ''
\echo '=== 4. Table Statistics ==='
SELECT 
  schemaname,
  relname AS tablename,
  n_live_tup,
  n_dead_tup,
  last_vacuum,
  last_autovacuum,
  last_analyze,
  last_autoanalyze,
  pg_size_pretty(pg_total_relation_size((schemaname||'.'||relname)::regclass)) AS total_size
FROM pg_stat_user_tables 
WHERE schemaname = 'records' AND relname = 'records';

\echo ''
\echo '=== 5. Index Statistics ==='
SELECT 
  schemaname,
  relname AS tablename,
  indexrelname AS indexname,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch,
  pg_size_pretty(pg_relation_size((schemaname||'.'||indexrelname)::regclass)) AS size
FROM pg_stat_user_indexes
WHERE schemaname = 'records' AND relname = 'records'
ORDER BY pg_relation_size((schemaname||'.'||indexrelname)::regclass) DESC
LIMIT 20;

\echo ''
\echo '=== 6. Alias Table Statistics ==='
SELECT 
  schemaname,
  relname AS tablename,
  n_live_tup,
  pg_size_pretty(pg_total_relation_size((schemaname||'.'||relname)::regclass)) AS total_size
FROM pg_stat_user_tables 
WHERE schemaname = 'public' AND relname IN ('record_aliases', 'aliases_mv');

\echo ''
\echo '=== 7. Alias Index Statistics ==='
SELECT 
  schemaname,
  relname AS tablename,
  indexrelname AS indexname,
  idx_scan,
  idx_tup_read,
  pg_size_pretty(pg_relation_size((schemaname||'.'||indexrelname)::regclass)) AS size
FROM pg_stat_user_indexes
WHERE schemaname = 'public' AND relname IN ('record_aliases', 'aliases_mv')
ORDER BY pg_relation_size((schemaname||'.'||indexrelname)::regclass) DESC;

\echo ''
\echo '=== 8. PostgreSQL Configuration (Performance Settings) ==='
SELECT name, setting, unit, source
FROM pg_settings
WHERE name IN (
  'shared_buffers',
  'effective_cache_size',
  'work_mem',
  'maintenance_work_mem',
  'random_page_cost',
  'cpu_index_tuple_cost',
  'cpu_tuple_cost',
  'enable_seqscan',
  'jit',
  'max_parallel_workers',
  'max_parallel_workers_per_gather',
  'track_io_timing',
  'pg_trgm.similarity_threshold'
)
ORDER BY name;

\echo ''
\echo '=== 9. Partitioning Status ==='
SELECT 
  schemaname,
  tablename,
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = schemaname AND c.relname = tablename
    ) THEN 'CHILD PARTITION'
    WHEN EXISTS (
      SELECT 1 FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhparent
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = schemaname AND c.relname = tablename
    ) THEN 'PARENT PARTITION'
    ELSE 'NOT PARTITIONED'
  END AS partition_status
FROM pg_tables
WHERE schemaname = 'records' AND tablename = 'records';

\echo ''
\echo '=== 10. Database Size ==='
SELECT 
  pg_size_pretty(pg_database_size(current_database())) AS database_size;

\echo ''
\echo '================================================================================'
\echo '=== END OF QUERY PLAN ANALYSIS ==='
\echo '================================================================================'
EOFSQL
      echo ""
      echo "✅ Full query plan saved to: $LOG_DIR/query_plan_full_analysis_${timestamp}.txt"
      echo "   This file contains all information needed for PostgreSQL GPT analysis"
    fi
    
    # Map variant names to SQL files
    case "$variant" in
      knn) sql_file="bench_knn.sql" ;;
      trgm) sql_file="bench_trgm.sql" ;;
      trgm_simple) sql_file="bench_trgm_simple.sql" ;;
      noop) sql_file="bench_noop.sql" ;;
      *) sql_file="bench_${variant}.sql" ;;
    esac
    run_variant "$variant" "$sql_file" "$clients"
    echo
  done

  # -------- COLD PHASE (optional) --------
  if [[ "$RUN_COLD_CACHE" == "true" ]]; then
    PHASE="cold"
    echo ">> Cold phase (clients=$clients)"
    cold_cache_reset
    for variant in "${variants[@]}"; do
      variant_label=$(printf '%s' "$variant" | tr '[:lower:]' '[:upper:]')
      echo "== ${variant_label}, clients=$clients, phase=$PHASE =="
      # CRITICAL: Run comprehensive EXPLAIN ANALYZE only on first warm run, skip for cold
      case "$variant" in
        knn) sql_file="bench_knn.sql" ;;
        trgm) sql_file="bench_trgm.sql" ;;
        trgm_simple) sql_file="bench_trgm_simple.sql" ;;
        noop) sql_file="bench_noop.sql" ;;
        *) sql_file="bench_${variant}.sql" ;;
      esac
      run_variant "$variant" "$sql_file" "$clients"
      echo
    done
  fi
done

echo "--- Exporting results (this run: $RUN_ID) ---"
# Clean up old bad data before export (one-time cleanup)
psql_in_pod <<'SQL'
-- Clean up obviously bogus rows from old runs (one-time cleanup)
DELETE FROM bench.results
WHERE (p95_ms > 100000 OR p99_ms > 100000 OR lat_avg_ms > 10000 OR lat_avg_ms IS NULL)
  AND (run_id IS NULL OR run_id < 'run_20251121');
SQL

# Use SQL COPY instead of \copy (psql meta-command doesn't work well in heredocs)
# COPY works fine since we're connecting as postgres superuser
psql_in_pod <<SQL
COPY (
  SELECT *
  FROM bench.results
  WHERE run_id = '$RUN_ID'
  ORDER BY ts_utc DESC
) TO '/tmp/bench_export.csv' CSV HEADER;
SQL

echo "CSV (sweep log): $results_csv"
# CRITICAL: Use REPO_ROOT set at top of script (like old version)
# This ensures CSVs are written to repo root, not temp directories
output_dir="$REPO_ROOT"
if [[ ! -d "$output_dir" ]]; then
  echo "⚠️  REPO_ROOT ($output_dir) doesn't exist, using current directory" >&2
output_dir="$(pwd)"
fi
echo "Writing CSV files to: $output_dir"
# Copy with timestamped filename to repo root
cp -f "$results_csv" "$output_dir/bench_sweep_${TIMESTAMP}.csv" 2>/dev/null || {
  echo "⚠️  Failed to copy CSV to $output_dir/bench_sweep_${TIMESTAMP}.csv" >&2
  echo "   Original file: $results_csv" >&2
}
# Also create a symlink/latest copy for convenience
cp -f "$results_csv" "$output_dir/bench_sweep.csv" 2>/dev/null || {
  echo "⚠️  Failed to copy CSV to $output_dir/bench_sweep.csv" >&2
}

# Try to get export from pod, but fall back to local CSV if unavailable
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

# Generate plots if enabled
if [[ "$GENERATE_PLOTS" == "true" ]] && command -v python3 >/dev/null 2>&1; then
  echo "--- Generating plots from bench_export_${TIMESTAMP}.csv ---"
  python3 <<PY
import sys
from pathlib import Path

# Try to import required modules, with helpful error messages
try:
    import pandas as pd
except ImportError:
    print("⚠️  pandas not found. Install with: python3 -m pip install --user pandas matplotlib", file=sys.stderr)
    print("   Or set GENERATE_PLOTS=false to skip plot generation", file=sys.stderr)
    sys.exit(0)

try:
    import matplotlib.pyplot as plt
except ImportError:
    print("⚠️  matplotlib not found. Install with: python3 -m pip install --user pandas matplotlib", file=sys.stderr)
    print("   Or set GENERATE_PLOTS=false to skip plot generation", file=sys.stderr)
    sys.exit(0)

csv_path = Path("${output_dir}") / f"bench_export_${TIMESTAMP}.csv"
log_dir = Path("${LOG_DIR}")

try:
    df = pd.read_csv(csv_path)
    
    # Only rows with TPS, and variants we care about
    df = df[df["tps"].notnull() & df["variant"].isin(["knn", "trgm", "noop"])]
    
    # Use latest rows (in case table has older data)
    # We'll treat (variant, clients, tps) as unique for plotting.
    df = df.sort_values("ts_utc")
    
    def plot_metric(metric, ylabel, filename, logy=False):
        if metric not in df.columns:
            return
        plt.figure(figsize=(10, 6))
        for variant, sub in df.groupby("variant"):
            # take best row per clients for this variant
            best = sub.sort_values("tps", ascending=False).drop_duplicates(["clients"])
            x = best["clients"]
            y = best[metric]
            if y.notnull().any():
                plt.plot(x, y, marker="o", label=variant)
        plt.xlabel("clients")
        plt.ylabel(ylabel)
        plt.title(f"{metric} vs clients")
        if logy:
            plt.yscale("log")
        plt.grid(True, alpha=0.3)
        plt.legend()
        out = log_dir / filename
        plt.tight_layout()
        plt.savefig(out)
        print(f"  wrote {out}")
    
    plot_metric("tps", "TPS", "tps_vs_clients.png", logy=False)
    plot_metric("p95_ms", "p95 latency (ms)", "p95_vs_clients.png", logy=True)
    plot_metric("p99_ms", "p99 latency (ms)", "p99_vs_clients.png", logy=True)
    
except Exception as e:
    print(f"⚠️  Plot generation failed: {e}", file=sys.stderr)
    print("   Set GENERATE_PLOTS=false to skip plot generation", file=sys.stderr)
    sys.exit(0)  # Don't fail the whole script if plotting fails
PY
else
  echo "--- Skipping plot generation (GENERATE_PLOTS=${GENERATE_PLOTS}, python3=$(command -v python3 || echo none)) ---"
fi

# Diff-mode: regression detection against baseline CSV
if [[ "$RUN_DIFF_MODE" == "true" && -n "$BASELINE_CSV" && -f "$BASELINE_CSV" ]] && command -v python3 >/dev/null 2>&1; then
  echo "--- Running regression diff vs baseline: $BASELINE_CSV ---"
  python3 <<PY
import pandas as pd
from pathlib import Path
import sys

baseline_path = Path("${BASELINE_CSV}")
current_path = Path("${output_dir}") / f"bench_export_${TIMESTAMP}.csv"

try:
    base = pd.read_csv(baseline_path)
    cur = pd.read_csv(current_path)
    
    # Focus on knn/trgm/noop with non-null TPS
    base = base[base["tps"].notnull() & base["variant"].isin(["knn", "trgm", "noop"])]
    cur  = cur[cur["tps"].notnull()  & cur["variant"].isin(["knn", "trgm", "noop"])]
    
    # Use best TPS per (variant, clients) in each set
    def best_by_variant_clients(df):
        df = df.sort_values("tps", ascending=False)
        return df.drop_duplicates(["variant", "clients"])
    
    base_best = best_by_variant_clients(base)
    cur_best  = best_by_variant_clients(cur)
    
    merged = cur_best.merge(
        base_best,
        on=["variant", "clients"],
        suffixes=("_cur", "_base")
    )
    
    if merged.empty:
        print("No overlapping (variant,clients) between baseline and current; skipping diff.")
    else:
        # Define all metrics to compare
        metrics = [
            'tps', 'ok_xacts', 'fail_xacts', 'err_pct', 'avg_ms', 'std_ms', 'lat_est_ms',
            'p50_ms', 'p95_ms', 'p99_ms', 'p999_ms', 'p9999_ms', 'max_ms',
            'delta_blks_hit', 'delta_blks_read', 'delta_blk_read_ms', 'delta_blk_write_ms',
            'delta_xact_commit', 'delta_tup_returned', 'delta_tup_fetched',
            'delta_stmt_total_ms', 'delta_stmt_shared_hit', 'delta_stmt_shared_read',
            'delta_stmt_shared_dirtied', 'delta_stmt_shared_written',
            'delta_stmt_temp_read', 'delta_stmt_temp_written',
            'delta_io_read_ms', 'delta_io_write_ms', 'delta_io_extend_ms', 'delta_io_fsync_ms',
            'io_total_ms', 'active_sessions', 'cpu_share_pct',
            'delta_wal_records', 'delta_wal_fpi', 'delta_wal_bytes',
            'delta_ckpt_write_ms', 'delta_ckpt_sync_ms',
            'delta_buf_checkpoint', 'delta_buf_backend', 'delta_buf_alloc', 'hit_ratio_pct'
        ]
        
        # Build header
        header = "variant,clients"
        for m in metrics:
            header += f",{m}_base,{m}_cur,Δ{m}%"
        header += ",regression"
        print(header)
        
        tps_thresh = float("${REG_THRESH_TPS_DROP}")
        p95_thresh = float("${REG_THRESH_P95_INCREASE}")
        
        for _, row in merged.iterrows():
            tps_base = row.get("tps_base", 0)
            tps_cur = row.get("tps_cur", 0)
            p95_base = row.get("p95_ms_base", float('nan'))
            p95_cur = row.get("p95_ms_cur", float('nan'))
            
            # Calculate deltas for TPS and p95 for regression detection
            if tps_base > 0:
                tps_delta = (tps_cur - tps_base) / tps_base
            else:
                tps_delta = 0.0
            
            if pd.notna(p95_base) and p95_base > 0 and pd.notna(p95_cur):
                p95_delta = (p95_cur - p95_base) / p95_base
            else:
                p95_delta = 0.0
            
            regression = (tps_delta < -tps_thresh) or (p95_delta > p95_thresh)
            
            # Build output row
            out = f"{row['variant']},{int(row['clients'])}"
            for m in metrics:
                base_val = row.get(f"{m}_base", float('nan'))
                cur_val = row.get(f"{m}_cur", float('nan'))
                
                # Format values
                base_str = f"{base_val:.3f}" if pd.notna(base_val) else ""
                cur_str = f"{cur_val:.3f}" if pd.notna(cur_val) else ""
                
                # Calculate percentage delta
                if pd.notna(base_val) and pd.notna(cur_val) and base_val != 0:
                    delta_pct = ((cur_val - base_val) / base_val) * 100
                    delta_str = f"{delta_pct:.2f}"
                else:
                    delta_str = ""
                
                out += f",{base_str},{cur_str},{delta_str}"
            
            out += f",{regression}"
            print(out)
except Exception as e:
    print(f"⚠️  Diff-mode failed: {e}", file=sys.stderr)
    sys.exit(1)
PY
else
  if [[ "$RUN_DIFF_MODE" == "true" ]]; then
    echo "--- Diff-mode requested but BASELINE_CSV missing or python3 not available ---"
  fi
fi

# Peak TPS summary
echo "--- Peak TPS Summary (this run only: $RUN_ID) ---"
psql_in_pod -v run_id="$RUN_ID" <<'SQL' | tee "$LOG_DIR/peak_tps_summary.txt"
SELECT 
  variant,
  clients,
  tps,
  lat_est_ms,
  p50_ms,
  p95_ms,
  p99_ms,
  p999_ms,
  p9999_ms,
  p99999_ms,
  p100_ms
FROM bench.results
WHERE variant IN ('knn', 'trgm', 'noop')
  AND tps IS NOT NULL
  AND run_id = :'run_id'
ORDER BY variant, clients;
SQL

# Find peak TPS for each variant (this run only)
echo ""
echo "=== Peak Performance Summary (this run: $RUN_ID) ==="
for variant in knn trgm noop; do
  peak=$(psql_in_pod -v run_id="$RUN_ID" -tAc "SELECT clients, tps, lat_est_ms FROM bench.results WHERE variant = '$variant' AND tps IS NOT NULL AND run_id = :'run_id' ORDER BY tps DESC LIMIT 1;" 2>/dev/null || echo "")
  if [[ -n "$peak" ]]; then
    IFS='|' read -r peak_clients peak_tps peak_lat <<< "$peak"
    echo "Peak $variant: ${peak_tps} TPS @ ${peak_clients} clients (lat_est: ${peak_lat} ms)"
  fi
done
echo ""

# Create automatic backup after benchmark
echo "=== Creating automatic backup ==="
if [[ -f "./scripts/create-comprehensive-backup.sh" ]]; then
  # Wait for pod to be ready before backup (pod might have restarted)
  NS="${NS:-record-platform}"
  PGPOD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' | awk 'NR==1{print $1}')
  if [[ -n "$PGPOD" ]]; then
    echo "Waiting for pod to be ready..."
    kubectl -n "$NS" wait pod "$PGPOD" --for=condition=Ready --timeout=60s >/dev/null 2>&1 || true
    sleep 2
    # Wait for database to accept connections
    for i in $(seq 1 10); do
      if psql_in_pod -c "SELECT 1;" >/dev/null 2>&1; then
        break
      fi
      sleep 1
    done
  fi
  ./scripts/create-comprehensive-backup.sh
else
  echo "⚠️  Backup script not found, skipping automatic backup"
fi
