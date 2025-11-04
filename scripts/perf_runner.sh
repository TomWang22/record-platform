#!/usr/bin/env bash
set -euo pipefail

# -------------------------------------------------------------------
# Defaults (override via env or flags)
# -------------------------------------------------------------------
NS="${NS:-record-platform}"

# App creds (PgBouncer target by default)
PGHOST="${PGHOST:-pgbouncer.record-platform.svc.cluster.local}"
PGPORT="${PGPORT:-6432}"
PGUSER="${PGUSER:-record_app}"
PGPASSWORD="${PGPASSWORD:-SUPER_STRONG_APP_PASSWORD}"
PGDATABASE="${PGDATABASE:-records}"

# PgBouncer admin creds (for SHOW POOLS/STATS)
PGADMIN_USER="${PGADMIN_USER:-postgres}"
PGADMIN_PASS="${PGADMIN_PASS:-SUPER_STRONG_POSTGRES_PASSWORD}"

# Test params
Q_DEFAULT="kend"
C_DEFAULT="16"
T_DEFAULT="30"
J_DEFAULT="8"
MODE_DEFAULT="simple"      # PgBouncer txn pooling wants simple mode
WARMUP_DEFAULT="1"

# Optional toggles
CSV="${CSV:-0}"            # CSV=1 to emit a single CSV:... summary line per run
SHOW_PGB="${SHOW_PGB:-0}"  # SHOW_PGB=1 to print PgBouncer POOLS/STATS

# USER_ID must be supplied (env or --user-id)
USER_ID="${USER_ID:-}"

usage() {
  cat <<EOF
perf_runner.sh — Postgres/PgBouncer bench helper

USAGE:
  $0 run      [-q QUERY] [-c CLIENTS] [-t DURATION] [-j THREADS] [--mode simple] [--no-warmup]
              [--user-id UUID] [--ns NAMESPACE] [--csv|--no-csv] [--show-pgb|--no-show-pgb]
  $0 sweep    [-q "q1 q2 ..."] [-c "8 16 24 32"] [-t DURATION] [-j THREADS] [--mode simple]
              [--user-id UUID] [--ns NS] [--csv|--no-csv] [--show-pgb|--no-show-pgb]
  $0 pgb      [--ns NS]                    # SHOW POOLS/STATS
  $0 dbview   [--ns NS]                    # pg_stat_* snapshots
  $0 coldrun  [-q QUERY] [-c CLIENTS] [-t DURATION] [-j THREADS] [--mode simple]
              [--user-id UUID] [--ns NS] [--csv|--no-csv] [--show-pgb|--no-show-pgb]
             (deletes Postgres pod first to simulate cold cache)

ENV that can override defaults:
  NS, PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE, PGADMIN_USER, PGADMIN_PASS, USER_ID, CSV, SHOW_PGB

Examples:
  $0 run   -q kend -c 32 -t 30 -j 8
  $0 sweep -q "ken kend kendrick the" -c "8 16 24 32"
  CSV=1 SHOW_PGB=0 $0 run -q kend -c 32 -t 30 -j 8
  USER_ID=\$(uuidgen) $0 run -q kend -c 16
EOF
}

need_user_id() {
  if [[ -z "${USER_ID:-}" ]]; then
    echo "ERROR: USER_ID not set. Export USER_ID=... (the test account's UUID) and re-run." >&2
    exit 2
  fi
}

pgb_stats() {
  kubectl -n "$NS" exec -i deploy/pgbouncer -- \
    psql "postgresql://$PGADMIN_USER:$PGADMIN_PASS@localhost:6432/pgbouncer" \
    -c "SHOW POOLS;" -c "SHOW STATS;" || true
}

