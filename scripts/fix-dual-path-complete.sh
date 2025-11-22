#!/usr/bin/env bash
set -Eeuo pipefail

# Complete fix for dual-path function routing
# Implements proper PL/pgSQL router with hot/cold cores using search_norm_short

NS="${NS:-record-platform}"
HOT_TENANT_UUID="${HOT_TENANT_UUID:-0dc268d0-a86f-4e12-8d10-9db0f1b735e0}"

PGPOD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' | awk 'NR==1{print $1}')

if [[ -z "$PGPOD" ]]; then
  echo "Error: Postgres pod not found" >&2
  exit 1
fi

echo "=== Fixing Dual-Path Function Routing ==="
echo "Hot tenant: $HOT_TENANT_UUID"
echo ""

kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off -v ON_ERROR_STOP=1 -v HOT_TENANT="$HOT_TENANT_UUID" <<'SQL'
SET search_path = public, records;

-- Drop old functions first
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids(uuid, text, integer, integer, boolean) CASCADE;
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids_core(uuid, text, bigint, bigint) CASCADE;
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids_core_hot(uuid, text, bigint, bigint) CASCADE;
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids_core_cold(uuid, text, bigint, bigint) CASCADE;

-- HOT CORE: Uses records_hot with search_norm_short
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

-- COLD CORE: Uses records.records with search_norm_short
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

-- PL/pgSQL ROUTER: Cannot be inlined, routes based on user_id
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids(uuid, text, integer, integer, boolean);

CREATE FUNCTION public.search_records_fuzzy_ids(
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
    -- Hot tenant → use hot slice core
    RETURN QUERY
      SELECT *
      FROM public.search_records_fuzzy_ids_core_hot(
        p_user,
        p_q,
        p_limit::bigint,
        p_offset::bigint
      );
  ELSE
    -- Everyone else → cold core on monolithic table
    RETURN QUERY
      SELECT *
      FROM public.search_records_fuzzy_ids_core_cold(
        p_user,
        p_q,
        p_limit::bigint,
        p_offset::bigint
      );
  END IF;
END;
$$;

-- Verify functions exist
SELECT 
  proname,
  CASE 
    WHEN prolang::regproc = 'plpgsql' THEN 'PL/pgSQL'
    WHEN prolang::regproc = 'sql' THEN 'SQL'
    ELSE prolang::regproc::text
  END AS language
FROM pg_proc
WHERE proname LIKE 'search_records_fuzzy_ids%'
  AND pronamespace = 'public'::regnamespace
ORDER BY proname;
SQL

echo ""
echo "✅ Dual-path functions created"
echo "   - Router: PL/pgSQL (cannot be inlined)"
echo "   - Hot core: Uses records_hot with search_norm_short"
echo "   - Cold core: Uses records.records with search_norm_short"

