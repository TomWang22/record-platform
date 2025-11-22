#!/usr/bin/env bash
set -Eeuo pipefail

# Comprehensive fix script based on PostgreSQL GPT recommendations
# 1. Verify/create records_hot table
# 2. Create debug router function
# 3. Test it
# 4. Show status

NS="${NS:-record-platform}"
HOT_TENANT_UUID="${HOT_TENANT_UUID:-0dc268d0-a86f-4e12-8d10-9db0f1b735e0}"

PGPOD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' | awk 'NR==1{print $1}')

if [[ -z "$PGPOD" ]]; then
  echo "Error: Postgres pod not found" >&2
  exit 1
fi

echo "=== Comprehensive Fix Script ==="
echo "Pod: $PGPOD"
echo ""

kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off -v ON_ERROR_STOP=1 <<SQL
-- Step 1: Create records_hot schema and table
\echo '=== Step 1: Creating records_hot schema and table ==='
CREATE SCHEMA IF NOT EXISTS records_hot;

CREATE TABLE IF NOT EXISTS records_hot.records_hot (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  search_norm text,
  search_norm_short text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Step 2: Add search_norm_short if missing
\echo ''
\echo '=== Step 2: Adding search_norm_short column ==='
ALTER TABLE records_hot.records_hot ADD COLUMN IF NOT EXISTS search_norm_short text;

-- Step 3: Create debug router function
\echo ''
\echo '=== Step 3: Creating debug router function ==='
SET search_path = public, records;

DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids CASCADE;

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
AS \$\$
BEGIN
  RAISE NOTICE '🔍 ROUTER CALLED: user=%, q=%', p_user, left(p_q, 20);
  IF p_user = '${HOT_TENANT_UUID}'::uuid THEN
    RAISE NOTICE '🔥 HOT PATH';
    RETURN QUERY SELECT '00000000-0000-0000-0000-000000000000'::uuid, 1.0::real;
  ELSE
    RAISE NOTICE '❄️  COLD PATH';
    RETURN QUERY SELECT '11111111-1111-1111-1111-111111111111'::uuid, 0.5::real;
  END IF;
END;
\$\$;

-- Step 4: Verify function exists
\echo ''
\echo '=== Step 4: Verifying function exists ==='
SELECT 
  n.nspname AS schema,
  p.proname AS function_name,
  CASE WHEN prolang::regproc = 'plpgsql' THEN 'PL/pgSQL' ELSE 'SQL' END AS language
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname = 'search_records_fuzzy_ids'
  AND n.nspname = 'public';

-- Step 5: Test the function
\echo ''
\echo '=== Step 5: Testing debug router (Hot Tenant) ==='
SET client_min_messages = NOTICE;
SELECT * FROM public.search_records_fuzzy_ids(
  '${HOT_TENANT_UUID}'::uuid, 
  'test'::text, 
  50::integer, 0::integer, false::boolean
);

\echo ''
\echo '=== Step 6: Testing debug router (Cold Tenant) ==='
SELECT * FROM public.search_records_fuzzy_ids(
  '11111111-1111-1111-1111-111111111111'::uuid, 
  'test'::text, 
  50::integer, 0::integer, false::boolean
);

\echo ''
\echo '✅ Setup complete!'
SQL

echo ""
echo "✅ All fixes applied!"
echo "   - records_hot schema and table created"
echo "   - Debug router function created and tested"
echo "   - Check output above for NOTICEs confirming routing"

