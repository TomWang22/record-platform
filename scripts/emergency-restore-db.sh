#!/usr/bin/env bash
set -Eeuo pipefail

# Emergency database restore - handles the case where database creation is failing
NS="${NS:-record-platform}"

PGPOD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' | awk 'NR==1{print $1}')

if [[ -z "$PGPOD" ]]; then
  echo "Error: Postgres pod not found" >&2
  exit 1
fi

echo "=== Emergency Database Restore ==="
echo "Pod: $PGPOD"
echo ""

# Try to create database with explicit error checking
echo "Creating records database..."
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d postgres <<'SQL' 2>&1 | tee /tmp/db_create.log
DROP DATABASE IF EXISTS records;
CREATE DATABASE records;
SELECT 'Database created: ' || datname FROM pg_database WHERE datname = 'records';
SQL

# Check if it actually worked
sleep 3
DB_EXISTS=$(kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d postgres -t -c "SELECT COUNT(*) FROM pg_database WHERE datname = 'records';" 2>/dev/null | tr -d ' ' || echo "0")

if [[ "$DB_EXISTS" == "0" ]]; then
  echo "❌ ERROR: Database creation failed!" >&2
  echo "Checking logs..." >&2
  kubectl -n "$NS" logs "$PGPOD" -c db --tail=30 | grep -i "error\|fatal" | tail -10
  echo "" >&2
  echo "This may indicate a Postgres configuration issue." >&2
  echo "Try restarting the postgres pod:" >&2
  echo "  kubectl -n $NS rollout restart deploy/postgres" >&2
  exit 1
fi

echo "✅ Database exists in catalog"

# Wait for it to be accessible
echo "Waiting for database to be accessible..."
for i in {1..20}; do
  if kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -t -c "SELECT 1;" >/dev/null 2>&1; then
    echo "✅ Database accessible on attempt $i"
    break
  fi
  if [[ $i -eq 20 ]]; then
    echo "❌ ERROR: Database created but not accessible after 20 attempts" >&2
    exit 1
  fi
  sleep 2
done

echo ""
echo "✅ Database 'records' is ready!"
echo ""
echo "Next steps:"
echo "  1. Apply schema: kubectl -n $NS get configmap postgres-postinit-sql -o jsonpath='{.data.postinit\\.sql}' | kubectl -n $NS exec -i $PGPOD -c db -- psql -U postgres -d records"
echo "  2. Restore data: ./scripts/restore-from-local-backup.sh"
