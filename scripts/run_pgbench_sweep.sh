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
THREADS=12
LIMIT=50
PGOPTIONS_EXTRA="-c jit=off -c random_page_cost=1.1 -c cpu_index_tuple_cost=0.0005 -c cpu_tuple_cost=0.01 -c effective_cache_size=4GB -c work_mem=16MB -c track_io_timing=on -c max_parallel_workers=12 -c max_parallel_workers_per_gather=4"

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

if [[ -z "$POD" ]]; then
  POD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' | awk 'NR==1{print $1}')
fi
if [[ -z "$POD" ]]; then
  echo "Unable to determine postgres pod" >&2
  exit 1
fi

echo "Using pod: $POD (namespace: $NS)"

tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT

cat <<'SQL' > "$tmpdir/prepare.sql"
SET search_path = records, public;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pg_prewarm;
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
CREATE UNIQUE INDEX IF NOT EXISTS bench_results_uq
  ON bench.results(ts_utc, variant, clients, threads, duration_s, limit_rows, host, git_rev);
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
    echo "NaN NaN NaN NaN NaN NaN NaN NaN"
    return
  fi
  local sorted="$lat_file.sorted"
  sort -n "$lat_file" -o "$sorted"
  local n
  n=$(wc -l < "$lat_file")
  local avg std
  read -r avg std < <(awk '{s+=$1; ss+=$1*$1} END {if (NR>0) {m=s/NR; v=(ss/NR)-(m*m); if (v<0) v=0; sd=sqrt(v); printf "%.6f %.6f", m, sd}}' "$lat_file")
  local i50 i95 i99 i999 i9999
  i50=$(percentile_idx 50 "$n")
  i95=$(percentile_idx 95 "$n")
  i99=$(percentile_idx 99 "$n")
  i999=$(percentile_idx 99.9 "$n")
  i9999=$(percentile_idx 99.99 "$n")
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
if ! kubectl -n "$NS" exec "$POD" -c db -- psql -U postgres -d records -c "SELECT 1 FROM records.records LIMIT 1;" >/dev/null 2>&1; then
  echo "⚠️  Database 'records' is missing or empty, attempting restore..."
  if [[ -f "./scripts/restore-from-local-backup.sh" ]] && [[ -f "backups/records_final_20251113_060218.dump" ]]; then
    echo "Restoring from backup..."
    ./scripts/restore-from-local-backup.sh backups/records_final_20251113_060218.dump 2>&1 | tail -10
    # Wait for restore to complete
    sleep 5
    # Verify restore
    if ! kubectl -n "$NS" exec "$POD" -c db -- psql -U postgres -d records -c "SELECT 1 FROM records.records LIMIT 1;" >/dev/null 2>&1; then
      echo "❌ Restore failed! Database still missing." >&2
      exit 1
    fi
    echo "✅ Database restored successfully"
  else
    echo "❌ Restore script or backup not found!" >&2
    exit 1
  fi
fi

# step 0: prepare extensions and indexes
kubectl -n "$NS" exec -i "$POD" -c db -- psql -U postgres -d records < "$tmpdir/prepare.sql" >/dev/null 2>&1 || true
kubectl -n "$NS" exec -i "$POD" -c db -- psql -U postgres -d records < "$tmpdir/prepare_table.sql" >/dev/null 2>&1 || true
kubectl -n "$NS" exec -i "$POD" -c db -- psql -U postgres -d records < "$tmpdir/create_indexes.sql" >/dev/null 2>&1 || true
kubectl -n "$NS" exec -i "$POD" -c db -- psql -U postgres -d records < "$tmpdir/create_bench_schema.sql" >/dev/null 2>&1 || true

# Apply all optimizations first (function creation, indexes, VACUUM ANALYZE, etc.)
echo "=== Applying all optimizations ==="
if [[ -f "./scripts/apply-all-optimizations.sh" ]]; then
  ./scripts/apply-all-optimizations.sh
