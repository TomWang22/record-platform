#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"; cd "$ROOT"
NS="${NS:-record-platform}"
DEP="${DBDEP:-postgres}"
SVC="${SVC:-postgres}"
DB="${DBNAME:-records}"
APPUSER="${APPUSER:-record_app}"
PGPORT_LOCAL="${PGPORT_LOCAL:-15432}"
USER_UUID="${USER_UUID:-0dc268d0-a86f-4e12-8d10-9db0f1b735e0}"
HOT_TARGET="${HOT_TARGET:-100000}"

PSQL="${PSQL:-/Library/PostgreSQL/16/bin/psql}"; command -v "$PSQL" >/dev/null 2>&1 || PSQL=psql
PREST="${PREST:-/Library/PostgreSQL/16/bin/pg_restore}"; command -v "$PREST" >/dev/null 2>&1 || PREST=pg_restore

BUNDLE="${1:-}"
[[ -n "$BUNDLE" && -f "$BUNDLE" ]] || { echo "usage: $0 /path/to/records_bundle_or_dump.(tar.gz|dump|sql|sql.gz)"; exit 2; }

# helpers
log(){ printf "[%s] %s\n" "$(date -u +%H:%M:%S)" "$*"; }
die(){ echo "ERR: $*" >&2; exit 2; }

# secrets
PG_PW="$(kubectl -n "$NS" get secret pgbouncer-auth -o jsonpath='{.data.userlist\.txt}' | base64 -d | awk -F\" '/^"postgres"/{print $4; exit}')"
APP_PW="$(kubectl -n "$NS" get secret pgbouncer-auth -o jsonpath='{.data.userlist\.txt}' | base64 -d | awk -F\" '/^"'"$APPUSER"'"/{print $4; exit}')"
[[ -n "$PG_PW" ]] || die "postgres password missing from pgbouncer-auth"

# 1) Ensure tuned args applied + rollout finished
log "Step 1: Setting aggressive PG args..."
"$ROOT/scripts/set_pg_args.sh"

# 2) Kill any stray port-forwards, start fresh
pkill -f 'kubectl.*port-forward.*'"$PGPORT_LOCAL" || true
log "port-forwarding deploy/$DEP -> localhost:$PGPORT_LOCAL ..."
kubectl -n "$NS" port-forward "deploy/$DEP" "$PGPORT_LOCAL:5432" >/tmp/pf.log 2>&1 & PF=$!
trap 'kill $PF 2>/dev/null || true' EXIT
sleep 3

# 3) Fingerprint the live pod and the PF target; they must match
log "Step 2: Verifying fingerprints..."
FP_POD="$(kubectl -n "$NS" exec deploy/$DEP -c db -- $PSQL -U postgres -d "$DB" -At -X -c \
  "select inet_server_addr()||':'||inet_server_port(), pg_postmaster_start_time(), (pg_control_system()).system_identifier" 2>/dev/null || echo "")" || true
log "pod fingerprint: $FP_POD"

FP_PF="$($PSQL -h 127.0.0.1 -p "$PGPORT_LOCAL" -U postgres -d "$DB" -At -X -c \
  "select inet_server_addr()||':'||inet_server_port(), pg_postmaster_start_time(), (pg_control_system()).system_identifier" 2>/dev/null || echo "")" || true
log "pf  fingerprint: $FP_PF"

if [[ -n "$FP_POD" && -n "$FP_PF" ]]; then
  POD_SYSID="$(echo "$FP_POD" | awk -F'|' '{print $3}')"
  PF_SYSID="$(echo "$FP_PF" | awk -F'|' '{print $3}')"
  if [[ "$POD_SYSID" != "$PF_SYSID" ]]; then
    warn "fingerprints mismatch (wrong server behind the port-forward)"
    warn "pod sysid: $POD_SYSID"
    warn "pf  sysid: $PF_SYSID"
  else
    log "fingerprints match ✓"
  fi
fi

