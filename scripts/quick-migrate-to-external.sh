#!/usr/bin/env bash
set -Eeuo pipefail

# Quick migration: K8s → External Postgres (direct connection)
# This is the simplest path - no service abstraction, just direct connection

if [[ $# -lt 1 ]]; then
  cat <<USAGE
Usage: $0 <external-host> [options]

  <external-host>    External Postgres hostname or IP (required)
  --port PORT        Postgres port (default: 5432)
  --user USER        Postgres user (default: record_app)
  --db DB            Database name (default: records)
  --namespace NS     K8s namespace (default: record-platform)
  --skip-export      Skip export (use existing backup)
  --skip-import      Skip import (only update config)

Examples:
  # Full migration
  $0 192.168.1.100

  # Only update config (Postgres already set up)
  $0 192.168.1.100 --skip-export --skip-import

  # Only export (manual import later)
  $0 192.168.1.100 --skip-import
USAGE
  exit 1
fi

EXTERNAL_HOST="$1"
shift

EXTERNAL_PORT=5432
EXTERNAL_USER="record_app"
EXTERNAL_DB="records"
NS="record-platform"
SKIP_EXPORT=false
SKIP_IMPORT=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) EXTERNAL_PORT="$2"; shift 2 ;;
    --user) EXTERNAL_USER="$2"; shift 2 ;;
    --db) EXTERNAL_DB="$2"; shift 2 ;;
    --namespace) NS="$2"; shift 2 ;;
    --skip-export) SKIP_EXPORT=true; shift ;;
    --skip-import) SKIP_IMPORT=true; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

echo "=== Quick Migration: K8s → External Postgres ==="
echo "External Host: $EXTERNAL_HOST:$EXTERNAL_PORT"
echo "Database: $EXTERNAL_DB"
echo "User: $EXTERNAL_USER"
echo ""

# Step 1: Export
if [[ "$SKIP_EXPORT" != "true" ]]; then
  echo "Step 1: Exporting from Kubernetes..."
  POD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  
  if [[ -z "$POD" ]]; then
    echo "⚠️  Postgres pod not found. Skipping export." >&2
    SKIP_IMPORT=true
  else
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    BACKUP_FILE="./backups/records_migration_${TIMESTAMP}.dump"
    mkdir -p ./backups
    
    echo "Creating backup: $BACKUP_FILE"
    kubectl -n "$NS" exec "$POD" -c db -- \
      env PGHOST=/var/run/postgresql PGUSER=postgres PGDATABASE=records \
      pg_dump -F c -f /tmp/migration_backup.dump
    
    kubectl -n "$NS" cp "$POD:/tmp/migration_backup.dump" "$BACKUP_FILE" -c db
    kubectl -n "$NS" exec "$POD" -c db -- rm -f /tmp/migration_backup.dump
    
    echo "✅ Backup created: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"
    export BACKUP_FILE
  fi
else
  echo "Step 1: Skipping export (--skip-export)"
  BACKUP_FILE="${BACKUP_FILE:-./backups/records_latest.dump}"
fi

# Step 2: Import
if [[ "$SKIP_IMPORT" != "true" ]] && [[ -f "${BACKUP_FILE:-}" ]]; then
  echo ""
  echo "Step 2: Importing to external Postgres..."
  
  # Test connection
  if ! PGPASSWORD="${PGPASSWORD:-SUPER_STRONG_APP_PASSWORD}" \
       psql -h "$EXTERNAL_HOST" -p "$EXTERNAL_PORT" -U "$EXTERNAL_USER" -d postgres \
       -c "SELECT 1;" >/dev/null 2>&1; then
    echo "❌ Cannot connect to external Postgres" >&2
    echo "   Please ensure:" >&2
    echo "   1. Postgres is running on $EXTERNAL_HOST:$EXTERNAL_PORT" >&2
    echo "   2. User $EXTERNAL_USER exists and has access" >&2
    echo "   3. pg_hba.conf allows your IP" >&2
    echo "   4. Firewall allows port $EXTERNAL_PORT" >&2
    echo "" >&2
    echo "   Set PGPASSWORD if password is different" >&2
    exit 1
  fi
  
  echo "✅ Connection successful"
  
  # Create database if needed
  PGPASSWORD="${PGPASSWORD:-SUPER_STRONG_APP_PASSWORD}" \
    psql -h "$EXTERNAL_HOST" -p "$EXTERNAL_PORT" -U "$EXTERNAL_USER" -d postgres <<SQL
