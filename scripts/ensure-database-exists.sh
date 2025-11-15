#!/usr/bin/env bash
set -Eeuo pipefail

# Ensure the records database exists, restore from backup if needed
# This can be run on pod startup or manually

NS="${NS:-record-platform}"

# Wait for pod to be ready
echo "Waiting for Postgres pod to be ready..."
kubectl -n "$NS" wait pod -l app=postgres --for=condition=Ready --timeout=120s >/dev/null 2>&1 || {
  echo "Error: Postgres pod not ready" >&2
  exit 1
}

PGPOD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' | awk 'NR==1{print $1}')

if [[ -z "$PGPOD" ]]; then
  echo "Error: Postgres pod not found" >&2
  exit 1
fi

# Wait for database to accept connections
echo "Waiting for database to accept connections..."
MAX_RETRIES=30
RETRY_COUNT=0
while [[ $RETRY_COUNT -lt $MAX_RETRIES ]]; do
  if kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d postgres -X -P pager=off -c "SELECT 1;" >/dev/null 2>&1; then
    echo "✅ Database is ready!"
    break
  fi
  RETRY_COUNT=$((RETRY_COUNT + 1))
  if [[ $RETRY_COUNT -lt $MAX_RETRIES ]]; then
    echo "  Waiting... ($RETRY_COUNT/$MAX_RETRIES)"
    sleep 2
  else
    echo "Error: Database not ready after $MAX_RETRIES retries" >&2
    exit 1
  fi
done

# Check if records database exists
echo "Checking if records database exists..."
DB_EXISTS=$(kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d postgres -X -P pager=off -At -c "SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname='records');" 2>/dev/null || echo "f")

if [[ "$DB_EXISTS" == "t" ]]; then
  echo "✅ Records database exists"
  exit 0
fi

echo "❌ Records database does not exist - need to restore from backup"
echo ""
echo "Available backups:"
ls -lh backups/*.dump 2>/dev/null | tail -5 || echo "  No .dump files found"
ls -lh backups/*.tar.gz 2>/dev/null | tail -5 || echo "  No .tar.gz files found"

# Try to find latest backup
LATEST_DUMP=$(ls -t backups/*.dump 2>/dev/null | head -1)
LATEST_TAR=$(ls -t backups/*.tar.gz 2>/dev/null | head -1)

if [[ -n "$LATEST_DUMP" ]]; then
  echo ""
  echo "Found dump file: $LATEST_DUMP"
  echo "Restoring from backup..."
  ./scripts/restore-from-local-backup.sh "$LATEST_DUMP"
elif [[ -n "$LATEST_TAR" ]]; then
  echo ""
  echo "Found tar.gz file: $LATEST_TAR"
  echo "Extracting dump from tar.gz..."
  cd backups
  tar -xzf "$(basename "$LATEST_TAR")" "$(basename "$LATEST_TAR" .tar.gz).dump" 2>/dev/null || true
  EXTRACTED_DUMP="backups/$(basename "$LATEST_TAR" .tar.gz).dump"
  cd ..
  if [[ -f "$EXTRACTED_DUMP" ]]; then
    echo "Restoring from extracted dump..."
    ./scripts/restore-from-local-backup.sh "$EXTRACTED_DUMP"
  else
    echo "Error: Could not extract dump from tar.gz" >&2
    exit 1
  fi
else
  echo ""
  echo "Error: No backup files found to restore from" >&2
  echo "Please restore manually or create the database:" >&2
  echo "  kubectl -n $NS exec $PGPOD -c db -- createdb -U postgres records" >&2
  exit 1
fi

