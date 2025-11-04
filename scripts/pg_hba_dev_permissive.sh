#!/usr/bin/env bash
set -euo pipefail
NS="${1:-record-platform}"
kubectl -n "$NS" exec -i deploy/postgres -- sh -lc '
cat >> $PGDATA/pg_hba.conf <<EOF
host all all 10.244.0.0/16 scram-sha-256
host all all 10.96.0.0/12  scram-sha-256
EOF
echo "select pg_reload_conf();" | psql -U postgres -d postgres -At
'
