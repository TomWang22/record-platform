#!/usr/bin/env bash
# Setup script for auction-monitor database
# Port: 5438

set -euo pipefail

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5438}"
PGUSER="${PGUSER:-postgres}"
PGPASSWORD="${PGPASSWORD:-postgres}"
PGDATABASE="${PGDATABASE:-postgres}"

export PGPASSWORD

echo "🔧 Setting up auction-monitor database on port $PGPORT..."

# Wait for database to be ready
echo "⏳ Waiting for database to be ready..."
until psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -c "SELECT 1;" >/dev/null 2>&1; do
    echo "  Database not ready, waiting..."
    sleep 2
done

echo "✅ Database is ready"

# Create database if it doesn't exist
echo "📦 Creating database 'auction_monitor' if it doesn't exist..."
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" <<EOF
SELECT 'CREATE DATABASE auction_monitor'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'auction_monitor')\gexec
EOF

# Run schema
echo "📋 Applying schema..."
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d auction_monitor -f infra/db/07-auction-monitor-schema.sql

echo "✅ Auction-monitor database setup complete!"
echo ""
echo "Connection string:"
echo "  postgresql://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/auction_monitor"

