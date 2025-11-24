#!/usr/bin/env bash
set -euo pipefail

# Comprehensive setup script for shopping database
# Mirrors the main database setup process (2.4M row reference setup)

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

: "${SHOPPING_DB_HOST:=localhost}"
: "${SHOPPING_DB_PORT:=5436}"
: "${SHOPPING_DB_NAME:=records}"
: "${SHOPPING_DB_USER:=postgres}"
: "${SHOPPING_DB_PASSWORD:=postgres}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }

say "=== Comprehensive Shopping Database Setup ==="
echo "Postgres: ${SHOPPING_DB_HOST}:${SHOPPING_DB_PORT}"
echo "Database: ${SHOPPING_DB_NAME}"

# Step 1: Create database if needed
say "Step 1: Creating database (if needed)..."
PGPASSWORD="$SHOPPING_DB_PASSWORD" psql -h "$SHOPPING_DB_HOST" -p "$SHOPPING_DB_PORT" -U "$SHOPPING_DB_USER" -d postgres -tc "
  SELECT 1 FROM pg_database WHERE datname = '$SHOPPING_DB_NAME'
" | grep -q 1 || \
  PGPASSWORD="$SHOPPING_DB_PASSWORD" psql -h "$SHOPPING_DB_HOST" -p "$SHOPPING_DB_PORT" -U "$SHOPPING_DB_USER" -d postgres -c "
    CREATE DATABASE $SHOPPING_DB_NAME;
  "
ok "Database ready"

# Step 2: Apply schema migration
say "Step 2: Applying schema migration..."
PGPASSWORD="$SHOPPING_DB_PASSWORD" psql \
  -h "$SHOPPING_DB_HOST" -p "$SHOPPING_DB_PORT" \
  -U "$SHOPPING_DB_USER" -d "$SHOPPING_DB_NAME" \
  -f "$ROOT/infra/db/06-shopping-schema.sql"
ok "Schema applied"

# Step 3: Apply performance optimizations
say "Step 3: Applying performance optimizations..."
"$ROOT/scripts/optimize-shopping-db-for-performance.sh"
ok "Optimizations applied"

# Step 4: Verify setup
say "Step 4: Verifying setup..."
PGPASSWORD="$SHOPPING_DB_PASSWORD" psql \
  -h "$SHOPPING_DB_HOST" -p "$SHOPPING_DB_PORT" \
  -U "$SHOPPING_DB_USER" -d "$SHOPPING_DB_NAME" \
  -c "
    SELECT schemaname, tablename,
           pg_size_pretty(pg_total_relation_size((schemaname||'.'||tablename)::regclass)) AS size
    FROM pg_tables 
    WHERE schemaname = 'shopping'
    ORDER BY tablename;
  "

say "✅ Shopping database setup complete!"
say ""
say "Database is ready for use with:"
say "  - Shopping cart (add, remove, update, clear)"
say "  - Watchlist (price alerts, availability)"
say "  - Recently viewed (LRU cache)"
say "  - Wishlist (priority-based)"
say "  - Purchase history"
say "  - Search history & trending searches"
say "  - LFU/LRU cache management"
say "  - Performance optimized for high TPS"