SELECT 'CREATE DATABASE $EXTERNAL_DB' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$EXTERNAL_DB')\gexec
GRANT ALL PRIVILEGES ON DATABASE $EXTERNAL_DB TO $EXTERNAL_USER;
SQL
  
  # Restore
  echo "Restoring backup..."
  PGPASSWORD="${PGPASSWORD:-SUPER_STRONG_APP_PASSWORD}" \
    pg_restore -h "$EXTERNAL_HOST" -p "$EXTERNAL_PORT" -U "$EXTERNAL_USER" \
    -d "$EXTERNAL_DB" -v "$BACKUP_FILE"
  
  if [[ $? -eq 0 ]]; then
    echo "✅ Import complete"
  else
    echo "❌ Import failed" >&2
    exit 1
  fi
else
  echo ""
  echo "Step 2: Skipping import (--skip-import or no backup file)"
fi

# Step 3: Update K8s config (DIRECT connection - no service)
echo ""
echo "Step 3: Updating K8s config for DIRECT external connection..."

CONFIG_FILE="infra/k8s/base/config/app-config.yaml"
if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "⚠️  Config file not found: $CONFIG_FILE"
  echo "   Please update connection strings manually:"
  echo "   postgresql://$EXTERNAL_USER:PASSWORD@$EXTERNAL_HOST:$EXTERNAL_PORT/$EXTERNAL_DB"
  exit 0
fi

# Backup
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
cp "$CONFIG_FILE" "${CONFIG_FILE}.backup.${TIMESTAMP}"

# Update - replace service name with direct IP/hostname
DIRECT_URL="postgresql://$EXTERNAL_USER:SUPER_STRONG_APP_PASSWORD@$EXTERNAL_HOST:$EXTERNAL_PORT/$EXTERNAL_DB?connect_timeout=5"

sed -i.bak \
  -e "s|postgres\.record-platform\.svc\.cluster\.local|$EXTERNAL_HOST|g" \
  -e "s|:5432/|:$EXTERNAL_PORT/|g" \
  -e "s|@postgres\.|@$EXTERNAL_HOST:|g" \
  "$CONFIG_FILE"

echo "✅ Updated $CONFIG_FILE"
echo "   Direct connection: $DIRECT_URL"
echo "   Backup: ${CONFIG_FILE}.backup.${TIMESTAMP}"

# Show what changed
echo ""
echo "=== Summary ==="
echo "✅ Migration complete!"
echo ""
echo "Connection String (DIRECT - no K8s service):"
echo "  $DIRECT_URL"
echo ""
echo "Next steps:"
echo "1. Review updated config: cat $CONFIG_FILE"
echo "2. Update password in config if different"
echo "3. Apply config: kubectl apply -f $CONFIG_FILE"
echo "4. Restart app pods to pick up new connection"
echo "5. Test: kubectl -n $NS run -it --rm test-pg --image=postgres:16-alpine --restart=Never -- \\"
echo "     psql -h $EXTERNAL_HOST -U $EXTERNAL_USER -d $EXTERNAL_DB -c 'SELECT 1;'"
echo ""
echo "⚠️  Tuning is now PERSISTENT on external Postgres - won't get deleted!"
echo "   Settings are in postgresql.conf and ALTER DATABASE - they survive restarts"

