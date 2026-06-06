#!/usr/bin/env bash
set -euo pipefail

# Optimize social-service database with performance indexes
# This script adds missing indexes to improve query performance

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

# Get database connection string
POSTGRES_URL="${POSTGRES_URL_SOCIAL:-postgresql://postgres:postgres@postgres-social-external.record-platform.svc.cluster.local:5432/records}"

say "=== Optimizing Social-Service Database ==="

# Check if we're in Kubernetes or local
if command -v kubectl >/dev/null 2>&1 && kubectl cluster-info >/dev/null 2>&1; then
  say "Running inside Kubernetes cluster"
  
  # Use kubectl exec to run psql in postgres container
  POSTGRES_CONTAINER="record-platform-postgres-social-1"
  if ! docker ps | grep -q "$POSTGRES_CONTAINER"; then
    fail "PostgreSQL container $POSTGRES_CONTAINER not found"
  fi
  
  ok "Found PostgreSQL container: $POSTGRES_CONTAINER"
  
  say "Applying performance indexes..."
  if docker exec "$POSTGRES_CONTAINER" psql -U postgres -d records -f /dev/stdin < services/social-service/migrations/add-performance-indexes.sql; then
    ok "Performance indexes applied successfully"
  else
    fail "Failed to apply performance indexes"
  fi
  
else
  say "Running locally (outside Kubernetes)"
  
  # Try to use psql directly
  if ! command -v psql >/dev/null 2>&1; then
    fail "psql not found. Install PostgreSQL client or run from Kubernetes environment"
  fi
  
  say "Applying performance indexes..."
  if psql "$POSTGRES_URL" -f services/social-service/migrations/add-performance-indexes.sql; then
    ok "Performance indexes applied successfully"
  else
    fail "Failed to apply performance indexes"
  fi
fi

say "=== Database Optimization Complete ==="

