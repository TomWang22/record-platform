#!/usr/bin/env bash
set -Eeuo pipefail

# Migrate PostgreSQL from Kubernetes to external host
# This script helps export data and update configuration

usage() {
  cat <<USAGE
Usage: ${0##*/} [options]
  --export-only          Only export data from K8s (don't update config)
  --external-host HOST   External Postgres hostname/IP
  --external-port PORT   External Postgres port (default: 5432)
  --external-user USER   External Postgres user (default: postgres)
  --external-db DB       External Postgres database (default: records)
  --namespace NS         Kubernetes namespace (default: record-platform)
  --backup-dir DIR       Directory for backups (default: ./backups)
  -h, --help             Show this help
USAGE
}

EXPORT_ONLY=false
EXTERNAL_HOST=""
EXTERNAL_PORT=5432
EXTERNAL_USER="postgres"
EXTERNAL_DB="records"
NS="record-platform"
BACKUP_DIR="./backups"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --export-only) EXPORT_ONLY=true; shift ;;
    --external-host) EXTERNAL_HOST="$2"; shift 2 ;;
    --external-port) EXTERNAL_PORT="$2"; shift 2 ;;
    --external-user) EXTERNAL_USER="$2"; shift 2 ;;
    --external-db) EXTERNAL_DB="$2"; shift 2 ;;
    --namespace) NS="$2"; shift 2 ;;
    --backup-dir) BACKUP_DIR="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

mkdir -p "$BACKUP_DIR"

echo "=== PostgreSQL Migration: K8s → External ==="
echo ""

# Step 1: Export from K8s
echo "Step 1: Exporting data from Kubernetes..."
POD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")

if [[ -z "$POD" ]]; then
  echo "❌ Postgres pod not found in namespace $NS" >&2
  exit 1
fi

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/records_migration_${TIMESTAMP}.dump"

echo "Pod: $POD"
echo "Creating backup: $BACKUP_FILE"

# Create backup in pod
kubectl -n "$NS" exec "$POD" -c db -- \
  env PGHOST=/var/run/postgresql PGUSER=postgres PGDATABASE=records \
  pg_dump -F c -f /tmp/migration_backup.dump

# Copy to local
kubectl -n "$NS" cp "$POD:/tmp/migration_backup.dump" "$BACKUP_FILE" -c db

# Clean up pod
kubectl -n "$NS" exec "$POD" -c db -- rm -f /tmp/migration_backup.dump

echo "✅ Backup created: $BACKUP_FILE"
echo "   Size: $(du -h "$BACKUP_FILE" | cut -f1)"

if [[ "$EXPORT_ONLY" == "true" ]]; then
  echo ""
  echo "✅ Export complete. To import:"
  echo "   pg_restore -h $EXTERNAL_HOST -U $EXTERNAL_USER -d $EXTERNAL_DB -v $BACKUP_FILE"
  exit 0
fi

# Step 2: Import to external
if [[ -z "$EXTERNAL_HOST" ]]; then
  echo "❌ --external-host required for import" >&2
  exit 1
fi

echo ""
echo "Step 2: Importing to external Postgres..."
echo "Host: $EXTERNAL_HOST:$EXTERNAL_PORT"
echo "Database: $EXTERNAL_DB"
echo "User: $EXTERNAL_USER"

read -p "Continue with import? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Import cancelled"
  exit 0
fi

# Test connection
if ! PGPASSWORD="${PGPASSWORD:-}" psql -h "$EXTERNAL_HOST" -p "$EXTERNAL_PORT" -U "$EXTERNAL_USER" -d postgres -c "SELECT 1;" >/dev/null 2>&1; then
  echo "❌ Cannot connect to external Postgres" >&2
  echo "   Please ensure:" >&2
  echo "   1. Postgres is running and accessible" >&2
  echo "   2. pg_hba.conf allows your IP" >&2
  echo "   3. Firewall allows port $EXTERNAL_PORT" >&2
  echo "   4. PGPASSWORD environment variable is set if needed" >&2
  exit 1
fi

echo "✅ Connection successful"

# Create database if needed
PGPASSWORD="${PGPASSWORD:-}" psql -h "$EXTERNAL_HOST" -p "$EXTERNAL_PORT" -U "$EXTERNAL_USER" -d postgres <<SQL
SELECT 1 FROM pg_database WHERE datname = '$EXTERNAL_DB'
\gexec

DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '$EXTERNAL_DB') THEN
    CREATE DATABASE $EXTERNAL_DB;
  END IF;
END \$\$;
SQL

# Restore
echo "Restoring backup..."
PGPASSWORD="${PGPASSWORD:-}" pg_restore -h "$EXTERNAL_HOST" -p "$EXTERNAL_PORT" -U "$EXTERNAL_USER" -d "$EXTERNAL_DB" -v "$BACKUP_FILE"

if [[ $? -eq 0 ]]; then
  echo "✅ Import complete"
else
  echo "❌ Import failed" >&2
  exit 1
fi

# Step 3: Update K8s config
echo ""
echo "Step 3: Updating Kubernetes configuration..."

CONFIG_FILE="infra/k8s/base/config/app-config.yaml"
if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "⚠️  Config file not found: $CONFIG_FILE"
  echo "   Please update connection strings manually:"
  echo "   DATABASE_URL: postgresql://record_app:PASSWORD@$EXTERNAL_HOST:$EXTERNAL_PORT/$EXTERNAL_DB"
else
  echo "Updating $CONFIG_FILE..."
  
  # Backup original
  cp "$CONFIG_FILE" "${CONFIG_FILE}.backup.${TIMESTAMP}"
  
  # Update connection strings (simple sed - adjust as needed)
  sed -i.bak \
    -e "s|postgres\.record-platform\.svc\.cluster\.local|$EXTERNAL_HOST|g" \
    -e "s|:5432|:$EXTERNAL_PORT|g" \
    "$CONFIG_FILE"
  
  echo "✅ Config updated (backup: ${CONFIG_FILE}.backup.${TIMESTAMP})"
  echo "   Please review and apply: kubectl apply -f $CONFIG_FILE"
fi

# Step 4: Update connection strings directly (no service abstraction)
echo ""
echo "Step 4: Updating connection strings to use DIRECT external connection..."
echo "   (No K8s service - direct connection for stability)"

CONFIG_FILE="infra/k8s/base/config/app-config.yaml"
if [[ -f "$CONFIG_FILE" ]]; then
  # Create direct connection string
  DIRECT_URL="postgresql://record_app:SUPER_STRONG_APP_PASSWORD@$EXTERNAL_HOST:$EXTERNAL_PORT/$EXTERNAL_DB?connect_timeout=5"
  
  # Update config
  sed -i.bak \
    -e "s|postgres\.record-platform\.svc\.cluster\.local|$EXTERNAL_HOST|g" \
    -e "s|:5432|:$EXTERNAL_PORT|g" \
    "$CONFIG_FILE"
  
  echo "✅ Updated $CONFIG_FILE"
  echo "   Connection: $DIRECT_URL"
  echo "   (Backup: ${CONFIG_FILE}.bak)"
fi

# Optional: Create ExternalName service for backward compatibility
echo ""
read -p "Create ExternalName service for backward compatibility? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  SERVICE_FILE="infra/k8s/base/postgres/svc-external.yaml"
  cat > "$SERVICE_FILE" <<YAML
apiVersion: v1
kind: Service
metadata:
  name: postgres
  namespace: $NS
spec:
  type: ExternalName
  externalName: $EXTERNAL_HOST
  ports:
  - port: $EXTERNAL_PORT
    targetPort: $EXTERNAL_PORT
    protocol: TCP
    name: pg
YAML
  echo "✅ Created $SERVICE_FILE (optional - for service name compatibility)"
  echo "   Note: Direct IP connection is more stable"
fi

echo ""
echo "=== Migration Complete ==="
echo ""
echo "Next steps:"
echo "1. Review updated configuration"
echo "2. Test connection from a pod:"
echo "   kubectl -n $NS run -it --rm test-pg --image=postgres:16-alpine --restart=Never -- \\"
echo "     psql -h $EXTERNAL_HOST -U record_app -d $EXTERNAL_DB -c 'SELECT 1;'"
echo "3. Apply updated config: kubectl apply -f infra/k8s/base/config/app-config.yaml"
echo "4. Restart application pods to pick up new connection strings"
echo "5. Monitor performance and verify everything works"
echo "6. Once stable, scale down K8s Postgres (keep for rollback):"
echo "   kubectl -n $NS scale deployment postgres --replicas=0"

