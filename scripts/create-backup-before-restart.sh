#!/usr/bin/env bash
set -Eeuo pipefail

# Create a backup before restarting the pod
# Usage: ./scripts/create-backup-before-restart.sh

NS="${NS:-record-platform}"

echo "=== Creating Backup Before Restart ==="

# Wait for pod
PGPOD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' | awk 'NR==1{print $1}')

if [[ -z "$PGPOD" ]]; then
  echo "Error: Postgres pod not found" >&2
  exit 1
fi

# Wait for database
MAX_RETRIES=30
RETRY_COUNT=0
while [[ $RETRY_COUNT -lt $MAX_RETRIES ]]; do
  if kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -c "SELECT 1;" >/dev/null 2>&1; then
    break
  fi
  RETRY_COUNT=$((RETRY_COUNT + 1))
  sleep 2
done

# Check if database exists
DB_EXISTS=$(kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d postgres -X -P pager=off -At -c "SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname='records');" 2>/dev/null || echo "f")

if [[ "$DB_EXISTS" != "t" ]]; then
  echo "Warning: Records database does not exist - nothing to backup" >&2
  exit 0
fi

# Create backup
BACKUP_FILE="backups/pre_restart_backup_$(date +%Y%m%d_%H%M%S).dump"
echo "Creating backup: $BACKUP_FILE"

kubectl -n "$NS" exec "$PGPOD" -c db -- pg_dump -U postgres -Fc records > "$BACKUP_FILE"

if [[ -f "$BACKUP_FILE" ]]; then
  SIZE=$(ls -lh "$BACKUP_FILE" | awk '{print $5}')
  echo "✅ Backup created: $BACKUP_FILE ($SIZE)"
else
  echo "Error: Backup file was not created" >&2
  exit 1
fi

