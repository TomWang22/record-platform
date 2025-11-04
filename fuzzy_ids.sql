DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids(uuid, text, bigint, bigint);

CREATE OR REPLACE FUNCTION public.search_records_fuzzy_ids(
  p_user   uuid,
  p_q      text,
  p_limit  bigint DEFAULT 100,
  p_offset bigint DEFAULT 0
) RETURNS TABLE(id uuid, rank double precision)
LANGUAGE sql STABLE AS $$
  WITH _lim AS (SELECT set_limit(0.2)),
  s AS (
    SELECT r.id, similarity(r.artist, p_q)::double precision AS rank
    FROM records.records r
    WHERE r.user_id = p_user AND r.artist % p_q
    UNION ALL
    SELECT r.id, similarity(r.name, p_q)::double precision AS rank
    FROM records.records r
    WHERE r.user_id = p_user AND r.name % p_q
  )
  SELECT s.id, MAX(s.rank) AS rank
  FROM s
  GROUP BY s.id
  ORDER BY MAX(s.rank) DESC
  LIMIT p_limit OFFSET p_offset;
$$;