db_view() {
  kubectl -n "$NS" exec -i deploy/postgres -- \
    psql "postgresql://postgres@localhost:5432/$PGDATABASE" <<'SQL' || true
SELECT 'pg_stat_statements (top 10 by total_exec_time)' AS section;
SELECT query, calls,
       round((total_exec_time/1000.0)::numeric, 1) AS s_total,
       round(mean_exec_time::numeric, 2)  AS ms_avg,
       round(stddev_exec_time::numeric, 2) AS ms_stddev,
       round(min_exec_time::numeric, 2)    AS ms_min,
       round(max_exec_time::numeric, 2)    AS ms_max,
       rows
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 10;

SELECT 'pg_stat_bgwriter' AS section;
SELECT * FROM pg_stat_bgwriter;

SELECT 'pg_stat_io (first 30 rows)' AS section;
SELECT * FROM pg_stat_io LIMIT 30;
SQL
}

do_run() {
  local Q="$1" C="$2" T="$3" J="$4" MODE="$5" WARMUP="$6"

  need_user_id

  # For PgBouncer txn pooling, 'simple' is the safe mode (extended would require bind-style SQL)
  if [[ "$MODE" != "simple" ]]; then
    echo "NOTE: Forcing --mode simple (PgBouncer/runner quoting expects simple mode)." >&2
    MODE="simple"
  fi

  # Unique pod name avoids clashes on rapid reruns
  local PODNAME="bench-$(date +%s)-$RANDOM"

  kubectl -n "$NS" run "$PODNAME" --rm -i --restart=Never \
    --image=postgres:16-alpine \
    --env PGHOST="$PGHOST" \
    --env PGPORT="$PGPORT" \
    --env PGUSER="$PGUSER" \
    --env PGPASSWORD="$PGPASSWORD" \
    --env PGDATABASE="$PGDATABASE" \
    --env USER_ID="$USER_ID" \
    --env QUERY="$Q" \
    --env CLIENTS="$C" \
    --env THREADS="$J" \
    --env DURATION="$T" \
    --env MODE="$MODE" \
    --env WARMUP="$WARMUP" \
    --env PGADMIN_USER="$PGADMIN_USER" \
    --env PGADMIN_PASS="$PGADMIN_PASS" \
    --env CSV="$CSV" \
    --env SHOW_PGB="$SHOW_PGB" \
    -- /bin/sh -s <<'POD'
set -e

# Per-run work dir so logs never mix between runs
WORK=/dev/shm/bench-$(date +%s)-$RANDOM
mkdir -p "$WORK"
cd "$WORK"

# SQL file (pgbench textual -D substitution in simple mode)
cat >/tmp/f.sql <<'SQL'
SELECT id, rank
FROM public.search_records_fuzzy_ids(:user_id::uuid, :q, 50::bigint, 0::bigint);
SQL

# Properly quoted -D values for simple mode; escape any single quotes in QUERY
q_esc=$(printf "%s" "$QUERY" | sed "s/'/''/g")
UIDV="'$USER_ID'"
QV="'$q_esc'"

# Warmup to stabilize caches
if [ "${WARMUP:-1}" = "1" ]; then
  pgbench -n -M "$MODE" -c 8 -j 4 -T 5 \
    -f /tmp/f.sql \
    -D user_id="$UIDV" \
    -D q="$QV" \
    >/dev/null
fi

# Real run (capture stdout)
pgbench -n -M "$MODE" -r -c "$CLIENTS" -j "$THREADS" -T "$DURATION" -l \
  -f /tmp/f.sql \
  -D user_id="$UIDV" \
  -D q="$QV" \
  2>&1 | tee "$WORK/pgbench.out"

FILES=$(ls -1 "$WORK"/pgbench_log.* 2>/dev/null || true)

# Summaries (from stdout)
TPS=$(awk '/^tps = /{print $3}' "$WORK/pgbench.out" | tail -n1)
AVG_MS=$(awk '/^latency average/ {print $4}' "$WORK/pgbench.out" | tail -n1)

echo "---- percentiles ----"
if [ -z "$FILES" ]; then
  echo "no samples"
else
  # Auto-detect latency column (µs) that best matches AVG_MS*1000
  BESTCOL=0; BESTDIFF=1e99
  for COL in $(seq 3 12); do
    MEAN_US=$(awk -v c=$COL 'NF>=c && $c ~ /^[0-9]+$/ {sum+=$c; n++; if(n==400) exit} END{if(n) printf("%.0f", sum/n);}' $FILES)
    [ -z "$MEAN_US" ] && continue
    DIFF=$(awk -v a="$AVG_MS" -v m="$MEAN_US" 'BEGIN{d=m - a*1000; if(d<0)d=-d; print d}')
    smaller=$(awk -v d="$DIFF" -v b="$BESTDIFF" 'BEGIN{print (d<b)?1:0}')
    if [ "$smaller" -eq 1 ]; then BESTDIFF="$DIFF"; BESTCOL="$COL"; fi
  done
  [ "$BESTCOL" -eq 0 ] && BESTCOL=6

  awk -v c="$BESTCOL" 'NF>=c && $c ~ /^[0-9]+$/ {print $c}' $FILES \
    | sort -n \
    | awk -v col="$BESTCOL" -v tps="$TPS" -v avg="$AVG_MS" -v q="$QUERY" -v ccli="$CLIENTS" -v thr="$THREADS" -v dur="$DURATION" -v mode="$MODE" -v csv="$CSV" '
        function idx(p,n){return int(p*(n-1))+1}
        {a[++n]=$1}
        END{
          if(n==0){print "no samples"; exit}
          p50=a[idx(.50,n)]; p90=a[idx(.90,n)]; p95=a[idx(.95,n)]; p99=a[idx(.99,n)]; p999=a[idx(.999,n)]; pmax=a[n];
          printf "N=%d p50=%sµs p90=%sµs p95=%sµs p99=%sµs p99.9=%sµs max=%sµs (latcol=%d, tps=%s, avg=%sms)\n",
            n, p50, p90, p95, p99, p999, pmax, col, tps, avg;
          if (csv == "1")
            printf "CSV:%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n",
              strftime("%Y-%m-%dT%H:%M:%S%z"), q, ccli, thr, dur, mode, tps, avg, p50, p90, p95, p99, p999;
        }'
fi

if [ "${SHOW_PGB:-0}" = "1" ]; then
  echo
  echo "---- PgBouncer POOLS/STATS ----"
  # Use \$PGHOST:\$PGPORT which normally points at PgBouncer (dbname=pgbouncer)
  psql "postgresql://$PGADMIN_USER:$PGADMIN_PASS@${PGHOST:-pgbouncer.record-platform.svc.cluster.local}:${PGPORT:-6432}/pgbouncer" \
    -c "SHOW POOLS;" -c "SHOW STATS;" >/dev/stderr || true
fi

# Clean up this run’s logs
cd /dev/shm && rm -rf "$WORK"
POD
}