else
  echo "⚠️  Optimization script not found, creating function manually..."
  kubectl -n "$NS" exec "$POD" -c db -- psql -U postgres -d records -X -P pager=off -v ON_ERROR_STOP=1 <<'SQL'
SET search_path = records, public;

-- Ensure norm_text function exists
CREATE OR REPLACE FUNCTION public.norm_text(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT lower(unaccent(COALESCE(t, '')));
$$;

-- Create the CORE function first (4 parameters, bigint)
CREATE OR REPLACE FUNCTION public.search_records_fuzzy_ids_core(
  p_user UUID, p_q TEXT, p_limit bigint DEFAULT 100, p_offset bigint DEFAULT 0
) RETURNS TABLE(id UUID, rank real)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  WITH norm AS (SELECT norm_text(COALESCE(p_q,'')) AS qn),
  cand_main AS (
    SELECT r.id, 1 - (r.search_norm <-> (SELECT qn FROM norm)) AS knn_rank
    FROM records.records r
    WHERE r.user_id = p_user
      AND (
        (length((SELECT qn FROM norm)) <= 2 AND r.search_norm LIKE (SELECT qn FROM norm) || '%') OR
        (length((SELECT qn FROM norm))  > 2 AND r.search_norm %    (SELECT qn FROM norm))
      )
    ORDER BY r.search_norm <-> (SELECT qn FROM norm)
    LIMIT LEAST(1000, GREATEST(1, p_limit*10))
  ),
  cand_alias AS (
    SELECT DISTINCT r.id, max(similarity(a.term_norm,(SELECT qn FROM norm))) AS alias_sim
    FROM public.record_aliases a
    JOIN records.records r ON r.id = a.record_id
    WHERE r.user_id = p_user
      AND (
        (length((SELECT qn FROM norm)) <= 2 AND a.term_norm LIKE (SELECT qn FROM norm) || '%') OR
        (length((SELECT qn FROM norm))  > 2 AND a.term_norm %    (SELECT qn FROM norm))
      )
    GROUP BY r.id
  )
  SELECT r.id,
         GREATEST(
           similarity(r.artist_norm,(SELECT qn FROM norm)),
           similarity(r.name_norm,  (SELECT qn FROM norm)),
           similarity(r.search_norm,(SELECT qn FROM norm)),
           COALESCE(ca.alias_sim,0)
         ) AS rank
  FROM (SELECT DISTINCT id FROM cand_main) cm
  JOIN records.records r ON r.id = cm.id
  LEFT JOIN cand_alias ca ON ca.id = r.id
  WHERE GREATEST(
    similarity(r.artist_norm,(SELECT qn FROM norm)),
    similarity(r.name_norm,  (SELECT qn FROM norm)),
    similarity(r.search_norm,(SELECT qn FROM norm)),
    COALESCE(ca.alias_sim,0)
  ) > 0.2
  ORDER BY rank DESC
  LIMIT LEAST(1000, GREATEST(1, p_limit))
  OFFSET GREATEST(0, p_offset);
$$;

-- Create the wrapper function (5 parameters, integer) - this is what pgbench calls
CREATE OR REPLACE FUNCTION public.search_records_fuzzy_ids(
  p_user UUID, p_q TEXT, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0, p_strict boolean DEFAULT false
) RETURNS TABLE(id UUID, rank real)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT * FROM public.search_records_fuzzy_ids_core(p_user, p_q, p_limit::bigint, p_offset::bigint);
$$;
SQL
fi

# Verify function exists before proceeding
echo ""
echo "=== Verifying function exists ==="
kubectl -n "$NS" exec "$POD" -c db -- psql -U postgres -d records -X -P pager=off <<'SQL'
SET search_path = records, public;

SELECT 
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' 
        AND p.proname = 'search_records_fuzzy_ids'
        AND pg_get_function_arguments(p.oid) LIKE '%integer, integer, boolean%'
    ) THEN '✅ Function exists (5-parameter version)'
    ELSE '❌ Function NOT found or wrong signature - benchmarks will fail!'
  END as status;
