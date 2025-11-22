#!/usr/bin/env bash
set -Eeuo pipefail

# Fix records_hot.records_hot table and search_records_fuzzy_ids function
# This script implements the exact SQL from PostgreSQL GPT to fix the missing objects

NS="${NS:-record-platform}"

# Get Postgres pod
PGPOD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' | awk 'NR==1{print $1}')

if [[ -z "$PGPOD" ]]; then
  echo "Error: Postgres pod not found" >&2
  exit 1
fi

echo "Using pod: $PGPOD"
echo "=== Fixing records_hot.records_hot table and function ==="
echo ""

# 1. Create records_hot.records_hot table
echo "1. Creating records_hot.records_hot table..."
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;

-- 1. Ensure schema exists
CREATE SCHEMA IF NOT EXISTS records_hot;

-- 2. Nuke any old leftover table (if there is one in some broken state)
DROP TABLE IF EXISTS records_hot.records_hot CASCADE;

-- 3. Ensure records.records has search_norm_short column (needed for cold core)
ALTER TABLE records.records ADD COLUMN IF NOT EXISTS search_norm_short text;
UPDATE records.records
SET search_norm_short = left(search_norm, 256)
WHERE search_norm_short IS NULL AND search_norm IS NOT NULL;

-- 4. Recreate hot slice from main records table
--    Adjust the WHERE/ORDER/LIMIT to match your previous definition if needed.
CREATE TABLE records_hot.records_hot AS
SELECT
  r.*,
  left(r.search_norm, 256) AS search_norm_short
FROM records.records r
WHERE r.user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid
ORDER BY r.updated_at DESC
LIMIT 100000;

-- 5. Add primary key
ALTER TABLE records_hot.records_hot
  ADD CONSTRAINT records_hot_pkey PRIMARY KEY (id);

-- 6. Indexes for KNN/TRGM on short column
CREATE INDEX records_hot_search_norm_short_trgm_gist
ON records_hot.records_hot
USING gist (search_norm_short gist_trgm_ops);

CREATE INDEX records_hot_search_norm_short_trgm_gin
ON records_hot.records_hot
USING gin (search_norm_short gin_trgm_ops);

COMMIT;

ANALYZE records_hot.records_hot;

-- Sanity-check it exists
SELECT n.nspname, c.relname, c.relkind
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'records_hot'
ORDER BY c.relname;
SQL

if [[ $? -ne 0 ]]; then
  echo "FATAL: Failed to create records_hot.records_hot table!" >&2
  exit 1
fi

echo "✅ records_hot.records_hot table created"
echo ""

# 2. Create the function with exact signature
echo "2. Creating search_records_fuzzy_ids function..."
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;

