#!/usr/bin/env bash
set -Eeuo pipefail

# Fix dual-path function with proper hot/cold routing
# Creates separate core functions and PL/pgSQL router

NS="${NS:-record-platform}"
HOT_TENANT_UUID="${HOT_TENANT_UUID:-0dc268d0-a86f-4e12-8d10-9db0f1b735e0}"

PGPOD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' | awk 'NR==1{print $1}')

if [[ -z "$PGPOD" ]]; then
  echo "Error: Postgres pod not found" >&2
  exit 1
fi

echo "Creating proper dual-path function with hot/cold routing..."

kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off -v ON_ERROR_STOP=1 -v HOT_TENANT="$HOT_TENANT_UUID" <<'SQL'
SET search_path = public, records;

-- HOT CORE: Uses records_hot (100k rows)
CREATE OR REPLACE FUNCTION public.search_records_fuzzy_ids_core_hot(
  p_user UUID, p_q TEXT, p_limit bigint DEFAULT 100, p_offset bigint DEFAULT 0
) RETURNS TABLE(id UUID, rank real)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  WITH norm AS (SELECT norm_text(COALESCE(p_q,'')) AS qn),
  cand_main AS (
    SELECT h.id, 1 - (h.search_norm <-> (SELECT qn FROM norm)) AS knn_rank
    FROM records_hot.records_hot h
    WHERE (
      (length((SELECT qn FROM norm)) <= 2 AND h.search_norm LIKE (SELECT qn FROM norm) || '%') OR
      (length((SELECT qn FROM norm))  > 2 AND h.search_norm %    (SELECT qn FROM norm))
    )
    ORDER BY h.search_norm <-> (SELECT qn FROM norm)
    LIMIT LEAST(1000, GREATEST(1, p_limit*10))
  ),
  cand_alias AS (
    SELECT DISTINCT h.id, max(similarity(a.term_norm,(SELECT qn FROM norm))) AS alias_sim
    FROM public.record_aliases a
    JOIN records_hot.records_hot h ON h.id = a.record_id
    WHERE (
      (length((SELECT qn FROM norm)) <= 2 AND a.term_norm LIKE (SELECT qn FROM norm) || '%') OR
      (length((SELECT qn FROM norm))  > 2 AND a.term_norm %    (SELECT qn FROM norm))
    )
    GROUP BY h.id
  )
  SELECT h.id,
         GREATEST(
           similarity(COALESCE(r.artist_norm, ''),(SELECT qn FROM norm)),
           similarity(COALESCE(r.name_norm, ''),  (SELECT qn FROM norm)),
           similarity(h.search_norm,(SELECT qn FROM norm)),
           COALESCE(ca.alias_sim,0)
         ) AS rank
  FROM (SELECT DISTINCT id FROM cand_main) cm
  JOIN records_hot.records_hot h ON h.id = cm.id
  LEFT JOIN records.records r ON r.id = h.id
  LEFT JOIN cand_alias ca ON ca.id = h.id
  WHERE GREATEST(
    similarity(COALESCE(r.artist_norm, ''),(SELECT qn FROM norm)),
    similarity(COALESCE(r.name_norm, ''),  (SELECT qn FROM norm)),
    similarity(h.search_norm,(SELECT qn FROM norm)),
    COALESCE(ca.alias_sim,0)
  ) > 0.2
  ORDER BY rank DESC
  LIMIT LEAST(1000, GREATEST(1, p_limit))
  OFFSET GREATEST(0, p_offset);
$$;

-- COLD CORE: Uses records.records (1.2M rows, with user_id filter)
CREATE OR REPLACE FUNCTION public.search_records_fuzzy_ids_core_cold(
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

-- PL/pgSQL ROUTER: Chooses hot or cold path based on user_id
CREATE OR REPLACE FUNCTION public.search_records_fuzzy_ids(
  p_user UUID, p_q TEXT, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0, p_strict boolean DEFAULT false
) RETURNS TABLE(id UUID, rank real)
LANGUAGE plpgsql STABLE PARALLEL SAFE AS $$
BEGIN
  IF p_user = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid THEN
    -- HOT PATH: Use records_hot (100k rows)
    RETURN QUERY
      SELECT * FROM public.search_records_fuzzy_ids_core_hot(
        p_user, p_q, p_limit::bigint, p_offset::bigint
      );
  ELSE
    -- COLD PATH: Use records.records (1.2M rows with user_id filter)
    RETURN QUERY
      SELECT * FROM public.search_records_fuzzy_ids_core_cold(
        p_user, p_q, p_limit::bigint, p_offset::bigint
      );
  END IF;
END;
$$;

-- Verify
SELECT 'Dual-path function created' AS status,
       EXISTS (SELECT 1 FROM pg_proc WHERE proname='search_records_fuzzy_ids_core_hot') AS hot_core_exists,
       EXISTS (SELECT 1 FROM pg_proc WHERE proname='search_records_fuzzy_ids_core_cold') AS cold_core_exists,
       EXISTS (SELECT 1 FROM pg_proc WHERE proname='search_records_fuzzy_ids') AS router_exists;
SQL

echo "✅ Dual-path function created with proper routing"
echo "   - Hot tenant ($HOT_TENANT_UUID) → search_records_fuzzy_ids_core_hot → records_hot"
echo "   - Other tenants → search_records_fuzzy_ids_core_cold → records.records"

