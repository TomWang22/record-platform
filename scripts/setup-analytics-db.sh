#!/usr/bin/env bash
# Setup script for analytics database
# Port: 5439

set -euo pipefail

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5439}"
PGUSER="${PGUSER:-postgres}"
PGPASSWORD="${PGPASSWORD:-postgres}"
PGDATABASE="${PGDATABASE:-postgres}"

export PGPASSWORD

echo "🔧 Setting up analytics database on port $PGPORT..."

# Wait for database to be ready
echo "⏳ Waiting for database to be ready..."
until psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -c "SELECT 1;" >/dev/null 2>&1; do
    echo "  Database not ready, waiting..."
    sleep 2
done

echo "✅ Database is ready"

# Create database if it doesn't exist
echo "📦 Creating database 'analytics' if it doesn't exist..."
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" <<EOF
SELECT 'CREATE DATABASE analytics'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'analytics')\gexec
EOF

# Run schema
echo "📋 Applying schema..."
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d analytics -f infra/db/08-analytics-schema.sql

echo "✅ Analytics database setup complete!"
echo ""
echo "Connection string:"
echo "  postgresql://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/analytics"
echo ""
echo "Note: Analytics service can work with Redis/Kafka only. This database is optional."

