#!/usr/bin/env bash
set -euo pipefail
NS=${NS:-record-platform}
PGURL=${PGURL:-'postgresql://record_app:REPLACE_WITH_APP_PASSWORD@localhost:5432/records'}
USER_ID=${USER_ID:-'4ad36240-c1ad-4638-ab1b-4c8cfb04a553'}

kubectl -n "$NS" exec -i deploy/postgres -- psql "$PGURL" -v ON_ERROR_STOP=1 <<SQL
SET client_min_messages = warning;
SET jit = off;
-- track_io_timing is cluster-level; we enabled it in fix_pg.sh

-- Make sure planner stats are fresh for these specific tables
ANALYZE records.records;
ANALYZE records.search_terms;

-- AUTOCOMPLETE
\echo '=== AUTOCOMPLETE ==='
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT term, hits, dist
FROM public.search_autocomplete(
  '${USER_ID}'::uuid, 'te'::text, 10::int, 'artist'::text
);

-- FUZZY IDS
\echo '=== FUZZY IDS ==='
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT id, rank
FROM public.search_records_fuzzy_ids(
  '${USER_ID}'::uuid, 'teresa'::text, 100::bigint, 0::bigint
);

-- PRICE STATS
\echo '=== PRICE STATS ==='
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT *
FROM public.search_price_stats(
  '${USER_ID}'::uuid, 'teresa'::text
);

-- RECENT
\echo '=== RECENT ==='
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT *
FROM public.records_recent('${USER_ID}'::uuid, 50::int);
SQL