do_sweep() {
  local QUERIES="$1" COUNTS="$2" T="$3" J="$4" MODE="$5"
  need_user_id
  for q in $QUERIES; do
    echo "=== q='$q' ==="
    for c in $COUNTS; do
      echo "-- c=$c --"
      do_run "$q" "$c" "$T" "$J" "$MODE" "1" || true
      echo
    done
  done
}

do_coldrun() {
  local Q="$1" C="$2" T="$3" J="$4" MODE="$5"
  need_user_id
  echo "Deleting Postgres pod(s) for cold-cache run..." >&2
  kubectl -n "$NS" delete pod -l app=postgres --force --grace-period=0 || true
  echo "Waiting for Postgres to be Ready..." >&2
  kubectl -n "$NS" rollout status deploy/postgres
  do_run "$Q" "$C" "$T" "$J" "$MODE" "1"
}

# ----------------- arg parsing helpers -----------------
# We parse flags per subcommand to keep behavior intuitive.
parse_common_flags() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -q) Q="$2"; shift 2 ;;
      -c) C="$2"; shift 2 ;;
      -t) T="$2"; shift 2 ;;
      -j) J="$2"; shift 2 ;;
      --mode) MODE="$2"; shift 2 ;;
      --no-warmup) WARMUP="0"; shift ;;
      --user-id) USER_ID="$2"; shift 2 ;;
      --ns) NS="$2"; shift 2 ;;
      --csv) CSV="1"; shift ;;
      --no-csv) CSV="0"; shift ;;
      --show-pgb) SHOW_PGB="1"; shift ;;
      --no-show-pgb) SHOW_PGB="0"; shift ;;
      -h|--help) usage; exit 0 ;;
      *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
    esac
  done
}