# 4) Create extensions BEFORE restore (needed by restore)
log "Step 3: Creating extensions before restore..."
PGPASSWORD="$PG_PW" "$PSQL" -h 127.0.0.1 -p "$PGPORT_LOCAL" -U postgres -d "$DB" -X -v ON_ERROR_STOP=1 <<'SQL'
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pg_prewarm;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
SQL

# 5) Restore data (logical)
log "Step 4: Restoring from: $BUNDLE ..."
if [[ "$BUNDLE" == *.tar.gz ]]; then
  TMPX="$(mktemp -d)"; tar xzf "$BUNDLE" -C "$TMPX"
  DFILE="$(ls "$TMPX"/*.dump 2>/dev/null | head -n1 || true)"
  [[ -n "$DFILE" ]] || die "no *.dump found in bundle"
  PGPASSWORD="$PG_PW" "$PREST" -h 127.0.0.1 -p "$PGPORT_LOCAL" -U postgres -d "$DB" \
    --clean --if-exists --no-owner --no-privileges -j 1 "$DFILE" 2>&1 | grep -v "ERROR.*unaccent\|ERROR.*norm_text\|WARNING.*aliases_mv" | tail -20 || true
  rm -rf "$TMPX"
elif [[ "$BUNDLE" == *.sql.gz ]]; then
  PGPASSWORD="$PG_PW" gzip -dc "$BUNDLE" | "$PSQL" -h 127.0.0.1 -p "$PGPORT_LOCAL" -U postgres -d "$DB" -X -v ON_ERROR_STOP=1
elif [[ "$BUNDLE" == *.sql ]]; then
  PGPASSWORD="$PG_PW" "$PSQL" -h 127.0.0.1 -p "$PGPORT_LOCAL" -U postgres -d "$DB" -X -v ON_ERROR_STOP=1 -f "$BUNDLE"
else
  PGPASSWORD="$PG_PW" "$PREST" -h 127.0.0.1 -p "$PGPORT_LOCAL" -U postgres -d "$DB" \
    --clean --if-exists --no-owner --no-privileges -j 1 "$BUNDLE" 2>&1 | grep -v "ERROR.*unaccent\|ERROR.*norm_text\|WARNING.*aliases_mv" | tail -20 || true
fi
log "restore done"

# 6) Ensure extensions, functions, role + grants + hot schema/indexes
log "Step 5: Ensuring extensions, functions, role/grants and hot schema..."
PGPASSWORD="$PG_PW" "$PSQL" -h 127.0.0.1 -p "$PGPORT_LOCAL" -U postgres -d "$DB" -X -v ON_ERROR_STOP=1 -v APP_PW="$APP_PW" -v USER_UUID="$USER_UUID" -v HOT_TARGET="$HOT_TARGET" <<'SQL'
\pset pager off

-- Extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pg_prewarm;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- norm_text function
CREATE OR REPLACE FUNCTION public.norm_text(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(lower(unaccent(coalesce(t,''))), '\s+', ' ', 'g');
$$;

-- record_aliases view
CREATE OR REPLACE VIEW public.record_aliases AS
  SELECT record_id, alias_norm AS term_norm
  FROM records.aliases_mv;

-- search_records_fuzzy_ids_core (4 params, bigint)
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

-- search_records_fuzzy_ids wrapper (5 params: uuid, text, integer, integer, boolean)
CREATE OR REPLACE FUNCTION public.search_records_fuzzy_ids(
  p_user UUID, p_q TEXT, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0, p_strict boolean DEFAULT false
) RETURNS TABLE(id UUID, rank real)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT * FROM public.search_records_fuzzy_ids_core(p_user, p_q, p_limit::bigint, p_offset::bigint);
$$;

-- Hot schema and table (create FIRST before grants)
CREATE SCHEMA IF NOT EXISTS records_hot;

-- Role and grants
SELECT set_config('app.tmp_pw', :'APP_PW', true);
DO $$
DECLARE v text := current_setting('app.tmp_pw', true);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='record_app') THEN
    EXECUTE format('CREATE ROLE record_app LOGIN PASSWORD %L', v);
  END IF;
END$$;
RESET app.tmp_pw;

