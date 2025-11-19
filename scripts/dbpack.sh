#!/usr/bin/env bash
set -Eeuo pipefail

### ---- repo root (force outputs to land here) ----
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

### ---- config (env overridable) ----
NS="${NS:-record-platform}"
DBDEP="${DBDEP:-postgres}"
DBNAME="${DBNAME:-records}"
APPUSER="${APPUSER:-record_app}"
PGPORT_LOCAL="${PGPORT_LOCAL:-15432}"
SVC="${SVC:-postgres}"
HOT_TENANT_UUID="${HOT_TENANT_UUID:-0dc268d0-a86f-4e12-8d10-9db0f1b735e0}"
<<<<<<< Current (Your changes)
<<<<<<< Current (Your changes)
<<<<<<< Current (Your changes)
<<<<<<< Current (Your changes)
<<<<<<< Current (Your changes)
<<<<<<< Current (Your changes)
<<<<<<< Current (Your changes)
<<<<<<< Current (Your changes)
<<<<<<< Current (Your changes)
<<<<<<< Current (Your changes)
<<<<<<< Current (Your changes)
<<<<<<< Current (Your changes)
<<<<<<< Current (Your changes)
<<<<<<< Current (Your changes)
<<<<<<< Current (Your changes)
<<<<<<< Current (Your changes)
<<<<<<< Current (Your changes)
<<<<<<< Current (Your changes)
<<<<<<< Current (Your changes)
<<<<<<< Current (Your changes)
<<<<<<< Current (Your changes)
<<<<<<< Current (Your changes)
<<<<<<< Current (Your changes)
<<<<<<< Current (Your changes)
<<<<<<< Current (Your changes)
<<<<<<< Current (Your changes)
<<<<<<< Current (Your changes)
<<<<<<< Current (Your changes)
<<<<<<< Current (Your changes)
<<<<<<< Current (Your changes)
<<<<<<< Current (Your changes)
<<<<<<< Current (Your changes)
<<<<<<< Current (Your changes)
<<<<<<< Current (Your changes)
<<<<<<< Current (Your changes)
<<<<<<< Current (Your changes)
<<<<<<< Current (Your changes)
HOT_TENANT_TARGET="${HOT_TENANT_TARGET:-110000}"
=======
HOT_TENANT_TARGET="${HOT_TENANT_TARGET:-100000}"
>>>>>>> Incoming (Background Agent changes)
=======
HOT_TENANT_TARGET="${HOT_TENANT_TARGET:-100000}"
>>>>>>> Incoming (Background Agent changes)
=======
HOT_TENANT_TARGET="${HOT_TENANT_TARGET:-100000}"
>>>>>>> Incoming (Background Agent changes)
=======
HOT_TENANT_TARGET="${HOT_TENANT_TARGET:-100000}"
>>>>>>> Incoming (Background Agent changes)
=======
HOT_TENANT_TARGET="${HOT_TENANT_TARGET:-100000}"
>>>>>>> Incoming (Background Agent changes)
=======
HOT_TENANT_TARGET="${HOT_TENANT_TARGET:-100000}"
>>>>>>> Incoming (Background Agent changes)
=======
HOT_TENANT_TARGET="${HOT_TENANT_TARGET:-100000}"
>>>>>>> Incoming (Background Agent changes)
=======
HOT_TENANT_TARGET="${HOT_TENANT_TARGET:-100000}"
>>>>>>> Incoming (Background Agent changes)
=======
HOT_TENANT_TARGET="${HOT_TENANT_TARGET:-100000}"
>>>>>>> Incoming (Background Agent changes)
=======
HOT_TENANT_TARGET="${HOT_TENANT_TARGET:-100000}"
>>>>>>> Incoming (Background Agent changes)
=======
HOT_TENANT_TARGET="${HOT_TENANT_TARGET:-100000}"
>>>>>>> Incoming (Background Agent changes)
=======
HOT_TENANT_TARGET="${HOT_TENANT_TARGET:-100000}"
>>>>>>> Incoming (Background Agent changes)
=======
HOT_TENANT_TARGET="${HOT_TENANT_TARGET:-100000}"
>>>>>>> Incoming (Background Agent changes)
=======
HOT_TENANT_TARGET="${HOT_TENANT_TARGET:-100000}"
>>>>>>> Incoming (Background Agent changes)
=======
HOT_TENANT_TARGET="${HOT_TENANT_TARGET:-100000}"
>>>>>>> Incoming (Background Agent changes)
=======
HOT_TENANT_TARGET="${HOT_TENANT_TARGET:-100000}"
>>>>>>> Incoming (Background Agent changes)
=======
HOT_TENANT_TARGET="${HOT_TENANT_TARGET:-100000}"
>>>>>>> Incoming (Background Agent changes)
=======
HOT_TENANT_TARGET="${HOT_TENANT_TARGET:-100000}"
>>>>>>> Incoming (Background Agent changes)
=======
HOT_TENANT_TARGET="${HOT_TENANT_TARGET:-100000}"
>>>>>>> Incoming (Background Agent changes)
=======
HOT_TENANT_TARGET="${HOT_TENANT_TARGET:-100000}"
>>>>>>> Incoming (Background Agent changes)
=======
HOT_TENANT_TARGET="${HOT_TENANT_TARGET:-100000}"
>>>>>>> Incoming (Background Agent changes)
=======
HOT_TENANT_TARGET="${HOT_TENANT_TARGET:-100000}"
>>>>>>> Incoming (Background Agent changes)
=======
HOT_TENANT_TARGET="${HOT_TENANT_TARGET:-100000}"
>>>>>>> Incoming (Background Agent changes)
=======
HOT_TENANT_TARGET="${HOT_TENANT_TARGET:-100000}"
>>>>>>> Incoming (Background Agent changes)
=======
HOT_TENANT_TARGET="${HOT_TENANT_TARGET:-100000}"
>>>>>>> Incoming (Background Agent changes)
=======
HOT_TENANT_TARGET="${HOT_TENANT_TARGET:-100000}"
>>>>>>> Incoming (Background Agent changes)
=======
HOT_TENANT_TARGET="${HOT_TENANT_TARGET:-100000}"
>>>>>>> Incoming (Background Agent changes)
=======
HOT_TENANT_TARGET="${HOT_TENANT_TARGET:-100000}"
>>>>>>> Incoming (Background Agent changes)
=======
HOT_TENANT_TARGET="${HOT_TENANT_TARGET:-100000}"
>>>>>>> Incoming (Background Agent changes)
=======
HOT_TENANT_TARGET="${HOT_TENANT_TARGET:-100000}"
>>>>>>> Incoming (Background Agent changes)
=======
HOT_TENANT_TARGET="${HOT_TENANT_TARGET:-100000}"
>>>>>>> Incoming (Background Agent changes)
=======
HOT_TENANT_TARGET="${HOT_TENANT_TARGET:-100000}"
>>>>>>> Incoming (Background Agent changes)
=======
HOT_TENANT_TARGET="${HOT_TENANT_TARGET:-100000}"
>>>>>>> Incoming (Background Agent changes)
=======
HOT_TENANT_TARGET="${HOT_TENANT_TARGET:-100000}"
>>>>>>> Incoming (Background Agent changes)
=======
HOT_TENANT_TARGET="${HOT_TENANT_TARGET:-100000}"
>>>>>>> Incoming (Background Agent changes)
=======
HOT_TENANT_TARGET="${HOT_TENANT_TARGET:-100000}"
>>>>>>> Incoming (Background Agent changes)
=======
HOT_TENANT_TARGET="${HOT_TENANT_TARGET:-100000}"
>>>>>>> Incoming (Background Agent changes)

