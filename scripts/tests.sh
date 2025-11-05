#!/usr/bin/env bash
set -euo pipefail
NS=record-platform
APP=records-service

# PgBouncer connectivity
kubectl -n "$NS" run psql --rm -it --image=postgres:16 -- \
 'psql "host=pgbouncer.record-platform.svc.cluster.local port=6432 dbname=records user=record_app password=REPLACE_WITH_APP_PASSWORD sslmode=disable" -c SELECT\ 1;'

# Insert/find a user and capture USER_ID
USER_ID="$(
  kubectl -n "$NS" exec deploy/postgres -- bash -lc \
  "psql -U postgres -d records -Atqc \"
     WITH up AS (
       INSERT INTO auth.users(email)
       VALUES ('tom@example.com')
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING id
     )
     SELECT id FROM up
     UNION ALL
     SELECT id FROM auth.users WHERE email='tom@example.com'
     LIMIT 1;\""
)"; echo "USER_ID=${USER_ID}"

# Call service
kubectl -n "$NS" run curl-rs --rm -it --restart=Never --image=curlimages/curl:8.10.1 -- \
  sh -lc 'curl -sS http://'"$APP"'.record-platform.svc.cluster.local:4002/_ping && echo'

# Quick explain to sanity-check plan shape
kubectl -n "$NS" exec -i deploy/postgres -- bash -lc \
"psql -U postgres -d records -c \"EXPLAIN (ANALYZE,BUFFERS)
 SELECT id, rank FROM public.search_records_fuzzy_ids('${USER_ID}'::uuid, '鄧麗君', 20, 0);\""
