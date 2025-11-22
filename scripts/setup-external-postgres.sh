#!/usr/bin/env bash
set -Eeuo pipefail

# Setup script for Postgres on external server/VM
# Run this on the server where you want Postgres to run

if [[ $EUID -ne 0 ]]; then
   echo "This script must be run as root (use sudo)" >&2
   exit 1
fi

echo "=== Setting up PostgreSQL 16 for External Deployment ==="

# Detect OS
if [[ -f /etc/os-release ]]; then
  . /etc/os-release
  OS=$ID
else
  echo "Cannot detect OS" >&2
  exit 1
fi

# Install Postgres
if [[ "$OS" == "ubuntu" ]] || [[ "$OS" == "debian" ]]; then
  echo "Installing PostgreSQL 16..."
  apt-get update
  apt-get install -y wget ca-certificates
  wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | apt-key add -
  echo "deb http://apt.postgresql.org/pub/repos/apt/ $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list
  apt-get update
  apt-get install -y postgresql-16 postgresql-contrib-16
elif [[ "$OS" == "rhel" ]] || [[ "$OS" == "centos" ]] || [[ "$OS" == "fedora" ]]; then
  echo "Installing PostgreSQL 16..."
  dnf install -y postgresql16-server postgresql16
  /usr/pgsql-16/bin/postgresql-16-setup initdb
  systemctl enable postgresql-16
  systemctl start postgresql-16
else
  echo "Unsupported OS: $OS" >&2
  exit 1
fi

# Get Postgres version path
if command -v psql >/dev/null 2>&1; then
  PG_VERSION=$(psql --version | awk '{print $3}' | cut -d. -f1)
  PG_BIN="/usr/lib/postgresql/$PG_VERSION/bin"
  PG_CONF="/etc/postgresql/$PG_VERSION/main"
  PG_DATA="/var/lib/postgresql/$PG_VERSION/main"
else
  echo "PostgreSQL installation failed" >&2
  exit 1
fi

echo "PostgreSQL version: $PG_VERSION"
echo "Config directory: $PG_CONF"
echo "Data directory: $PG_DATA"

# Create database and user
echo ""
echo "Setting up database and users..."
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

-- Create extensions in records database
\c records
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS pg_prewarm;
SQL

# Configure postgresql.conf
echo ""
echo "Configuring postgresql.conf for performance..."
PG_CONF_FILE="$PG_CONF/postgresql.conf"

# Backup original
cp "$PG_CONF_FILE" "${PG_CONF_FILE}.backup.$(date +%Y%m%d_%H%M%S)"

# Apply performance settings
cat >> "$PG_CONF_FILE" <<'CONF'

# ============================================
# Performance Tuning (28k TPS target)
# ============================================

# Memory
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

# Performance (aggressive tuning)
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

# Extensions
shared_preload_libraries = 'pg_stat_statements,pg_trgm'

# Autovacuum (aggressive)
autovacuum_naptime = 10s
autovacuum_vacuum_scale_factor = 0.05
autovacuum_analyze_scale_factor = 0.02

# Checkpoints
checkpoint_completion_target = 0.9
checkpoint_timeout = 15min

# I/O
track_io_timing = on

# Network
listen_addresses = '*'
port = 5432

# Logging (optional, for debugging)
# log_statement = 'all'
# log_duration = on
CONF

# Configure pg_hba.conf for remote access
echo ""
echo "Configuring pg_hba.conf for remote access..."
PG_HBA_FILE="$PG_CONF/pg_hba.conf"

# Backup
cp "$PG_HBA_FILE" "${PG_HBA_FILE}.backup.$(date +%Y%m%d_%H%M%S)"

# Add remote access (adjust IP ranges for your network)
cat >> "$PG_HBA_FILE" <<'HBA'

# Remote access from Kubernetes cluster
# Adjust IP ranges to match your cluster
host    all             all             10.0.0.0/8              md5
host    all             all             172.16.0.0/12           md5
host    all             all             192.168.0.0/16          md5
HBA

# Set up firewall (if ufw is installed)
if command -v ufw >/dev/null 2>&1; then
  echo ""
  read -p "Configure UFW firewall to allow Postgres? (y/N) " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    ufw allow 5432/tcp
    echo "✅ UFW rule added"
  fi
fi

# Restart Postgres
echo ""
echo "Restarting PostgreSQL..."
systemctl restart postgresql
systemctl enable postgresql

# Verify
echo ""
echo "Verifying installation..."
sleep 2
if sudo -u postgres psql -c "SELECT version();" >/dev/null 2>&1; then
  echo "✅ PostgreSQL is running"
else
  echo "❌ PostgreSQL failed to start" >&2
  exit 1
fi

# Show connection info
echo ""
echo "=== Setup Complete ==="
echo ""
echo "PostgreSQL is ready!"
echo ""
echo "Connection info:"
echo "  Host: $(hostname -I | awk '{print $1}')"
echo "  Port: 5432"
echo "  Database: records"
echo "  User: record_app"
echo "  Password: SUPER_STRONG_APP_PASSWORD"
echo ""
echo "Connection string:"
echo "  postgresql://record_app:SUPER_STRONG_APP_PASSWORD@$(hostname -I | awk '{print $1}'):5432/records"
echo ""
echo "Next steps:"
echo "1. Update password: sudo -u postgres psql -c \"ALTER USER record_app WITH PASSWORD 'YOUR_SECURE_PASSWORD';\""
echo "2. Import your database backup"
echo "3. Update K8s connection strings"
echo "4. Test connection from cluster"

