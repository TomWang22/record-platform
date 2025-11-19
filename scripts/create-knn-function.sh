#!/usr/bin/env bash
set -Eeuo pipefail

# Create search_records_fuzzy_ids function
NS="${NS:-record-platform}"
PGPOD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' | awk 'NR==1{print $1}')

if [[ -z "$PGPOD" ]]; then
  echo "Error: Postgres pod not found" >&2
  exit 1
fi

echo "=== Creating search_records_fuzzy_ids function ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -v ON_ERROR_STOP=1 <<'SQL'
CREATE OR REPLACE FUNCTION public.search_records_fuzzy_ids(
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

-- Verify
SELECT 
  'Function exists: ' || EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'search_records_fuzzy_ids'
  ) as status;
SQL

echo "✅ Function created"
