#!/usr/bin/env bash
set -Eeuo pipefail

# Debug router function to verify it's actually being called
# This will emit NOTICEs so we can see if the router is hit

NS="${NS:-record-platform}"
HOT_TENANT_UUID="${HOT_TENANT_UUID:-0dc268d0-a86f-4e12-8d10-9db0f1b735e0}"

PGPOD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' | awk 'NR==1{print $1}')

if [[ -z "$PGPOD" ]]; then
  echo "Error: Postgres pod not found" >&2
  exit 1
fi

echo "=== Debug Router Function Setup ==="
echo "This will create a debug router that emits NOTICEs to verify it's being called"
echo ""

kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off -v ON_ERROR_STOP=1 <<'SQL'
SET search_path = public, records;

-- First, list ALL existing functions with this name
\echo '=== Existing functions with search_records_fuzzy_ids ==='
SELECT 
  n.nspname AS schema,
  p.proname AS function_name,
  p.oid,
  p.proargtypes::regtype[] AS arg_types,
  CASE WHEN prolang::regproc = 'plpgsql' THEN 'PL/pgSQL' ELSE 'SQL' END AS language
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname LIKE 'search_records_fuzzy_ids%'
ORDER BY n.nspname, p.proname, p.oid;

-- Aggressively drop ALL router variants
\echo ''
\echo '=== Dropping all router variants ==='
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids(uuid, text, integer, integer, boolean) CASCADE;
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids(uuid, text, integer, integer) CASCADE;
DROP FUNCTION IF EXISTS records.search_records_fuzzy_ids(uuid, text, integer, integer, boolean) CASCADE;
DROP FUNCTION IF EXISTS records.search_records_fuzzy_ids(uuid, text, integer, integer) CASCADE;

-- Create debug router that emits NOTICEs
\echo ''
\echo '=== Creating debug router ==='
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
AS $$
BEGIN
  RAISE NOTICE '🔍 ROUTER CALLED: user=%, q=%, limit=%', p_user, left(p_q, 20), p_limit;

  IF p_user = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid THEN
    RAISE NOTICE '🔥 HOT PATH SELECTED';
    RETURN QUERY
      SELECT '00000000-0000-0000-0000-000000000000'::uuid AS id,
             1.0::real AS rank;
  ELSE
    RAISE NOTICE '❄️  COLD PATH SELECTED';
    RETURN QUERY
      SELECT '11111111-1111-1111-1111-111111111111'::uuid AS id,
             0.5::real AS rank;
  END IF;
END;
$$;

-- Verify it was created
\echo ''
\echo '=== Verifying debug router ==='
SELECT 
  proname,
  CASE WHEN prolang::regproc = 'plpgsql' THEN 'PL/pgSQL' ELSE 'SQL' END AS language,
  proargtypes::regtype[] AS args
FROM pg_proc
WHERE proname = 'search_records_fuzzy_ids'
  AND pronamespace = 'public'::regnamespace;

\echo ''
\echo '✅ Debug router created. Test it with:'
\echo '   SELECT * FROM public.search_records_fuzzy_ids(''0dc268d0-a86f-4e12-8d10-9db0f1b735e0''::uuid, ''test'', 50, 0, false);'
\echo ''
\echo 'You should see NOTICEs in the output!'
SQL

echo ""
echo "✅ Debug router function created"
echo "   - Emits NOTICEs when called"
echo "   - Returns dummy UUIDs to verify routing"
echo "   - Test it to confirm it's being used"