# actions
DO_BACKUP=0
DO_RESTORE=0
DO_ENSURE_APP=0
DO_PREP_HOT=0
DO_PREWARM=0
BUNDLE=0
DUMP_IN=""
DUMP_OUT_BASENAME="records_$(date -u +%Y%m%dT%H%M%SZ).dump"

DEBUG=${DEBUG:-0}; ((DEBUG)) && set -x

### ---- helpers ----
log(){ printf "[%s] %s\n" "$(date -u +%H:%M:%S)" "$*"; }
die(){ echo "ERR: $*" >&2; exit 2; }
have(){ command -v "$1" >/dev/null 2>&1; }

PSQL="${PSQL:-/Library/PostgreSQL/16/bin/psql}"
PDUMP="${PDUMP:-/Library/PostgreSQL/16/bin/pg_dump}"
PREST="${PREST:-/Library/PostgreSQL/16/bin/pg_restore}"
have "$PSQL" || PSQL=psql
have "$PDUMP" || PDUMP=pg_dump
have "$PREST" || PREST=pg_restore

### ---- arg parse ----
usage(){
  cat <<EOF
Usage: $0 [--backup [PATH]] [--bundle] [--restore PATH] [--ensure-app] [--prep-hot] [--prewarm]
       $0 --backup                      # writes ./records_YYYYmmddTHHMMSSZ.dump (repo root)
       $0 --backup my.dump              # writes ./my.dump (repo root)
       $0 --backup my.tar.gz --bundle   # writes bundle tarball (repo root)
       $0 --restore my.dump|.sql|.sql.gz|bundle.tar.gz
Actions run in order: ensure-app -> restore -> prep-hot -> prewarm -> backup -> sanity
EOF
}
# We keep a basename and build an absolute path after parse
DUMP_OUT="$DUMP_OUT_BASENAME"

