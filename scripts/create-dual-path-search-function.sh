#!/usr/bin/env bash
set -Eeuo pipefail

# Create dual-path search function that uses records_hot for hot tenant
# This restores partition-pruning-like behavior

NS="${NS:-record-platform}"
HOT_TENANT_UUID="${HOT_TENANT_UUID:-0dc268d0-a86f-4e12-8d10-9db0f1b735e0}"

PGPOD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' | awk 'NR==1{print $1}')

if [[ -z "$PGPOD" ]]; then
  echo "Error: Postgres pod not found" >&2
  exit 1
fi

echo "Creating dual-path search function (hot tenant → records_hot, others → records)..."

kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off -v ON_ERROR_STOP=1 -v HOT_TENANT="$HOT_TENANT_UUID" <<'SQL'
SET search_path = public, records;

-- Dual-path core function: uses records_hot for hot tenant, records for others
CREATE OR REPLACE FUNCTION public.search_records_fuzzy_ids_core(
  p_user UUID, p_q TEXT, p_limit bigint DEFAULT 100, p_offset bigint DEFAULT 0
) RETURNS TABLE(id UUID, rank real)
LANGUAGE plpgsql STABLE PARALLEL SAFE AS $$
DECLARE
  is_hot_tenant boolean;
BEGIN
  -- Check if this is the hot tenant
  is_hot_tenant := (p_user = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid);
  
  IF is_hot_tenant THEN
    -- HOT PATH: Use records_hot (smaller, better cache locality)
    RETURN QUERY
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
      SELECT DISTINCT r.id, max(similarity(a.term_norm,(SELECT qn FROM norm))) AS alias_sim
      FROM public.record_aliases a
      JOIN records_hot.records_hot r ON r.id = a.record_id
      WHERE (
        (length((SELECT qn FROM norm)) <= 2 AND a.term_norm LIKE (SELECT qn FROM norm) || '%') OR
        (length((SELECT qn FROM norm))  > 2 AND a.term_norm %    (SELECT qn FROM norm))
      )
      GROUP BY r.id
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
  ELSE
    -- COLD PATH: Use records.records (full table, with user_id filter)
    RETURN QUERY
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
  END IF;
END;
$$;

-- Wrapper function (unchanged)
CREATE OR REPLACE FUNCTION public.search_records_fuzzy_ids(
  p_user UUID, p_q TEXT, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0, p_strict boolean DEFAULT false
) RETURNS TABLE(id UUID, rank real)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT * FROM public.search_records_fuzzy_ids_core(p_user, p_q, p_limit::bigint, p_offset::bigint);
$$;

-- Verify
SELECT 'Dual-path function created' AS status,
       EXISTS (SELECT 1 FROM pg_proc WHERE proname='search_records_fuzzy_ids_core') AS core_exists,
       EXISTS (SELECT 1 FROM pg_proc WHERE proname='search_records_fuzzy_ids') AS wrapper_exists;
SQL

echo "✅ Dual-path function created"
echo "   - Hot tenant ($HOT_TENANT_UUID) → uses records_hot (100k rows)"
echo "   - Other tenants → uses records.records (1.2M rows with user_id filter)"