GRANT CONNECT ON DATABASE records TO record_app;
GRANT USAGE ON SCHEMA public, records, records_hot TO record_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA records, records_hot TO record_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA records, records_hot TO record_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA records     GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO record_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA records_hot GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO record_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA records     GRANT USAGE,SELECT ON SEQUENCES TO record_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA records_hot GRANT USAGE,SELECT ON SEQUENCES TO record_app;
CREATE TABLE IF NOT EXISTS records_hot.records_hot(
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  search_norm text NOT NULL
);

-- Hot slice indexes
CREATE INDEX IF NOT EXISTS records_hot_knn
  ON records_hot.records_hot USING gist (search_norm gist_trgm_ops) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS records_hot_search_trgm_gist
  ON records_hot.records_hot USING gist (search_norm gist_trgm_ops);
CREATE INDEX IF NOT EXISTS records_hot_search_trgm_gin
  ON records_hot.records_hot USING gin (search_norm gin_trgm_ops) WITH (fastupdate=off);

-- Populate hot slice (top heap: most recently updated)
TRUNCATE TABLE records_hot.records_hot;
INSERT INTO records_hot.records_hot (id, user_id, search_norm)
SELECT id, user_id, COALESCE(search_norm, '')
FROM records.records
WHERE user_id = :'USER_UUID'::uuid
ORDER BY updated_at DESC
LIMIT :'HOT_TARGET'::integer;

ANALYZE records_hot.records_hot;
SQL

log "role/grants + hot schema OK"

# 7) Refresh materialized views
log "Step 6: Refreshing materialized views..."
PGPASSWORD="$PG_PW" "$PSQL" -h 127.0.0.1 -p "$PGPORT_LOCAL" -U postgres -d "$DB" -X -v ON_ERROR_STOP=1 <<'SQL'
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

# 8) Prewarm hot heap + indexes
log "Step 7: Prewarming hot heap + indexes..."
PGPASSWORD="$PG_PW" "$PSQL" -h 127.0.0.1 -p "$PGPORT_LOCAL" -U postgres -d "$DB" -X -v ON_ERROR_STOP=1 <<'SQL'
SELECT 'heap', pg_prewarm('records_hot.records_hot'::regclass);
SELECT indexrelid::regclass AS idx, pg_prewarm(indexrelid)
FROM pg_index WHERE indrelid='records_hot.records_hot'::regclass
ORDER BY 1;
SQL

# 9) VACUUM ANALYZE
log "Step 8: VACUUM (ANALYZE) main tables..."
PGPASSWORD="$PG_PW" "$PSQL" -h 127.0.0.1 -p "$PGPORT_LOCAL" -U postgres -d "$DB" -c "VACUUM (ANALYZE) records.records" 2>&1 | tail -5
PGPASSWORD="$PG_PW" "$PSQL" -h 127.0.0.1 -p "$PGPORT_LOCAL" -U postgres -d "$DB" -c "VACUUM (ANALYZE) records_hot.records_hot" 2>&1 | tail -5

# 10) Quick sanity + print counts
log "Step 9: Sanity check (who/rows/index/plans)..."
if [[ -n "${APP_PW:-}" ]]; then
  PGPASSWORD="$APP_PW" "$PSQL" -h 127.0.0.1 -p "$PGPORT_LOCAL" -U "$APPUSER" -d "$DB" -X <<'SQL'
\pset pager off
SELECT inet_server_addr()||':'||inet_server_port() AS server,
       pg_postmaster_start_time() AS started,
       (pg_control_system()).system_identifier AS sysid;
SELECT current_user usr, current_setting('server_version') pg, current_database() db, now() ts;
SELECT count(*) as records_rows from records.records;
SELECT count(*) as hot_rows     from records_hot.records_hot;
SELECT name, setting, unit, source FROM pg_settings 
WHERE name IN ('shared_buffers','work_mem','effective_cache_size','random_page_cost','max_parallel_workers','max_parallel_workers_per_gather')
ORDER BY name;
SQL
fi

log "done. You can now run your bench sweep again."

