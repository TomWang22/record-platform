#!/usr/bin/env bash
# Setup script for python-ai database
# Port: 5440

set -euo pipefail

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5440}"
PGUSER="${PGUSER:-postgres}"
PGPASSWORD="${PGPASSWORD:-postgres}"
PGDATABASE="${PGDATABASE:-postgres}"

export PGPASSWORD

echo "🔧 Setting up python-ai database on port $PGPORT..."

# Wait for database to be ready
echo "⏳ Waiting for database to be ready..."
until psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -c "SELECT 1;" >/dev/null 2>&1; do
    echo "  Database not ready, waiting..."
    sleep 2
done

echo "✅ Database is ready"

# Create database if it doesn't exist
echo "📦 Creating database 'python_ai' if it doesn't exist..."
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" <<EOF
SELECT 'CREATE DATABASE python_ai'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'python_ai')\gexec
EOF

# Run schema
echo "📋 Applying schema..."
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d python_ai -f infra/db/09-python-ai-schema.sql

echo "✅ Python AI database setup complete!"
echo ""
echo "Connection string:"
echo "  postgresql://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/python_ai"
echo ""
echo "Note: Python AI service can work with Redis only for caching. This database is optional."
echo "      Enable pgvector extension for vector embeddings: CREATE EXTENSION vector;"