SQL

# Setup indexes and search_norm column (matching reference script)
echo "Setting up indexes and search_norm column (matching reference script)..."
kubectl -n "$NS" exec "$POD" -c db -- psql -U postgres -d records -X -P pager=off -v ON_ERROR_STOP=1 <<'SQL'
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
CREATE INDEX IF NOT EXISTS ix_records_artist_trgm
  ON records.records USING gin (artist gin_trgm_ops);
CREATE INDEX IF NOT EXISTS ix_records_name_trgm
  ON records.records USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS ix_records_catalog_trgm
  ON records.records USING gin (catalog_number gin_trgm_ops);

-- KNN path (TRGM GiST) on the real column (no expression) - matching reference script
CREATE INDEX IF NOT EXISTS ix_records_search_norm_gist
  ON records.records USING gist (search_norm gist_trgm_ops);

ANALYZE records.records;

-- Prewarm the hot stuff - matching reference script
SELECT pg_prewarm('records.ix_records_artist_trgm'::regclass)
WHERE to_regclass('records.ix_records_artist_trgm') IS NOT NULL;
SELECT pg_prewarm('records.ix_records_name_trgm'::regclass)
WHERE to_regclass('records.ix_records_name_trgm') IS NOT NULL;
SELECT pg_prewarm('records.ix_records_catalog_trgm'::regclass)
WHERE to_regclass('records.ix_records_catalog_trgm') IS NOT NULL;
SELECT pg_prewarm('records.ix_records_search_norm_gist'::regclass)
WHERE to_regclass('records.ix_records_search_norm_gist') IS NOT NULL;
SQL

# Run VACUUM ANALYZE and set database-level settings (persist across all connections)
echo "Running VACUUM ANALYZE and setting database-level tuning..."
kubectl -n "$NS" exec "$POD" -c db -- psql -U postgres -d records -X -P pager=off -v ON_ERROR_STOP=1 <<'SQL'
-- Set database-level defaults (persist across all connections)
ALTER DATABASE records SET random_page_cost = 1.1;
ALTER DATABASE records SET cpu_index_tuple_cost = 0.0005;
ALTER DATABASE records SET cpu_tuple_cost = 0.01;
ALTER DATABASE records SET effective_cache_size = '4GB';
ALTER DATABASE records SET work_mem = '16MB';
ALTER DATABASE records SET track_io_timing = on;  -- Critical for performance tracking
ALTER DATABASE records SET search_path = 'records, public';  -- Ensure schema is in path

-- Also set at session level for immediate effect
SET random_page_cost = 1.1;
SET cpu_index_tuple_cost = 0.0005;
SET cpu_tuple_cost = 0.01;
SET effective_cache_size = '4GB';
SET work_mem = '16MB';
SET track_io_timing = on;
SET max_parallel_workers = 12;
SET max_parallel_workers_per_gather = 4;
SET search_path = records, public;

-- Force VACUUM ANALYZE for fresh statistics (critical for 1.13M records)
VACUUM ANALYZE records.records;

-- Analyze all partitions separately
DO $$
DECLARE part_name text;
BEGIN
  FOR part_name IN 
    SELECT relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'records' AND c.relname LIKE 'records_p%' AND c.relkind = 'r'
  LOOP
    EXECUTE format('ANALYZE records.%I', part_name);
  END LOOP;
END $$;

-- Refresh materialized views
REFRESH MATERIALIZED VIEW IF EXISTS records.aliases_mv;

-- Prewarm critical indexes for better performance
DO $$
DECLARE idx_name text;
BEGIN
  FOR idx_name IN 
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'records' 
      AND tablename = 'records'
      AND (indexname LIKE '%search_norm%' OR indexname LIKE '%gist%' OR indexname LIKE '%gin%')
    LIMIT 10
  LOOP
    BEGIN
      PERFORM pg_prewarm('records.'||idx_name::regclass);
    EXCEPTION WHEN OTHERS THEN
      -- Ignore errors
    END;
  END LOOP;
