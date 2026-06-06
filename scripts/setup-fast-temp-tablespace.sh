#!/usr/bin/env bash
# Setup fast temp tablespace on tmpfs for PostgreSQL benchmarks
# This reduces p999 spikes by using RAM instead of disk for temp files
set -Euo pipefail

# Connection settings (can be overridden via env)
RECORDS_DB_HOST="${RECORDS_DB_HOST:-localhost}"
RECORDS_DB_PORT="${RECORDS_DB_PORT:-5433}"
RECORDS_DB_USER="${RECORDS_DB_USER:-postgres}"
RECORDS_DB_NAME="${RECORDS_DB_NAME:-records}"
RECORDS_DB_PASS="${RECORDS_DB_PASS:-postgres}"

# Tablespace name
TABLESPACE_NAME="${TABLESPACE_NAME:-fasttmp}"
# Size limit (default: 2GB, adjust based on available RAM)
TABLESPACE_SIZE="${TABLESPACE_SIZE:-2GB}"

psql_cmd() {
  PGPASSWORD="$RECORDS_DB_PASS" psql \
    -h "$RECORDS_DB_HOST" -p "$RECORDS_DB_PORT" \
    -U "$RECORDS_DB_USER" -d "$RECORDS_DB_NAME" \
    -X -P pager=off "$@"
}

echo "=== Setting up fast temp tablespace: $TABLESPACE_NAME ==="

# Check if running in Docker
if command -v docker >/dev/null 2>&1; then
  PG_CONTAINER=$(docker ps --filter "name=postgres" --filter "publish=$RECORDS_DB_PORT" --format "{{.Names}}" | head -1)
  if [[ -n "$PG_CONTAINER" ]]; then
    echo "Found PostgreSQL container: $PG_CONTAINER"
    
    # Check if tmpfs is available in container
    if docker exec "$PG_CONTAINER" test -d /dev/shm 2>/dev/null; then
      TMPFS_DIR="/dev/shm/fasttmp"
      echo "Using /dev/shm for tmpfs (shared memory)"
    else
      # Try to use a tmpfs mount
      TMPFS_DIR="/tmp/fasttmp"
      echo "Using /tmp for temp tablespace (may be slower than tmpfs)"
    fi
    
    # Create directory in container
    docker exec "$PG_CONTAINER" mkdir -p "$TMPFS_DIR" 2>/dev/null || {
      echo "⚠️  WARNING: Could not create $TMPFS_DIR in container" >&2
      echo "   Temp tablespace may not work optimally" >&2
      TMPFS_DIR="/tmp/fasttmp"
    }
    
    # Set permissions
    docker exec "$PG_CONTAINER" chmod 700 "$TMPFS_DIR" 2>/dev/null || true
    docker exec "$PG_CONTAINER" chown postgres:postgres "$TMPFS_DIR" 2>/dev/null || true
    
    echo "Created directory in container: $TMPFS_DIR"
  else
    echo "⚠️  WARNING: PostgreSQL container not found. Assuming local PostgreSQL." >&2
    TMPFS_DIR="/tmp/fasttmp"
    mkdir -p "$TMPFS_DIR" 2>/dev/null || true
  fi
else
  # Local PostgreSQL - use /dev/shm if available, else /tmp
  if [[ -d /dev/shm ]] && [[ -w /dev/shm ]]; then
    TMPFS_DIR="/dev/shm/fasttmp"
    echo "Using /dev/shm for tmpfs (shared memory)"
    mkdir -p "$TMPFS_DIR" 2>/dev/null || true
  else
    TMPFS_DIR="/tmp/fasttmp"
    echo "Using /tmp for temp tablespace (may be slower than tmpfs)"
    mkdir -p "$TMPFS_DIR" 2>/dev/null || true
  fi
fi

# Create tablespace in PostgreSQL
echo "Creating tablespace in PostgreSQL..."
psql_cmd <<SQL
-- Drop existing tablespace if it exists (optional, comment out if you want to keep it)
-- DROP TABLESPACE IF EXISTS $TABLESPACE_NAME;

-- Create tablespace on tmpfs
CREATE TABLESPACE $TABLESPACE_NAME
  LOCATION '$TMPFS_DIR';

-- Verify tablespace was created
SELECT 
  spcname AS tablespace_name,
  pg_tablespace_location(oid) AS location,
  pg_size_pretty(pg_tablespace_size(spcname)) AS size
FROM pg_tablespace
WHERE spcname = '$TABLESPACE_NAME';
SQL

if [[ $? -eq 0 ]]; then
  echo ""
  echo "✅ Fast temp tablespace '$TABLESPACE_NAME' created successfully!"
  echo ""
  echo "To use it in benchmarks, set:"
  echo "  export FAST_TEMP_TABLESPACE=$TABLESPACE_NAME"
  echo ""
  echo "Or run benchmarks with:"
  echo "  FAST_TEMP_TABLESPACE=$TABLESPACE_NAME ./scripts/run_pgbench_sweep.sh"
  echo ""
  echo "Note: This tablespace uses RAM (tmpfs), so it's fast but limited by available memory."
  echo "      Monitor memory usage during benchmarks to avoid OOM."
else
  echo "❌ Failed to create tablespace!" >&2
  exit 1
fi

