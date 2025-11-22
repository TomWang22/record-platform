#!/usr/bin/env bash
set -Eeuo pipefail

# Simple setup for Postgres outside K8s - direct connection, persistent tuning
# Run this on the server/VM where Postgres will live

if [[ $EUID -ne 0 ]]; then
   echo "This script must be run as root (use sudo)" >&2
   exit 1
fi

echo "=== Setting up PostgreSQL 16 (External, Direct Connection) ==="
echo "This setup ensures tuning PERSISTS and won't get deleted"
echo ""

# Install Postgres 16
if command -v apt-get >/dev/null 2>&1; then
  echo "Installing PostgreSQL 16 (Ubuntu/Debian)..."
  apt-get update
  apt-get install -y wget ca-certificates lsb-release
  wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | apt-key add -
  echo "deb http://apt.postgresql.org/pub/repos/apt/ $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list
  apt-get update
  apt-get install -y postgresql-16 postgresql-contrib-16
elif command -v dnf >/dev/null 2>&1; then
  echo "Installing PostgreSQL 16 (RHEL/CentOS/Fedora)..."
  dnf install -y postgresql16-server postgresql16
  /usr/pgsql-16/bin/postgresql-16-setup initdb
  systemctl enable postgresql-16
  systemctl start postgresql-16
else
  echo "Unsupported package manager. Please install PostgreSQL 16 manually." >&2
  exit 1
fi

# Find Postgres paths
PG_VERSION=$(psql --version 2>/dev/null | awk '{print $3}' | cut -d. -f1 || echo "16")
if [[ -d "/etc/postgresql/$PG_VERSION/main" ]]; then
  PG_CONF="/etc/postgresql/$PG_VERSION/main/postgresql.conf"
  PG_HBA="/etc/postgresql/$PG_VERSION/main/pg_hba.conf"
  PG_DATA="/var/lib/postgresql/$PG_VERSION/main"
elif [[ -d "/var/lib/pgsql/$PG_VERSION/data" ]]; then
  PG_CONF="/var/lib/pgsql/$PG_VERSION/data/postgresql.conf"
  PG_HBA="/var/lib/pgsql/$PG_VERSION/data/pg_hba.conf"
  PG_DATA="/var/lib/pgsql/$PG_VERSION/data"
else
  echo "Cannot find Postgres config directory" >&2
  exit 1
fi

echo "PostgreSQL version: $PG_VERSION"
echo "Config: $PG_CONF"
echo "Data: $PG_DATA"

# Create database and user
echo ""
echo "Creating database and users..."
sudo -u postgres psql <<'SQL'
-- Create database
SELECT 'CREATE DATABASE records' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'records')\gexec

-- Create app user
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_user WHERE usename = 'record_app') THEN
    CREATE USER record_app WITH PASSWORD 'SUPER_STRONG_APP_PASSWORD';
  END IF;
END $$;

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE records TO record_app;
ALTER DATABASE records OWNER TO record_app;

-- Create extensions
\c records
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS pg_prewarm;
SQL

# Backup original config
BACKUP_SUFFIX=$(date +%Y%m%d_%H%M%S)
cp "$PG_CONF" "${PG_CONF}.backup.${BACKUP_SUFFIX}"
cp "$PG_HBA" "${PG_HBA}.backup.${BACKUP_SUFFIX}"

# Apply PERSISTENT tuning (in postgresql.conf - survives restarts)
echo ""
echo "Applying PERSISTENT performance tuning (28k TPS target)..."
cat >> "$PG_CONF" <<'CONF'

# ============================================
# PERSISTENT Performance Tuning (28k TPS)
# Applied: $(date)
# These settings survive restarts and pod changes
# ============================================

# Memory (aggressive)
shared_buffers = 2GB
effective_cache_size = 8GB
work_mem = 256MB
maintenance_work_mem = 512MB

# WAL
wal_level = replica
max_wal_size = 2GB
min_wal_size = 80MB
wal_buffers = 16MB

# Connections
max_connections = 200

# Query Planner (aggressive tuning)
random_page_cost = 1.0
cpu_index_tuple_cost = 0.0005
cpu_tuple_cost = 0.01
effective_io_concurrency = 200