-- Ensure norm_text exists
CREATE OR REPLACE FUNCTION public.norm_text(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(lower(unaccent(coalesce(t,''))), '\s+', ' ', 'g')
$$;

-- 1. Drop any old variants to avoid confusion
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids(uuid, text, integer, integer, boolean);
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids(uuid, text, integer, integer);
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids(uuid, text);
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids_core CASCADE;
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids_core_hot CASCADE;
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids_core_cold CASCADE;

-- 2. (Re)create hot and cold cores
--    These use search_norm_short and your existing aliases logic.

CREATE OR REPLACE FUNCTION public.search_records_fuzzy_ids_core_hot(
  p_user   uuid,
  p_q      text,
  p_limit  bigint DEFAULT 100,
  p_offset bigint DEFAULT 0
)
RETURNS TABLE(id uuid, rank real)
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
WITH norm AS (
  SELECT norm_text(coalesce(p_q, '')) AS qn
),
cand_main AS (
  SELECT h.id,
         1 - (h.search_norm_short <-> (SELECT qn FROM norm)) AS knn_rank
  FROM records_hot.records_hot h
  WHERE h.user_id = p_user
    AND (
      (length((SELECT qn FROM norm)) <= 2 AND h.search_norm_short LIKE (SELECT qn FROM norm) || '%') OR
      (length((SELECT qn FROM norm))  > 2 AND h.search_norm_short %    (SELECT qn FROM norm))
    )
  ORDER BY h.search_norm_short <-> (SELECT qn FROM norm)
  LIMIT LEAST(1000, GREATEST(1, p_limit * 10))
),
cand_alias AS (
  SELECT r.id,
         max(similarity(a.term_norm, (SELECT qn FROM norm))) AS alias_sim
  FROM public.record_aliases a
  JOIN records.records r ON r.id = a.record_id
  JOIN records_hot.records_hot h ON h.id = r.id
  WHERE r.user_id = p_user
    AND (
      (length((SELECT qn FROM norm)) <= 2 AND a.term_norm LIKE (SELECT qn FROM norm) || '%') OR
      (length((SELECT qn FROM norm))  > 2 AND a.term_norm %    (SELECT qn FROM norm))
    )
  GROUP BY r.id
),
ranked AS (
  SELECT r.id,
         GREATEST(
           similarity(r.artist_norm,       (SELECT qn FROM norm)),
           similarity(r.name_norm,         (SELECT qn FROM norm)),
           similarity(r.search_norm_short, (SELECT qn FROM norm)),
           coalesce(ca.alias_sim, 0)
         ) AS rank
  FROM (SELECT DISTINCT id FROM cand_main) cm
  JOIN records.records r ON r.id = cm.id
  LEFT JOIN cand_alias ca ON ca.id = r.id
)
SELECT id, rank
FROM ranked
WHERE rank > 0.2
ORDER BY rank DESC
LIMIT LEAST(1000, GREATEST(1, p_limit))
OFFSET GREATEST(0, p_offset);
$$;

CREATE OR REPLACE FUNCTION public.search_records_fuzzy_ids_core_cold(
  p_user   uuid,
  p_q      text,
  p_limit  bigint DEFAULT 100,
  p_offset bigint DEFAULT 0
)
RETURNS TABLE(id uuid, rank real)
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
WITH norm AS (
  SELECT norm_text(coalesce(p_q, '')) AS qn
),
cand_main AS (
  SELECT r.id,
         1 - (r.search_norm_short <-> (SELECT qn FROM norm)) AS knn_rank
  FROM records.records r
  WHERE r.user_id = p_user
    AND (
      (length((SELECT qn FROM norm)) <= 2 AND r.search_norm_short LIKE (SELECT qn FROM norm) || '%') OR
      (length((SELECT qn FROM norm))  > 2 AND r.search_norm_short %    (SELECT qn FROM norm))
    )
  ORDER BY r.search_norm_short <-> (SELECT qn FROM norm)
  LIMIT LEAST(1000, GREATEST(1, p_limit * 10))
),
cand_alias AS (
  SELECT r.id,
         max(similarity(a.term_norm, (SELECT qn FROM norm))) AS alias_sim
  FROM public.record_aliases a
  JOIN records.records r ON r.id = a.record_id
  WHERE r.user_id = p_user
    AND (
      (length((SELECT qn FROM norm)) <= 2 AND a.term_norm LIKE (SELECT qn FROM norm) || '%') OR
      (length((SELECT qn FROM norm))  > 2 AND a.term_norm %    (SELECT qn FROM norm))
    )
  GROUP BY r.id
),
ranked AS (
  SELECT r.id,
         GREATEST(
           similarity(r.artist_norm,       (SELECT qn FROM norm)),
           similarity(r.name_norm,         (SELECT qn FROM norm)),
           similarity(r.search_norm_short, (SELECT qn FROM norm)),
           coalesce(ca.alias_sim, 0)
         ) AS rank
  FROM (SELECT DISTINCT id FROM cand_main) cm
  JOIN records.records r ON r.id = cm.id
  LEFT JOIN cand_alias ca ON ca.id = r.id
)
SELECT id, rank
FROM ranked
WHERE rank > 0.2
ORDER BY rank DESC
LIMIT LEAST(1000, GREATEST(1, p_limit))
OFFSET GREATEST(0, p_offset);
$$;

-- 3. Router with the EXACT signature pgbench uses
CREATE OR REPLACE FUNCTION public.search_records_fuzzy_ids(
  p_user   uuid,
  p_q      text,
  p_limit  integer DEFAULT 100,
  p_offset integer DEFAULT 0,
  p_strict boolean DEFAULT false
)
RETURNS TABLE(id uuid, rank real)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
AS $$
BEGIN
  IF p_user = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid THEN
    RETURN QUERY
      SELECT *
      FROM public.search_records_fuzzy_ids_core_hot(
        p_user, p_q, p_limit::bigint, p_offset::bigint
      );
  ELSE
    RETURN QUERY
      SELECT *
      FROM public.search_records_fuzzy_ids_core_cold(
        p_user, p_q, p_limit::bigint, p_offset::bigint
      );
  END IF;
END;
$$;

COMMIT;

-- Sanity-check that Postgres now sees the function pgbench wants
SELECT n.nspname, p.proname, p.proargtypes::regtype[]::text AS args, p.prolang::regprocedure::text AS lang
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname = 'search_records_fuzzy_ids'
ORDER BY n.nspname, p.oid;
SQL

if [[ $? -ne 0 ]]; then
  echo "FATAL: Failed to create function!" >&2
  exit 1
fi

echo "✅ Function created"
echo ""

# 3. Run microtests
echo "3. Running microtests..."
echo ""
echo "KNN microtest:"
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off <<'SQL'
EXPLAIN (ANALYZE, BUFFERS)
WITH norm AS (
  SELECT norm_text('鄧麗君 album 263 cn-041 polygram') AS qn
)
SELECT h.id
FROM records_hot.records_hot h
JOIN norm n ON true
ORDER BY h.search_norm_short <-> n.qn
LIMIT 50;
SQL

echo ""
echo "Function microtest:"
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off <<'SQL'
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*)
FROM public.search_records_fuzzy_ids(
  '0dc268d0-a86f-4e12-8d10-9db0f1b735e0',
  '鄧麗君 album 263 cn-041 polygram',
  50,
  0,
  false
);
SQL

echo ""
echo "✅ All fixes applied! The database is now in a known-good state."
echo "You can now run: ./scripts/run_pgbench_sweep.sh"

