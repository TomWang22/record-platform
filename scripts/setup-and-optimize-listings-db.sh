#!/usr/bin/env bash
set -euo pipefail

# Comprehensive setup script for listings database
# Mirrors the main database setup process (2.4M row reference setup)

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

: "${LISTINGS_DB_HOST:=localhost}"
: "${LISTINGS_DB_PORT:=5435}"
: "${LISTINGS_DB_NAME:=records}"
: "${LISTINGS_DB_USER:=postgres}"
: "${LISTINGS_DB_PASSWORD:=postgres}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }

say "=== Comprehensive Listings Database Setup ==="
echo "Postgres: ${LISTINGS_DB_HOST}:${LISTINGS_DB_PORT}"
echo "Database: ${LISTINGS_DB_NAME}"

# Step 1: Create database if needed
say "Step 1: Creating database (if needed)..."
PGPASSWORD="$LISTINGS_DB_PASSWORD" psql -h "$LISTINGS_DB_HOST" -p "$LISTINGS_DB_PORT" -U "$LISTINGS_DB_USER" -d postgres -tc "
  SELECT 1 FROM pg_database WHERE datname = '$LISTINGS_DB_NAME'
" | grep -q 1 || \
  PGPASSWORD="$LISTINGS_DB_PASSWORD" psql -h "$LISTINGS_DB_HOST" -p "$LISTINGS_DB_PORT" -U "$LISTINGS_DB_USER" -d postgres -c "
    CREATE DATABASE $LISTINGS_DB_NAME;
  "
ok "Database ready"

# Step 2: Apply schema migration
say "Step 2: Applying schema migration..."
PGPASSWORD="$LISTINGS_DB_PASSWORD" psql \
  -h "$LISTINGS_DB_HOST" -p "$LISTINGS_DB_PORT" \
  -U "$LISTINGS_DB_USER" -d "$LISTINGS_DB_NAME" \
  -f "$ROOT/infra/db/05-listings-schema.sql"
ok "Schema applied"

# Step 3: Apply performance optimizations
say "Step 3: Applying performance optimizations..."
"$ROOT/scripts/optimize-listings-db-for-performance.sh"
ok "Optimizations applied"

# Step 4: Verify setup
say "Step 4: Verifying setup..."
PGPASSWORD="$LISTINGS_DB_PASSWORD" psql \
  -h "$LISTINGS_DB_HOST" -p "$LISTINGS_DB_PORT" \
  -U "$LISTINGS_DB_USER" -d "$LISTINGS_DB_NAME" \
  -c "
    SELECT schemaname, tablename,
           pg_size_pretty(pg_total_relation_size((schemaname||'.'||tablename)::regclass)) AS size
    FROM pg_tables 
    WHERE schemaname = 'listings'
    ORDER BY tablename;
  "

say "✅ Listings database setup complete!"
say ""
say "Database is ready for use with:"
say "  - eBay-style listings (fixed_price, auction, OBO, best_offer)"
say "  - Auction bidding system"
say "  - Image uploads"
say "  - Watchlist functionality"
say "  - Performance optimized for high TPS"