# Parallelism
max_worker_processes = 16
max_parallel_workers = 16
max_parallel_workers_per_gather = 4

# JIT (disable for this workload)
jit = off

# Extensions (preload)
shared_preload_libraries = 'pg_stat_statements,pg_trgm'

# Autovacuum (aggressive)
autovacuum_naptime = 10s
autovacuum_vacuum_scale_factor = 0.05
autovacuum_analyze_scale_factor = 0.02

# Checkpoints
checkpoint_completion_target = 0.9
checkpoint_timeout = 15min

# I/O tracking
track_io_timing = on

# Network (allow remote connections)
listen_addresses = '*'
port = 5432

# Logging (optional - uncomment for debugging)
# log_statement = 'all'
# log_duration = on
# log_min_duration_statement = 1000
CONF

# Configure remote access
echo "Configuring remote access..."
cat >> "$PG_HBA" <<'HBA'

# ============================================
# Remote Access Configuration
# Allow connections from Kubernetes cluster
# ============================================
# Adjust IP ranges to match your network
host    all             all             10.0.0.0/8              md5
host    all             all             172.16.0.0/12           md5
host    all             all             192.168.0.0/16          md5
# For localhost (development)
host    all             all             127.0.0.1/32            md5
HBA

# Set up firewall
if command -v ufw >/dev/null 2>&1; then
  echo ""
  read -p "Configure UFW to allow Postgres (port 5432)? (y/N) " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    ufw allow 5432/tcp comment 'PostgreSQL'
    echo "✅ UFW rule added"
  fi
fi

# Restart Postgres
echo ""
echo "Restarting PostgreSQL..."
systemctl restart postgresql
systemctl enable postgresql

# Wait for startup
sleep 3

# Verify
if sudo -u postgres psql -c "SELECT version();" >/dev/null 2>&1; then
  echo "✅ PostgreSQL is running"
else
  echo "❌ PostgreSQL failed to start. Check logs: journalctl -u postgresql" >&2
  exit 1
fi

# Apply database-level settings (also persistent)
echo ""
echo "Applying database-level settings (persistent)..."
sudo -u postgres psql -d records <<'SQL'
-- Database-level settings (survive restarts)
ALTER DATABASE records SET random_page_cost = 1.0;
ALTER DATABASE records SET cpu_index_tuple_cost = 0.0005;
ALTER DATABASE records SET cpu_tuple_cost = 0.01;
ALTER DATABASE records SET effective_cache_size = '8GB';
ALTER DATABASE records SET work_mem = '256MB';
ALTER DATABASE records SET track_io_timing = on;
ALTER DATABASE records SET max_parallel_workers = 16;
ALTER DATABASE records SET max_parallel_workers_per_gather = 4;
ALTER DATABASE records SET search_path = 'records, public';
SQL

# Get server IP
SERVER_IP=$(hostname -I | awk '{print $1}')

echo ""
echo "=== Setup Complete ==="
echo ""
echo "✅ PostgreSQL is configured with PERSISTENT tuning"
echo "✅ Settings will survive restarts and pod changes"
echo ""
echo "Connection Information:"
echo "  Host: $SERVER_IP"
echo "  Port: 5432"
echo "  Database: records"
echo "  User: record_app"
echo "  Password: SUPER_STRONG_APP_PASSWORD"
echo ""
echo "Direct Connection String:"
echo "  postgresql://record_app:SUPER_STRONG_APP_PASSWORD@$SERVER_IP:5432/records"
echo ""
echo "⚠️  IMPORTANT: Change the password!"
echo "   sudo -u postgres psql -c \"ALTER USER record_app WITH PASSWORD 'YOUR_SECURE_PASSWORD';\""
echo ""
echo "Next steps:"
echo "1. Change the password (see above)"
echo "2. Export data from K8s: ./scripts/migrate-postgres-outside-k8s.sh --export-only"
echo "3. Import to this server: pg_restore -h $SERVER_IP -U record_app -d records -v <backup.dump>"
echo "4. Update K8s config to use: postgresql://record_app:PASSWORD@$SERVER_IP:5432/records"

