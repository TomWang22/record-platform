#!/usr/bin/env bash
set -euo pipefail
NS="${NS:-record-platform}"
echo "→ Checking direct PG (postgres service) ..."
kubectl -n "$NS" run psql-check --rm -i --restart=Never --image=postgres:16 -- \
  bash -lc 'read -r PGPASSWORD < /dev/stdin;
            export PGHOST=postgres.record-platform.svc.cluster.local PGUSER=postgres PGDATABASE=records;
            export PGPASSWORD;
            pg_isready -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" &&
            psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -Atqc "select version();" ' <<'EOF'
SUPER_STRONG_POSTGRES_PASSWORD
EOF
