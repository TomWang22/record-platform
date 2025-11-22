#!/usr/bin/env bash
set -Eeuo pipefail

# Comprehensive aggressive optimization script
# Combines: restore, hot sharding, partitioning, top heap, aggressive tuning, VACUUM ANALYZE, EXPLAIN ANALYZE, prewarm
# Target: 28k TPS (gold run performance)

NS="${NS:-record-platform}"
USER_UUID="${USER_UUID:-0dc268d0-a86f-4e12-8d10-9db0f1b735e0}"
HOT_TARGET="${HOT_TARGET:-100000}"
BACKUP="${BACKUP:-backups/records_final_20251113_060218.dump}"

say() { printf "\n\033[1m=== %s ===\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
err() { echo "❌ $*" >&2; }

# Get postgres pod
PGPOD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' | awk 'NR==1{print $1}')
if [[ -z "$PGPOD" ]]; then
  err "Postgres pod not found"
  exit 1
fi

say "AGGRESSIVE REHYDRATION & TUNING"
echo "Pod: $PGPOD"
echo "User: $USER_UUID"
echo "Hot target: $HOT_TARGET"
echo ""

# Step 1: Restore database if backup provided
if [[ -n "${BACKUP:-}" ]] && [[ -f "$BACKUP" ]]; then
  say "Step 1: Restoring from backup"
  if [[ -f "./scripts/restore-from-local-backup.sh" ]]; then
    ./scripts/restore-from-local-backup.sh "$BACKUP" 2>&1 | tail -20
    ok "Database restored"
  else
    warn "Restore script not found, skipping restore"
  fi
else
  warn "No backup provided, skipping restore"
fi

# Step 2: Apply ALL aggressive system-level optimizations
say "Step 2: Applying Aggressive System-Level Optimizations"
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off -v ON_ERROR_STOP=1 <<'SQL'
-- ============================================
-- AGGRESSIVE SYSTEM-LEVEL SETTINGS
-- Target: 28k TPS, <2ms latency
-- ============================================

-- Memory & Cache
ALTER SYSTEM SET shared_buffers = '2GB';
ALTER SYSTEM SET effective_cache_size = '8GB';
ALTER SYSTEM SET work_mem = '256MB';
ALTER SYSTEM SET maintenance_work_mem = '1GB';
ALTER SYSTEM SET temp_buffers = '16MB';

-- Planner costs (aggressive for index preference)
ALTER SYSTEM SET random_page_cost = 0.8;
ALTER SYSTEM SET cpu_index_tuple_cost = 0.0005;
ALTER SYSTEM SET cpu_tuple_cost = 0.01;
ALTER SYSTEM SET cpu_operator_cost = 0.0025;
ALTER SYSTEM SET seq_page_cost = 1.0;

-- Parallelism (gold run: 12 workers, 4 per gather)
ALTER SYSTEM SET max_worker_processes = 16;
ALTER SYSTEM SET max_parallel_workers = 16;
ALTER SYSTEM SET max_parallel_workers_per_gather = 4;
ALTER SYSTEM SET parallel_leader_participation = on;

-- I/O & Checkpoints
ALTER SYSTEM SET effective_io_concurrency = 200;
ALTER SYSTEM SET checkpoint_completion_target = 0.9;
ALTER SYSTEM SET checkpoint_timeout = '15min';
ALTER SYSTEM SET max_wal_size = '4GB';
ALTER SYSTEM SET min_wal_size = '1GB';
ALTER SYSTEM SET wal_buffers = '16MB';
ALTER SYSTEM SET wal_compression = on;

-- Autovacuum (aggressive for fresh stats)
ALTER SYSTEM SET autovacuum = on;
ALTER SYSTEM SET autovacuum_naptime = '10s';
ALTER SYSTEM SET autovacuum_vacuum_scale_factor = 0.02;
ALTER SYSTEM SET autovacuum_analyze_scale_factor = 0.01;
ALTER SYSTEM SET autovacuum_vacuum_cost_limit = 10000;

-- JIT & Query Planning
ALTER SYSTEM SET jit = off;
ALTER SYSTEM SET track_io_timing = on;
ALTER SYSTEM SET default_statistics_target = 500;
ALTER SYSTEM SET constraint_exclusion = partition;

-- Connections
ALTER SYSTEM SET max_connections = 400;

-- Reload
SELECT pg_reload_conf();
SQL
ok "System-level settings applied"

# Step 3: Database-level settings
say "Step 3: Applying Database-Level Settings"
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off -v ON_ERROR_STOP=1 <<'SQL'
-- Database-level overrides (persistent)
ALTER DATABASE records SET random_page_cost = 0.8;
ALTER DATABASE records SET cpu_index_tuple_cost = 0.0005;
ALTER DATABASE records SET cpu_tuple_cost = 0.01;
ALTER DATABASE records SET effective_cache_size = '8GB';
ALTER DATABASE records SET work_mem = '256MB';
ALTER DATABASE records SET track_io_timing = on;
ALTER DATABASE records SET max_parallel_workers = 16;
ALTER DATABASE records SET max_parallel_workers_per_gather = 4;
ALTER DATABASE records SET search_path = 'records, public';
ALTER DATABASE records SET jit = off;
SQL
ok "Database-level settings applied"

# Step 4: Ensure all extensions exist
say "Step 4: Creating Extensions"
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off -v ON_ERROR_STOP=1 <<'SQL'
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pg_prewarm;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS btree_gist;
SQL
ok "Extensions created"

# Step 5: Create norm_text function
say "Step 5: Creating norm_text Function"
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off -v ON_ERROR_STOP=1 <<'SQL'
CREATE OR REPLACE FUNCTION public.norm_text(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(lower(unaccent(coalesce(t,''))), '\s+', ' ', 'g');
$$;
SQL
ok "norm_text function created"

# Step 6: Ensure search_norm column exists and is populated
say "Step 6: Populating search_norm Column"
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off -v ON_ERROR_STOP=1 <<'SQL'
ALTER TABLE records.records ADD COLUMN IF NOT EXISTS search_norm text;
ALTER TABLE records.records ADD COLUMN IF NOT EXISTS artist_norm text;
ALTER TABLE records.records ADD COLUMN IF NOT EXISTS name_norm text;
ALTER TABLE records.records ADD COLUMN IF NOT EXISTS label_norm text;
ALTER TABLE records.records ADD COLUMN IF NOT EXISTS catalog_norm text;

-- Populate in batches (faster)
DO $$
DECLARE
  batch_size int := 100000;
  updated int;
BEGIN
  LOOP
    UPDATE records.records
    SET search_norm = lower(concat_ws(' ', artist, name, catalog_number)),
        artist_norm = norm_text(artist),
        name_norm = norm_text(name),
        label_norm = norm_text(label),
        catalog_norm = norm_text(catalog_number)
    WHERE search_norm IS NULL
    LIMIT batch_size;
    GET DIAGNOSTICS updated = ROW_COUNT;
    EXIT WHEN updated = 0;
    RAISE NOTICE 'Updated % rows', updated;
  END LOOP;
END $$;
SQL
ok "search_norm column populated"

# Step 7: Create ALL critical indexes (GIN, GiST, composite, partial)
say "Step 7: Creating ALL Critical Indexes"
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off -v ON_ERROR_STOP=1 <<'SQL'
SET search_path = records, public;

-- User indexes
CREATE INDEX IF NOT EXISTS idx_records_user ON records.records(user_id);
CREATE INDEX IF NOT EXISTS idx_records_user_updated ON records.records(user_id, updated_at DESC);

-- TRGM GIN indexes (for ILIKE/similarity) - fastupdate=off for better query performance
CREATE INDEX IF NOT EXISTS idx_records_artist_trgm ON records.records USING gin(artist gin_trgm_ops) WITH (fastupdate=off);
CREATE INDEX IF NOT EXISTS idx_records_name_trgm ON records.records USING gin(name gin_trgm_ops) WITH (fastupdate=off);
CREATE INDEX IF NOT EXISTS idx_records_catalog_trgm ON records.records USING gin(catalog_number gin_trgm_ops) WITH (fastupdate=off);
CREATE INDEX IF NOT EXISTS idx_records_search_norm_gin ON records.records USING gin(search_norm gin_trgm_ops) WITH (fastupdate=off);

-- GiST indexes (for KNN distance queries)
CREATE INDEX IF NOT EXISTS idx_records_search_norm_gist ON records.records USING gist(search_norm gist_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_records_artist_gist_trgm ON records.records USING gist(artist_norm gist_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_records_name_gist_trgm ON records.records USING gist(name_norm gist_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_records_label_gist_trgm ON records.records USING gist(label_norm gist_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_records_catalog_gist_trgm ON records.records USING gist(catalog_norm gist_trgm_ops);

-- Composite GiST (user_id + search_norm for KNN)
CREATE INDEX IF NOT EXISTS idx_records_user_search_gist_trgm ON records.records USING gist(user_id, search_norm gist_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_records_knn_user_search_gist ON records.records USING gist(search_norm gist_trgm_ops, user_id);

-- Partial index for hot tenant (if exists)
CREATE INDEX IF NOT EXISTS idx_records_hot_tenant_search_gist ON records.records USING gist(search_norm gist_trgm_ops)
  WHERE user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid;
SQL
ok "All indexes created"

# Step 8: Create/refresh hot slice (top heap optimization)
say "Step 8: Creating Hot Slice (Top Heap)"
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off -v ON_ERROR_STOP=1 <<SQL
SET search_path = records, public;

CREATE SCHEMA IF NOT EXISTS records_hot;
CREATE TABLE IF NOT EXISTS records_hot.records_hot (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  search_norm text NOT NULL
);

-- Config table for hot tenants
CREATE TABLE IF NOT EXISTS records_hot.config(user_id uuid PRIMARY KEY);
INSERT INTO records_hot.config(user_id) VALUES ('$USER_UUID'::uuid) ON CONFLICT (user_id) DO NOTHING;

-- Refresh hot slice (top heap: most recently updated)
TRUNCATE TABLE records_hot.records_hot;
INSERT INTO records_hot.records_hot (id, user_id, search_norm)
SELECT id, user_id, COALESCE(search_norm, '')
FROM records.records
WHERE user_id = '$USER_UUID'::uuid
ORDER BY updated_at DESC
LIMIT $HOT_TARGET;

-- Hot slice indexes (tenant-pinned)
CREATE INDEX IF NOT EXISTS records_hot_knn
  ON records_hot.records_hot USING gist (search_norm gist_trgm_ops)
  WHERE user_id = '$USER_UUID'::uuid;
CREATE INDEX IF NOT EXISTS records_hot_search_trgm_gist
  ON records_hot.records_hot USING gist (search_norm gist_trgm_ops);
CREATE INDEX IF NOT EXISTS records_hot_search_trgm_gin
  ON records_hot.records_hot USING gin (search_norm gin_trgm_ops) WITH (fastupdate=off);
CREATE INDEX IF NOT EXISTS records_hot_hottenant_trgm_gist
  ON records_hot.records_hot USING gist (search_norm gist_trgm_ops)
  WHERE user_id = '$USER_UUID'::uuid;

-- Sync trigger (keep hot slice in sync)
CREATE OR REPLACE FUNCTION records_hot.sync_hot() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM records_hot.records_hot WHERE id = OLD.id;
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM records_hot.config c WHERE c.user_id = COALESCE(NEW.user_id, OLD.user_id)) THEN
    INSERT INTO records_hot.records_hot(id, user_id, search_norm)
    VALUES (COALESCE(NEW.id, OLD.id), COALESCE(NEW.user_id, OLD.user_id), COALESCE(NEW.search_norm, OLD.search_norm))
    ON CONFLICT (id) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          search_norm = EXCLUDED.search_norm;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='records_hot_sync_ins' AND tgrelid='records.records'::regclass) THEN
    EXECUTE 'CREATE TRIGGER records_hot_sync_ins AFTER INSERT ON records.records FOR EACH ROW EXECUTE FUNCTION records_hot.sync_hot()';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='records_hot_sync_upd' AND tgrelid='records.records'::regclass) THEN
    EXECUTE 'CREATE TRIGGER records_hot_sync_upd AFTER UPDATE OF user_id, search_norm ON records.records FOR EACH ROW EXECUTE FUNCTION records_hot.sync_hot()';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='records_hot_sync_del' AND tgrelid='records.records'::regclass) THEN
    EXECUTE 'CREATE TRIGGER records_hot_sync_del AFTER DELETE ON records.records FOR EACH ROW EXECUTE FUNCTION records_hot.sync_hot()';
  END IF;
END $$;
SQL
ok "Hot slice created ($HOT_TARGET rows)"

# Step 9: Create optimized search functions
say "Step 9: Creating Optimized Search Functions"
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off -v ON_ERROR_STOP=1 <<'SQL'
SET search_path = public, records;

-- Core fuzzy search function (4 params, bigint)
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

-- Wrapper function (5 params, integer)
CREATE OR REPLACE FUNCTION public.search_records_fuzzy_ids(
  p_user UUID, p_q TEXT, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0, p_strict boolean DEFAULT false
) RETURNS TABLE(id UUID, rank real)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT * FROM public.search_records_fuzzy_ids_core(p_user, p_q, p_limit::bigint, p_offset::bigint);
$$;

-- Hot slice KNN-only function
CREATE OR REPLACE FUNCTION public.search_hot_knn_only(
  p_user uuid, p_q text, p_limit int DEFAULT 50, p_offset int DEFAULT 0, p_strict boolean DEFAULT false
) RETURNS TABLE(id uuid, rank real)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  WITH x AS (SELECT public.norm_text(coalesce(p_q,'')) AS q)
  SELECT h.id, (1::real - (h.search_norm <-> x.q)::real) AS rank
  FROM records_hot.records_hot h, x
  WHERE h.user_id = p_user
  ORDER BY h.search_norm <-> x.q
  LIMIT GREATEST(1, LEAST(1000, coalesce(p_limit,50)))
  OFFSET GREATEST(0, coalesce(p_offset,0));
$$;

-- Adaptive shortlist function
CREATE OR REPLACE FUNCTION public.search_hot_percent_then_knn_adapt(
  p_user uuid, p_q text, p_limit int DEFAULT 50, p_offset int DEFAULT 0, p_strict boolean DEFAULT false
) RETURNS TABLE(id uuid, rank real)
LANGUAGE plpgsql STABLE SET plan_cache_mode='force_custom_plan' SET enable_seqscan=off SET jit=off AS $$
DECLARE
  gates real[] := ARRAY[0.60,0.58,0.56,0.54,0.52,0.50];
  gate  real;
BEGIN
  FOREACH gate IN ARRAY gates LOOP
    RETURN QUERY
    WITH x AS (SELECT set_limit(gate) AS _, public.norm_text(coalesce(p_q,'')) AS q),
    cand AS (
      SELECT h.id AS cid, (h.search_norm <-> x.q) AS dist
      FROM records_hot.records_hot h, x
      WHERE h.user_id = p_user
        AND h.search_norm % x.q
        AND similarity(h.search_norm, x.q) >= gate
      ORDER BY 2 ASC
      LIMIT 600
    )
    SELECT cid::uuid AS id, (1::real - dist::real) AS rank
    FROM cand
    ORDER BY dist ASC
    LIMIT GREATEST(1, LEAST(1000, coalesce(p_limit,50)))
    OFFSET GREATEST(0, coalesce(p_offset,0));
    IF FOUND THEN RETURN; END IF;
  END LOOP;
  RETURN QUERY SELECT * FROM public.search_hot_knn_only(p_user, p_q, p_limit, p_offset, p_strict);
END$$;
SQL
ok "Search functions created"

# Step 10: Refresh materialized views
say "Step 10: Refreshing Materialized Views"
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off -v ON_ERROR_STOP=1 <<'SQL'
SET search_path = records, public;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_matviews WHERE schemaname='records' AND matviewname='aliases_mv') THEN
    REFRESH MATERIALIZED VIEW records.aliases_mv;
    RAISE NOTICE 'Refreshed aliases_mv';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_matviews WHERE schemaname='records' AND matviewname='search_doc_mv') THEN
    REFRESH MATERIALIZED VIEW records.search_doc_mv;
    RAISE NOTICE 'Refreshed search_doc_mv';
  END IF;
END $$;
SQL
ok "Materialized views refreshed"

# Step 11: VACUUM ANALYZE (all tables, partitions)
say "Step 11: Running VACUUM ANALYZE (All Tables & Partitions)"
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off -v ON_ERROR_STOP=1 <<'SQL'
SET search_path = records, public;

-- Main table
VACUUM (ANALYZE, VERBOSE) records.records;

-- Hot slice (if exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='records_hot') THEN
    EXECUTE 'VACUUM (ANALYZE, VERBOSE) records_hot.records_hot';
    RAISE NOTICE 'VACUUMed hot slice';
  END IF;
END $$;

-- Analyze all partitions
DO $$
DECLARE part_name text;
BEGIN
  FOR part_name IN 
    SELECT relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'records' AND c.relname LIKE 'records_p%' AND c.relkind = 'r'
  LOOP
    EXECUTE format('ANALYZE records.%I', part_name);
    RAISE NOTICE 'Analyzed partition: %', part_name;
  END LOOP;
END $$;
SQL
ok "VACUUM ANALYZE complete"

# Step 12: AGGRESSIVE PREWARM (top heap + all indexes)
say "Step 12: Aggressive Prewarm (Top Heap + All Indexes)"
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off -v ON_ERROR_STOP=1 <<'SQL'
SET search_path = records, public;

-- Prewarm main table heap (top pages only - most recently updated)
SELECT 'main_heap_top', pg_prewarm('records.records'::regclass, 'prefetch', 'main', NULL) 
WHERE EXISTS (SELECT 1 FROM pg_class WHERE relname='records' AND relnamespace='records'::regnamespace);

-- Prewarm hot slice heap + all its indexes
SELECT 'hot_heap', pg_prewarm('records_hot.records_hot'::regclass) 
WHERE EXISTS (SELECT 1 FROM pg_class WHERE relname='records_hot' AND relnamespace='records_hot'::regnamespace);

-- Prewarm ALL GIN indexes (TRGM)
DO $$
DECLARE idx regclass;
BEGIN
  FOR idx IN
    SELECT c.oid
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_index i ON i.indexrelid = c.oid
    WHERE n.nspname IN ('records', 'records_hot')
      AND c.relkind = 'i'
      AND pg_get_indexdef(i.indexrelid) LIKE '%USING gin%'
  LOOP
    PERFORM pg_prewarm(idx);
    RAISE NOTICE 'Prewarmed GIN: %', idx;
  END LOOP;
END $$;

-- Prewarm ALL GiST indexes (KNN)
DO $$
DECLARE idx regclass;
BEGIN
  FOR idx IN
    SELECT c.oid
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_index i ON i.indexrelid = c.oid
    WHERE n.nspname IN ('records', 'records_hot')
      AND c.relkind = 'i'
      AND pg_get_indexdef(i.indexrelid) LIKE '%USING gist%'
  LOOP
    PERFORM pg_prewarm(idx);
    RAISE NOTICE 'Prewarmed GiST: %', idx;
  END LOOP;
END $$;

-- Prewarm B-tree indexes (user_id, updated_at)
DO $$
DECLARE idx regclass;
BEGIN
  FOR idx IN
    SELECT c.oid
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_index i ON i.indexrelid = c.oid
    WHERE n.nspname = 'records'
      AND c.relkind = 'i'
      AND pg_get_indexdef(i.indexrelid) LIKE '%USING btree%'
      AND (c.relname LIKE '%user%' OR c.relname LIKE '%updated%')
  LOOP
    PERFORM pg_prewarm(idx);
    RAISE NOTICE 'Prewarmed B-tree: %', idx;
  END LOOP;
END $$;
SQL
ok "Aggressive prewarm complete"

# Step 13: EXPLAIN ANALYZE verification
say "Step 13: EXPLAIN ANALYZE Verification"
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off -v ON_ERROR_STOP=1 <<SQL
SET search_path = records, public;
SET enable_seqscan = off;
SET work_mem = '256MB';
SET random_page_cost = 0.8;

-- Verify TRGM query plan
\echo '=== TRGM Query Plan ==='
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*) FROM public.search_records_fuzzy_ids(
  '$USER_UUID'::uuid, '鄧麗君 album 263 cn-041 polygram', 50, 0, false
);

