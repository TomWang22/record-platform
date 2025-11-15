#!/usr/bin/env bash
set -Eeuo pipefail

# This script automatically restores the database if it's missing
# Can be run as a Kubernetes init container or manually

NS="${NS:-record-platform}"

echo "=== Auto-Restore on Startup ==="
echo "Checking if records database exists..."

# Wait for pod to be ready
MAX_WAIT=120
WAITED=0
while [[ $WAITED -lt $MAX_WAIT ]]; do
  PGPOD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' | awk 'NR==1{print $1}')
  if [[ -n "$PGPOD" ]] && kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d postgres -c "SELECT 1;" >/dev/null 2>&1; then
    break
  fi
  sleep 2
  WAITED=$((WAITED + 2))
done

if [[ -z "$PGPOD" ]]; then
  echo "Error: Postgres pod not found" >&2
  exit 1
fi

# Check if records database exists
DB_EXISTS=$(kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d postgres -X -P pager=off -At -c "SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname='records');" 2>/dev/null || echo "f")

if [[ "$DB_EXISTS" == "t" ]]; then
  echo "✅ Records database exists - no restore needed"
  exit 0
fi

echo "❌ Records database missing - restoring from backup..."

# Find latest backup
LATEST_DUMP=$(ls -t backups/*.dump 2>/dev/null | head -1)

if [[ -z "$LATEST_DUMP" ]]; then
  echo "Error: No backup dump file found in backups/" >&2
  exit 1
fi

echo "Using backup: $LATEST_DUMP"
./scripts/restore-from-local-backup.sh "$LATEST_DUMP"

echo "✅ Auto-restore complete"