END $$;
SQL

mkdir -p "$tmpdir/bench_sql"
cat <<'SQL' > "$tmpdir/bench_sql/bench_knn.sql"
-- KNN query (simplified to match reference script exactly)
-- Direct KNN on search_norm column (no CASE statements that prevent index usage)
-- Using fully qualified schema.table name
SELECT count(*) FROM (
  SELECT r.id
  FROM records.records r
  WHERE r.user_id = :uid::uuid
  ORDER BY r.search_norm <-> lower(:q::text)
  LIMIT :lim::integer
) s;
SQL

cat <<'SQL' > "$tmpdir/bench_sql/bench_trgm.sql"
-- TRGM query (using fully qualified schema.table name)
SELECT count(*) FROM (
  SELECT id
  FROM records.records
  WHERE user_id = :uid::uuid
    AND (
      artist ILIKE '%' || :q || '%' OR
      name   ILIKE '%' || :q || '%' OR
      catalog_number ILIKE '%' || :q || '%'
    )
  ORDER BY updated_at DESC
  LIMIT :lim::integer
) s;
SQL

kubectl -n "$NS" exec "$POD" -c db -- mkdir -p /tmp/bench_sql >/dev/null 2>&1 || true
kubectl -n "$NS" cp "$tmpdir/bench_sql/." "$POD:/tmp/bench_sql" -c db >/dev/null
cat <<'SH' > "$tmpdir/run_pgbench.sh"
#!/usr/bin/env bash
set -Eeuo pipefail
# Connection setup (unix socket; no password) - matching reference script exactly
: "${PGHOST:=/var/run/postgresql}"
: "${PGUSER:=postgres}"
: "${PGDATABASE:=records}"
unset PGPASSWORD
# Get PGOPTIONS from first arg, rest are pgbench args
if [[ $# -lt 1 ]]; then
  echo "usage: $0 <pgoptions> [pgbench args...]" >&2
  exit 1
fi
pgopts="$1"
shift
# Set PGOPTIONS to include search_path for all connections
export PGOPTIONS="$pgopts -c search_path=records,public"
cd /tmp
# Call pgbench with explicit database connection (must use -d records)
exec pgbench -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" "$@"
SH
kubectl -n "$NS" cp "$tmpdir/run_pgbench.sh" "$POD:/tmp/run_pgbench.sh" -c db >/dev/null
kubectl -n "$NS" exec "$POD" -c db -- chmod +x /tmp/run_pgbench.sh >/dev/null 2>&1 || true

echo "--- Smoke check"
for script in bench_knn.sql bench_trgm.sql; do
  echo "Testing $script..."
  # Smoke test using the wrapper script (unix socket)
  if ! kubectl -n "$NS" exec "$POD" -c db -- /tmp/run_pgbench.sh "$PGOPTIONS_EXTRA" -n -M prepared -c 1 -T 2 -D uid="$USER_UUID" -D q="$PG_QUERY_ARG" -D lim="$LIMIT" -f "/tmp/bench_sql/$script" >/dev/null 2>&1; then
    echo "WARNING: pgbench smoke test failed for $script, but continuing..." >&2
    # Don't exit - let it try to run anyway (matches user's working script approach)
  else
    echo "✓ $script smoke test passed"
  fi
done

echo "--- Running sweep"
IFS=',' read -r -a client_array <<< "$CLIENTS"
# Create timestamped filename
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
results_csv="$tmpdir/bench_sweep_${TIMESTAMP}.csv"
if [[ ! -f "$results_csv" ]]; then
  echo "ts_utc,variant,clients,threads,duration_s,limit_rows,tps,ok_xacts,fail_xacts,err_pct,avg_ms,std_ms,p50_ms,p95_ms,p99_ms,p999_ms,p9999_ms,max_ms,git_rev,git_branch,host,server_version,track_io,delta_blks_hit,delta_blks_read,delta_blk_read_ms,delta_blk_write_ms,delta_xact_commit,delta_tup_returned,delta_tup_fetched,delta_stmt_total_ms,delta_stmt_shared_hit,delta_stmt_shared_read,delta_stmt_shared_dirtied,delta_stmt_shared_written,delta_stmt_temp_read,delta_stmt_temp_written,delta_io_read_ms,delta_io_write_ms,delta_io_extend_ms,delta_io_fsync_ms,io_total_ms,active_sessions,cpu_share_pct,delta_wal_records,delta_wal_fpi,delta_wal_bytes,delta_ckpt_write_ms,delta_ckpt_sync_ms,delta_buf_checkpoint,delta_buf_backend,delta_buf_alloc,hit_ratio_pct" > "$results_csv"
fi

read_metrics() {
  kubectl -n "$NS" exec -i "$POD" -c db -- psql -U postgres -d records -At < "$tmpdir/read_metrics.sql" | tr '|' ' '
}

read_stmt_metrics() {
  kubectl -n "$NS" exec "$POD" -c db -- psql -U postgres -d records -At <<'SQL' | tr '|' ' '
    SELECT
      COALESCE(sum(total_exec_time),0),
      COALESCE(sum(shared_blks_hit),0),
      COALESCE(sum(shared_blks_read),0),
      COALESCE(sum(shared_blks_dirtied),0),
      COALESCE(sum(shared_blks_written),0),
      COALESCE(sum(temp_blks_read),0),
      COALESCE(sum(temp_blks_written),0)
    FROM pg_stat_statements
    WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database());
SQL
}

read_io_metrics() {
  kubectl -n "$NS" exec "$POD" -c db -- psql -U postgres -d records -At <<'SQL' | tr '|' ' '
    SELECT
      COALESCE(sum(read_time),0),
      COALESCE(sum(write_time),0),
      COALESCE(sum(extend_time),0),
      COALESCE(sum(fsync_time),0)
    FROM pg_stat_io;
SQL
}

read_wal_metrics() {
  kubectl -n "$NS" exec "$POD" -c db -- psql -U postgres -d records -At <<'SQL' | tr '|' ' '
    SELECT COALESCE(wal_records,0), COALESCE(wal_fpi,0), COALESCE(wal_bytes,0)
    FROM pg_stat_wal;
SQL
}

read_ckpt_metrics() {
  kubectl -n "$NS" exec "$POD" -c db -- psql -U postgres -d records -At <<'SQL' | tr '|' ' '
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
  trap 'rm -rf "$wd"' RETURN

  local metrics_before stmt_before io_before wal_before ckpt_before
  read -r metrics_before <<< "$(read_metrics)"
  read -r stmt_before <<< "$(read_stmt_metrics)"
  read -r io_before <<< "$(read_io_metrics)"
  read -r wal_before <<< "$(read_wal_metrics)"
  read -r ckpt_before <<< "$(read_ckpt_metrics)"

  kubectl -n "$NS" exec "$POD" -c db -- bash -lc 'rm -f /tmp/pgbench_log.*' >/dev/null 2>&1 || true

  # Ensure wrapper script and SQL files exist (pod might have restarted)
  kubectl -n "$NS" cp "$tmpdir/run_pgbench.sh" "$POD:/tmp/run_pgbench.sh" -c db >/dev/null 2>&1 || true
  kubectl -n "$NS" exec "$POD" -c db -- chmod +x /tmp/run_pgbench.sh >/dev/null 2>&1 || true
  kubectl -n "$NS" exec "$POD" -c db -- mkdir -p /tmp/bench_sql >/dev/null 2>&1 || true
  kubectl -n "$NS" cp "$tmpdir/bench_sql/." "$POD:/tmp/bench_sql" -c db >/dev/null 2>&1 || true

  # Run pgbench inside pod with unix socket (matching reference script)
  kubectl -n "$NS" exec "$POD" -c db -- /tmp/run_pgbench.sh "$PGOPTIONS_EXTRA" \
    -n -M prepared \
    -P 5 --progress-timestamp \
    -T "$DURATION" -c "$clients" -j "$THREADS" \
    -D uid="$USER_UUID" -D q="$PG_QUERY_ARG" -D lim="$LIMIT" \
    -l -f "/tmp/bench_sql/$sql_file" | tee out.txt

  if kubectl -n "$NS" exec "$POD" -c db -- bash -lc 'cd /tmp && compgen -G "pgbench_log.*" >/dev/null'; then
    kubectl -n "$NS" exec "$POD" -c db -- bash -lc 'cd /tmp && tar cf - pgbench_log.*' | tar xf - -C "$wd"
    kubectl -n "$NS" exec "$POD" -c db -- bash -lc 'rm -f /tmp/pgbench_log.*' >/dev/null 2>&1 || true
  fi

  local rc=${PIPESTATUS[0]}
  if [[ $rc -ne 0 ]]; then
    echo "pgbench failed for $variant (clients=$clients)" >&2
    return $rc
  fi

  local tps ok fail err_pct
  tps=$(sed -n "s/^tps = \([0-9.][0-9.]*\) .*/\1/p" out.txt | tail -n1)
  ok=$(sed -n 's/^number of transactions actually processed: \([0-9][0-9]*\).*/\1/p' out.txt | tail -n1)
  [[ -z "$ok" ]] && ok=0
  fail=$(sed -n 's/^number of failed transactions: \([0-9][0-9]*\).*/\1/p' out.txt | tail -n1)
  [[ -z "$fail" ]] && fail=0
  err_pct=$(awk -v ok="$ok" -v fail="$fail" 'BEGIN{t=ok+fail; if (t>0) printf "%.3f", 100.0*fail/t; else printf "0.000"}')

  shopt -s nullglob
  local log_files=(pgbench_log.*)
  shopt -u nullglob
  if (( ${#log_files[@]} )); then
    awk '{ if ($2 ~ /^[0-9]+$/) printf("%.3f\n", $2/1000.0); else if ($3 ~ /^[0-9]+$/) printf("%.3f\n", $3/1000.0); }' "${log_files[@]}" > lat.txt || true
  else
    : > lat.txt
  fi
  rm -f pgbench_log.* >/dev/null 2>&1 || true
  read -r avg std p50 p95 p99 p999 p9999 pmax < <(calc_latency_metrics lat.txt)

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
  local active_sessions
  active_sessions=$(awk -v st="$d_stmt_ms" -v dur="$DURATION" 'BEGIN{if (dur>0 && st>0) printf "%.3f", st/(dur*1000.0); else printf ""}')
  
  # Calculate cpu_share_pct: (stmt_time - io_time) / stmt_time * 100
  local cpu_share_pct
  cpu_share_pct=$(awk -v st="$d_stmt_ms" -v io="$io_total" 'BEGIN{if (st>0) {x=(st-io)/st*100; if (x<0) x=0; if (x>100) x=100; printf "%.2f", x} else printf ""}')

  local ts
  ts=$(date -u +%FT%TZ)
  local host
  host="$POD"
  local track_io
  track_io=$(kubectl -n "$NS" exec "$POD" -c db -- psql -U postgres -d records -At -c "SHOW track_io_timing" | tr 'A-Z' 'a-z')
  track_io=$([[ "$track_io" == "on" ]] && echo true || echo false)

  echo "$ts,$variant,$clients,$THREADS,$DURATION,$LIMIT,$tps,$ok,$fail,$err_pct,$avg,$std,$p50,$p95,$p99,$p999,$p9999,$pmax,$git_rev,$git_branch,$host,$(kubectl -n "$NS" exec "$POD" -c db -- psql -U postgres -d records -At -c 'SHOW server_version'),$track_io,$d_blks_hit,$d_blks_read,$d_read_ms,$d_write_ms,$d_xact,$d_tup_ret,$d_tup_fetch,$d_stmt_ms,$d_stmt_hit,$d_stmt_read,$d_stmt_dirty,$d_stmt_written,$d_temp_read,$d_temp_written,$d_io_read,$d_io_write,$d_io_extend,$d_io_fsync,$io_total,$active_sessions,$cpu_share_pct,$d_wal_rec,$d_wal_fpi,$d_wal_bytes,$d_ckpt_write,$d_ckpt_sync,$d_buf_ckpt,$d_buf_backend,$d_buf_alloc,$hit_ratio" >> "$results_csv"

  kubectl -n "$NS" exec "$POD" -c db -- psql -U postgres -d records \
    -v variant="$variant" -v clients="$clients" -v threads="$THREADS" \
    -v duration="$DURATION" -v lim="$LIMIT" -v tps="$tps" -v ok="$ok" \
    -v fail="$fail" -v err_pct="$err_pct" -v avg="$avg" -v std="$std" \
    -v p50="$p50" -v p95="$p95" -v p99="$p99" -v p999="$p999" \
    -v p9999="$p9999" -v p100="$pmax" -v notes="rev=$git_rev branch=$git_branch host=$host variant=$variant lim=$LIMIT" \
    -v git_rev="$git_rev" -v git_branch="$git_branch" -v host="$host" \
    -v server_version="$(kubectl -n "$NS" exec "$POD" -c db -- psql -U postgres -d records -At -c 'SHOW server_version')" \
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
      )
      ON CONFLICT ON CONSTRAINT bench_results_uq DO NOTHING;
EOSQL

  popd >/dev/null
}

declare -a variants=("knn" "trgm")
for clients in "${client_array[@]}"; do
  for variant in "${variants[@]}"; do
    variant_label=$(printf '%s' "$variant" | tr '[:lower:]' '[:upper:]')
    echo "== ${variant_label}, clients=$clients =="
    run_variant "$variant" "bench_${variant}.sql" "$clients"
    echo
  done
done

echo "--- Exporting results"
kubectl -n "$NS" exec "$POD" -c db -- psql -U postgres -d records -P pager=off <<'SQL'
\copy (SELECT * FROM bench.results ORDER BY ts_utc DESC LIMIT 1000) TO '/tmp/bench_export.csv' CSV HEADER
SQL

echo "CSV (sweep log): $results_csv"
output_dir="$(pwd)"
# Copy with timestamped filename
cp -f "$results_csv" "$output_dir/bench_sweep_${TIMESTAMP}.csv"
# Also create a symlink/latest copy for convenience
cp -f "$results_csv" "$output_dir/bench_sweep.csv"
remote_export="$output_dir/bench_export_${TIMESTAMP}.csv"
kubectl -n "$NS" cp "$POD:/tmp/bench_export.csv" "$remote_export" -c db >/dev/null 2>&1 || true
if [[ ! -s "$remote_export" || $(wc -l < "$remote_export" || echo 0) -le 1 ]]; then
  echo "bench.results empty or unavailable, using local sweep data for bench_export."
  cp -f "$results_csv" "$remote_export"
fi
cp -f "$remote_export" "$output_dir/bench_export.csv" 2>/dev/null || true
echo "Wrote $output_dir/bench_sweep_${TIMESTAMP}.csv"
echo "Wrote $output_dir/bench_export_${TIMESTAMP}.csv"
echo "Also wrote: $output_dir/bench_sweep.csv (latest)"
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
      if kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -c "SELECT 1;" >/dev/null 2>&1; then
        break
      fi
      sleep 1
    done
  fi
  ./scripts/create-comprehensive-backup.sh
else
  echo "⚠️  Backup script not found, skipping automatic backup"
fi