while (( "$#" )); do
  case "${1:-}" in
    --backup) DO_BACKUP=1; shift; if [[ "${1:-}" != "" && "${1:0:1}" != "-" ]]; then DUMP_OUT="$1"; shift; fi ;;
    --bundle) BUNDLE=1; shift ;;
    --restore) DO_RESTORE=1; DUMP_IN="${2:-}"; [[ -n "$DUMP_IN" ]] || die "need --restore <path>"; shift 2 ;;
    --ensure-app) DO_ENSURE_APP=1; shift ;;
    --prep-hot) DO_PREP_HOT=1; shift ;;
    --prewarm) DO_PREWARM=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown arg: $1" ;;
  esac
done

# Normalize paths to repo root
case "$DUMP_OUT" in
  /*)  OUT_PATH="$DUMP_OUT" ;;
  *)   OUT_PATH="$ROOT/$DUMP_OUT" ;;
esac

### ---- k8s + secrets ----
DBPOD="$(kubectl -n "$NS" get pods -o jsonpath='{range .items[*]}{.metadata.name}{" "}{.spec.containers[*].name}{"\n"}{end}' \
  | awk '$0 ~ / db( |$)/ {print $1; exit}')"
[[ -n "$DBPOD" ]] || die "cannot find db pod (container name 'db')"

APP_PW="$(kubectl -n "$NS" get secret pgbouncer-auth -o jsonpath='{.data.userlist\.txt}' \
  | base64 -d | awk -F\" '/^\"'"$APPUSER"'\"/{print $4; exit}')"
PG_PW="$(kubectl -n "$NS" get secret pgbouncer-auth -o jsonpath='{.data.userlist\.txt}' \
  | base64 -d | awk -F\" '/^\"postgres\"/{print $4; exit}')"
[[ -n "$APP_PW" && -n "$PG_PW" ]] || die "could not read passwords from secret pgbouncer-auth"

### ---- port-forward ----
PF_LOG="$(mktemp)"; PF_PID=""
pg_ready(){
  if command -v pg_isready >/dev/null 2>&1; then
    pg_isready -h 127.0.0.1 -p "$PGPORT_LOCAL" >/dev/null 2>&1
  else
    PGPASSWORD="$PG_PW" "$PSQL" -h 127.0.0.1 -p "$PGPORT_LOCAL" -U postgres -d "$DBNAME" -Atc "select 1" >/dev/null 2>&1
  fi
}
pf_stop(){ if [[ -n "${PF_PID:-}" ]]; then kill "$PF_PID" 2>/dev/null || true; wait "$PF_PID" 2>/dev/null || true; fi; rm -f "$PF_LOG"; }
trap pf_stop EXIT

log "port-forwarding deploy/$DBDEP -> localhost:$PGPORT_LOCAL ..."
kubectl -n "$NS" port-forward "deploy/$DBDEP" "$PGPORT_LOCAL:5432" >"$PF_LOG" 2>&1 & PF_PID=$!

for i in {1..60}; do pg_ready && break; sleep 0.5; done
pg_ready || { log "port-forward log:"; tail -n +1 "$PF_LOG" >&2; die "port-forward not ready"; }
log "Postgres is ready on localhost:$PGPORT_LOCAL"

### ---- ensure record_app role & grants (idempotent) ----
if (( DO_ENSURE_APP )); then
  log "ensuring role/grants for $APPUSER..."
  PGPASSWORD="$PG_PW" "$PSQL" -h 127.0.0.1 -p "$PGPORT_LOCAL" -U postgres -d "$DBNAME" -X -v ON_ERROR_STOP=1 -v APP_PW="$APP_PW" <<'SQL'
\pset pager off
SELECT set_config('app.tmp_pw', :'APP_PW', true);
DO $$
DECLARE v text := current_setting('app.tmp_pw', true);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='record_app') THEN
    EXECUTE format('CREATE ROLE record_app LOGIN PASSWORD %L', v);
  END IF;
END$$;

GRANT CONNECT ON DATABASE records TO record_app;
GRANT USAGE ON SCHEMA public, records, records_hot TO record_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA records, records_hot TO record_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA records, records_hot TO record_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA records     GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO record_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA records_hot GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO record_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA records     GRANT USAGE,SELECT ON SEQUENCES TO record_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA records_hot GRANT USAGE,SELECT ON SEQUENCES TO record_app;
RESET app.tmp_pw;
SQL
  log "role/grants OK"
fi

### ---- restore (if requested) ----
if (( DO_RESTORE )); then
  [[ -f "$DUMP_IN" ]] || die "restore file not found: $DUMP_IN"
  log "restoring from $DUMP_IN ..."
  if [[ "$DUMP_IN" == *.tar.gz ]]; then
    TMPX="$(mktemp -d)"; tar xzf "$DUMP_IN" -C "$TMPX"
    DFILE="$(ls "$TMPX"/*.dump 2>/dev/null | head -n1 || true)"
    [[ -n "$DFILE" ]] || die "no *.dump found in bundle"
    PGPASSWORD="$PG_PW" "$PREST" -h 127.0.0.1 -p "$PGPORT_LOCAL" -U postgres -d "$DBNAME" \
      --clean --if-exists --no-owner --no-privileges "$DFILE"
    rm -rf "$TMPX"
  elif [[ "$DUMP_IN" == *.sql.gz ]]; then
    PGPASSWORD="$PG_PW" gzip -dc "$DUMP_IN" \
      | "$PSQL" -h 127.0.0.1 -p "$PGPORT_LOCAL" -U postgres -d "$DBNAME" -X -v ON_ERROR_STOP=1
  elif [[ "$DUMP_IN" == *.sql ]]; then
    PGPASSWORD="$PG_PW" "$PSQL" -h 127.0.0.1 -p "$PGPORT_LOCAL" -U postgres -d "$DBNAME" -X -v ON_ERROR_STOP=1 -f "$DUMP_IN"
  else
    PGPASSWORD="$PG_PW" "$PREST" -h 127.0.0.1 -p "$PGPORT_LOCAL" -U postgres -d "$DBNAME" \
      --clean --if-exists --no-owner --no-privileges "$DUMP_IN"
  fi
  log "restore done"
fi

### ---- prep hot table + indexes (idempotent) ----
if (( DO_PREP_HOT )); then
  log "prepping records_hot (KNN/GIN) ..."
  PGPASSWORD="$PG_PW" "$PSQL" \
    -h 127.0.0.1 -p "$PGPORT_LOCAL" -U postgres -d "$DBNAME" \
    -X -v ON_ERROR_STOP=1 \
    -v HOT_UUID="$HOT_TENANT_UUID" \
    -v HOT_TARGET="$HOT_TENANT_TARGET" <<'SQL'
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE SCHEMA IF NOT EXISTS records_hot;
CREATE TABLE IF NOT EXISTS records_hot.records_hot(
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  search_norm text NOT NULL
);
CREATE INDEX IF NOT EXISTS records_hot_knn
  ON records_hot.records_hot USING gist (search_norm gist_trgm_ops) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS records_hot_search_trgm_gist
  ON records_hot.records_hot USING gist (search_norm gist_trgm_ops);
CREATE INDEX IF NOT EXISTS records_hot_search_trgm_gin
  ON records_hot.records_hot USING gin (search_norm gin_trgm_ops) WITH (fastupdate=off);
CREATE INDEX IF NOT EXISTS records_hot_hottenant_trgm_gist
  ON records_hot.records_hot USING gist (search_norm gist_trgm_ops)
  WHERE user_id = :'HOT_UUID'::uuid;

TRUNCATE TABLE records_hot.records_hot;
INSERT INTO records_hot.records_hot (id, user_id, search_norm)
SELECT id, user_id, COALESCE(search_norm, '')
FROM records.records
WHERE user_id = :'HOT_UUID'::uuid
ORDER BY updated_at DESC
LIMIT :'HOT_TARGET'::integer;

ANALYZE records_hot.records_hot;
SQL
  log "hot prep OK"
fi

### ---- prewarm (if requested) ----
if (( DO_PREWARM )); then
  log "prewarming hot heap + indexes ..."
  PGPASSWORD="$PG_PW" "$PSQL" -h 127.0.0.1 -p "$PGPORT_LOCAL" -U postgres -d "$DBNAME" -X -v ON_ERROR_STOP=1 <<'SQL'
CREATE EXTENSION IF NOT EXISTS pg_prewarm;
SELECT 'heap', pg_prewarm('records_hot.records_hot'::regclass);
SELECT indexrelid::regclass AS idx, pg_prewarm(indexrelid)
FROM pg_index WHERE indrelid='records_hot.records_hot'::regclass
ORDER BY 1;
SQL
  log "prewarm done"
fi

### ---- backup (if requested) ----
if (( DO_BACKUP )); then
  mkdir -p "$(dirname "$OUT_PATH")"
  if (( BUNDLE )) || [[ "$OUT_PATH" == *.tar.gz ]]; then
    [[ "$OUT_PATH" == *.tar.gz ]] || OUT_PATH="${OUT_PATH%.dump}.tar.gz"
    TMPD="$(mktemp -d "$ROOT/dbbk_XXXXXX")"
    DFILE="$TMPD/${DBNAME}.dump"
    MANI="$TMPD/manifest.txt"
    SCHE="$TMPD/schema.sql"

    log "backing up (custom dump) -> $DFILE ..."
    PGPASSWORD="$PG_PW" "$PDUMP" -h 127.0.0.1 -p "$PGPORT_LOCAL" -U postgres -d "$DBNAME" -Fc -f "$DFILE"

    log "capturing schema -> $SCHE ..."
    PGPASSWORD="$PG_PW" "$PDUMP" -h 127.0.0.1 -p "$PGPORT_LOCAL" -U postgres -d "$DBNAME" -s -f "$SCHE"

    log "writing manifest -> $MANI ..."
    PGPASSWORD="$PG_PW" "$PSQL" -h 127.0.0.1 -p "$PGPORT_LOCAL" -U postgres -d "$DBNAME" -At <<'SQL' >"$MANI"
select 'server_version='||current_setting('server_version');
select 'data_checksums='||current_setting('data_checksums',true);
select 'wal_log_hints='||current_setting('wal_log_hints',true);
select 'db_size='||pg_size_pretty(pg_database_size(current_database()));
select 'tbl_records='||(select count(*) from records.records);
select 'tbl_hot='||(select count(*) from records_hot.records_hot);
SQL

    tar czf "$OUT_PATH" -C "$TMPD" .
    rm -rf "$TMPD"
    log "backup bundle written: $OUT_PATH"
  else
    log "backing up to $OUT_PATH ..."
    PGPASSWORD="$PG_PW" "$PDUMP" -h 127.0.0.1 -p "$PGPORT_LOCAL" -U postgres -d "$DBNAME" -Fc -f "$OUT_PATH"
    log "backup written: $OUT_PATH"
  fi
fi

### ---- quick sanity (always) ----
log "sanity: who/rows/index/plans"
PGPASSWORD="$APP_PW" "$PSQL" -h 127.0.0.1 -p "$PGPORT_LOCAL" -U "$APPUSER" -d "$DBNAME" -X -v ON_ERROR_STOP=1 <<'SQL'
\pset pager off
\pset border 2
\pset linestyle unicode
SELECT inet_server_addr()||':'||inet_server_port() AS server,
       pg_postmaster_start_time() AS started,
       (pg_control_system()).system_identifier AS sysid;
SELECT current_user usr, current_setting('server_version') pg, current_database() db, now() ts;
SELECT count(*) AS records_rows FROM records.records;
SELECT count(*) AS hot_rows     FROM records_hot.records_hot;
SET jit=off; SET random_page_cost=1.0; SET enable_seqscan=off;
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*) FROM (
  SELECT id
  FROM records_hot.records_hot
  WHERE user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid
  ORDER BY search_norm <-> lower('鄧麗君 album 263 cn-041 polygram')
  LIMIT 50
) s;
SQL

log "GUI connection:"
log "postgresql://${APPUSER}:<APP_PW>@localhost:${PGPORT_LOCAL}/${DBNAME}"
 