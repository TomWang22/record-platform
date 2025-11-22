#!/usr/bin/env bash
set -euo pipefail

# Comprehensive setup script for social database
# Mirrors the main database setup process (2.4M row reference setup)

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

: "${SOCIAL_DB_HOST:=localhost}"
: "${SOCIAL_DB_PORT:=5434}"
: "${SOCIAL_DB_NAME:=records}"
: "${SOCIAL_DB_USER:=postgres}"
: "${SOCIAL_DB_PASSWORD:=postgres}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }

say "=== Comprehensive Social Database Setup ==="
echo "Postgres: ${SOCIAL_DB_HOST}:${SOCIAL_DB_PORT}"
echo "Database: ${SOCIAL_DB_NAME}"

# Step 1: Create database if needed
say "Step 1: Creating database (if needed)..."
PGPASSWORD="$SOCIAL_DB_PASSWORD" psql -h "$SOCIAL_DB_HOST" -p "$SOCIAL_DB_PORT" -U "$SOCIAL_DB_USER" -d postgres -tc "
  SELECT 1 FROM pg_database WHERE datname = '$SOCIAL_DB_NAME'
" | grep -q 1 || \
  PGPASSWORD="$SOCIAL_DB_PASSWORD" psql -h "$SOCIAL_DB_HOST" -p "$SOCIAL_DB_PORT" -U "$SOCIAL_DB_USER" -d postgres -c "
    CREATE DATABASE $SOCIAL_DB_NAME;
  "
ok "Database ready"

# Step 2: Apply schema migration
say "Step 2: Applying schema migration..."
PGPASSWORD="$SOCIAL_DB_PASSWORD" psql \
  -h "$SOCIAL_DB_HOST" -p "$SOCIAL_DB_PORT" \
  -U "$SOCIAL_DB_USER" -d "$SOCIAL_DB_NAME" \
  -f "$ROOT/infra/db/04-social-schema.sql"
ok "Schema applied"

# Step 3: Apply performance optimizations
say "Step 3: Applying performance optimizations..."
"$ROOT/scripts/optimize-social-db-for-performance.sh"
ok "Optimizations applied"

# Step 4: Verify setup
say "Step 4: Verifying setup..."
PGPASSWORD="$SOCIAL_DB_PASSWORD" psql \
  -h "$SOCIAL_DB_HOST" -p "$SOCIAL_DB_PORT" \
  -U "$SOCIAL_DB_USER" -d "$SOCIAL_DB_NAME" \
  -c "
    SELECT schemaname, tablename, 
           pg_size_pretty(pg_total_relation_size((schemaname||'.'||tablename)::regclass)) AS size
    FROM pg_tables 
    WHERE schemaname IN ('forum', 'messages')
    ORDER BY schemaname, tablename;
  "

say "✅ Social database setup complete!"
say ""
say "Database is ready for use with:"
say "  - Forum posts, comments, votes"
say "  - Messaging (direct + groups)"
say "  - File attachments support"
say "  - Read receipts (iOS Messages style)"
say "  - Performance optimized for high TPS"

