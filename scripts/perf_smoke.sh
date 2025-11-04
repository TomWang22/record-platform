#!/usr/bin/env bash
#bash perf_smoke.sh record-platform "kend" 16 24 32
set -euo pipefail

NS="${1:-record-platform}"
Q="${2:-kend}"
shift 2 || true
CS=("${@:-16 24 32}")

PGHOST_PGB="pgbouncer.${NS}.svc.cluster.local"
PGHOST_PG="postgres.${NS}.svc.cluster.local"
PGPORT_PGB=6432
PGPORT_PG=5432
APP_USER="record_app"
APP_PASS="SUPER_STRONG_APP_PASSWORD"
PG_SUPER="postgres"
PG_SUPER_PASS="SUPER_STRONG_POSTGRES_PASSWORD"
DB="records"

echo "== Resolve/ensure USER_ID =="
USER_ID="${USER_ID:-}"
if [ -z "${USER_ID}" ]; then
  USER_ID=$(kubectl -n "$NS" run psql-id --rm -i --restart=Never \
    --image=postgres:16-alpine --env PGPASSWORD="$PG_SUPER_PASS" -- \
    psql "postgresql://${PG_SUPER}@${PGHOST_PG}:${PGPORT_PG}/${DB}" -Atv ON_ERROR_STOP=1 <<'SQL' \
      | grep -Eo '([0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12})' | head -n1
WITH ins AS (
  INSERT INTO auth.users(email)
  VALUES ('bench@example.com')
  ON CONFLICT (email) DO NOTHING
  RETURNING id
)
SELECT COALESCE(
  (SELECT id FROM ins),
  (SELECT id FROM auth.users WHERE email='bench@example.com' LIMIT 1)
);
SQL
)
fi
echo "USER_ID=${USER_ID}"

echo
echo "== PgBouncer admin =="
kubectl -n "$NS" run psql-admin --rm -i --restart=Never \
  --image=postgres:16-alpine --env PGPASSWORD="$PG_SUPER_PASS" -- sh -lc "
cat <<SQL | psql 'postgresql://${PG_SUPER}@${PGHOST_PGB}:${PGPORT_PGB}/pgbouncer'
SHOW DATABASES;
SHOW POOLS;
SHOW STATS;
SQL
"

echo
echo "== Ensure pg_stat_statements in ${DB} =="
kubectl -n "$NS" exec -i deploy/postgres -- \
  psql "postgresql://${PG_SUPER}@localhost:5432/${DB}" -v ON_ERROR_STOP=1 <<'SQL'
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
GRANT SELECT ON pg_stat_statements TO record_app;
SQL

echo
echo "== Warm-up =="
kubectl -n "$NS" run warm --rm -i --restart=Never \
  --image=postgres:16-alpine \
  --env PGHOST="${PGHOST_PGB}" --env PGPORT="${PGPORT_PGB}" \
  --env PGUSER="${APP_USER}" --env PGPASSWORD="${APP_PASS}" --env PGDATABASE="${DB}" \
  -- sh -lc "
cat >/tmp/f.sql <<SQL
SELECT id, rank
FROM public.search_records_fuzzy_ids(:user_id::uuid,:q,50::bigint,0::bigint);
SQL
pgbench -n -M extended -c 8 -j 4 -T 5 -f /tmp/f.sql -D user_id='${USER_ID}' -D q='${Q}'
"

echo
echo "== Runs =="
for C in "${CS[@]}"; do
  echo "-- c=${C} j=8"
  kubectl -n "$NS" run bench --rm -i --restart=Never \
    --image=postgres:16-alpine \
    --env PGHOST="${PGHOST_PGB}" --env PGPORT="${PGPORT_PGB}" \
    --env PGUSER="${APP_USER}" --env PGPASSWORD="${APP_PASS}" --env PGDATABASE="${DB}" \
    -- sh -lc "
set -e
cd /dev/shm
cat >/tmp/f.sql <<SQL
SELECT id, rank
FROM public.search_records_fuzzy_ids(:user_id::uuid,:q,50::bigint,0::bigint);
SQL
pgbench -n -M extended -P 2 -r -c ${C} -j 8 -T 30 -l \
  -f /tmp/f.sql -D user_id='${USER_ID}' -D q='${Q}'
FILES=\$(ls -1 /dev/shm/pgbench_log.* 2>/dev/null || true)
echo '---- percentiles ----'
if [ -n \"\${FILES}\" ]; then
  awk 'NF>=5 && \$5 ~ /^[0-9]+$/ {print \$5}' \${FILES} \
    | sort -n \
    | awk '{
        a[NR]=\$1
      }
      END{
        if(NR==0){print \"no samples\"; exit}
        p50=int(0.50*(NR-1))+1
        p95=int(0.95*(NR-1))+1
        p99=int(0.99*(NR-1))+1
        printf \"N=%d p50=%sµs p95=%sµs p99=%sµs\\n\", NR, a[p50], a[p95], a[p99]
      }'
else
  echo 'no samples'
fi
"
done

echo
echo "== DB-side view (top queries) =="
kubectl -n "$NS" exec -i deploy/postgres -- \
  psql "postgresql://${PG_SUPER}@localhost:5432/${DB}" -c "
SELECT query, calls,
       round(total_time/1000.0,1) AS s_total,
       round(mean_time,2) AS ms_avg,
       round(stddev_time,2) AS ms_stddev,
       rows
FROM pg_stat_statements
ORDER BY total_time DESC
LIMIT 10;"

echo
echo "== PgBouncer stats after =="
kubectl -n "$NS" run psql-admin2 --rm -i --restart=Never \
  --image=postgres:16-alpine --env PGPASSWORD="$PG_SUPER_PASS" -- sh -lc "
cat <<SQL | psql 'postgresql://${PG_SUPER}@${PGHOST_PGB}:${PGPORT_PGB}/pgbouncer'
SHOW STATS;
SHOW POOLS;
SQL
"

# Optional crash drill (set CRASH_TEST=1)
if [ \"${CRASH_TEST:-0}\" = \"1\" ]; then
  echo
  echo '== Crash drill =='
  kubectl -n \"$NS\" delete pod -l app=postgres --force --grace-period=0
  echo 'Waiting for postgres to come back...'
  kubectl -n \"$NS\" rollout status deploy/postgres
  kubectl -n \"$NS\" exec -i deploy/postgres -- \
    psql \"postgresql://${PG_SUPER}@localhost:5432/${DB}\" -c 'VACUUM (ANALYZE) records.records;'
  kubectl -n \"$NS\" exec -i deploy/postgres -- \
    psql \"postgresql://${PG_SUPER}@localhost:5432/${DB}\" -c 'SELECT count(*) FROM records.records;'
fi