-- Verify KNN query plan (hot slice)
\echo '=== KNN Query Plan (Hot Slice) ==='
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*) FROM public.search_hot_knn_only(
  '$USER_UUID'::uuid, '鄧麗君 album 263 cn-041 polygram', 50, 0, false
);
SQL
ok "Query plans verified"

# Step 14: Final statistics
say "Step 14: Final Statistics"
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off <<'SQL'
SELECT 
  'records.records' AS table_name,
  n_live_tup AS row_count,
  pg_size_pretty(pg_total_relation_size('records.records'::regclass)) AS total_size
FROM pg_stat_user_tables 
WHERE schemaname='records' AND relname='records'
UNION ALL
SELECT 
  'records_hot.records_hot',
  n_live_tup,
  pg_size_pretty(pg_total_relation_size('records_hot.records_hot'::regclass))
FROM pg_stat_user_tables 
WHERE schemaname='records_hot' AND relname='records_hot';

SELECT 
  name, 
  setting, 
  unit,
  source
FROM pg_settings 
WHERE name IN (
  'shared_buffers',
  'work_mem',
  'effective_cache_size',
  'random_page_cost',
  'max_parallel_workers',
  'max_parallel_workers_per_gather',
  'jit'
)
ORDER BY name;
SQL

say "OPTIMIZATION COMPLETE"
ok "All optimizations applied successfully"
echo ""
echo "Next steps:"
echo "  1. Run benchmark: ./scripts/run_pgbench_sweep.sh"
echo "  2. Target: 28k TPS at 64 clients"
echo "  3. Expected latency: <2ms average"