# ----------------- arg parsing -----------------
cmd="${1:-}"; shift || true

case "${cmd:-}" in
  run)
    Q="$Q_DEFAULT"; C="$C_DEFAULT"; T="$T_DEFAULT"; J="$J_DEFAULT"; MODE="$MODE_DEFAULT"; WARMUP="$WARMUP_DEFAULT"
    parse_common_flags "$@"
    do_run "$Q" "$C" "$T" "$J" "$MODE" "$WARMUP"
    ;;
  sweep)
    QUERIES="ken kend kendrick the á ö zzzz q%"
    COUNTS="8 16 24 32 40 48"
    T="$T_DEFAULT"; J="$J_DEFAULT"; MODE="$MODE_DEFAULT"; WARMUP="1"
    # consume sweep-specific flags + common toggles
    while [[ $# -gt 0 ]]; do
      case "$1" in
        -q) QUERIES="$2"; shift 2 ;;
        -c) COUNTS="$2"; shift 2 ;;
        -t) T="$2"; shift 2 ;;
        -j) J="$2"; shift 2 ;;
        --mode) MODE="$2"; shift 2 ;;
        --user-id) USER_ID="$2"; shift 2 ;;
        --ns) NS="$2"; shift 2 ;;
        --csv) CSV="1"; shift ;;
        --no-csv) CSV="0"; shift ;;
        --show-pgb) SHOW_PGB="1"; shift ;;
        --no-show-pgb) SHOW_PGB="0"; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
      esac
    done
    need_user_id
    for q in $QUERIES; do
      echo "=== q='$q' ==="
      for c in $COUNTS; do
        echo "-- c=$c --"
        do_run "$q" "$c" "$T" "$J" "$MODE" "$WARMUP" || true
        echo
      done
    done
    ;;
  pgb)
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --ns) NS="$2"; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
      esac
    done
    pgb_stats
    ;;
  dbview)
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --ns) NS="$2"; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
      esac
    done
    db_view
    ;;
  coldrun)
    Q="$Q_DEFAULT"; C="$C_DEFAULT"; T="$T_DEFAULT"; J="$J_DEFAULT"; MODE="$MODE_DEFAULT"
    while [[ $# -gt 0 ]]; do
      case "$1" in
        -q) Q="$2"; shift 2 ;;
        -c) C="$2"; shift 2 ;;
        -t) T="$2"; shift 2 ;;
        -j) J="$2"; shift 2 ;;
        --mode) MODE="$2"; shift 2 ;;
        --user-id) USER_ID="$2"; shift 2 ;;
        --ns) NS="$2"; shift 2 ;;
        --csv) CSV="1"; shift ;;
        --no-csv) CSV="0"; shift ;;
        --show-pgb) SHOW_PGB="1"; shift ;;
        --no-show-pgb) SHOW_PGB="0"; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
      esac
    done
    do_coldrun "$Q" "$C" "$T" "$J" "$MODE"
    ;;
  ""|-h|--help)
    usage
    ;;
  *)
    echo "Unknown command: $cmd" >&2
    usage
    exit 2
    ;;
esac
