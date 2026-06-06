#!/usr/bin/env bash
# Force optimize k3s database by stopping k3s, optimizing, and restarting
# This is more aggressive than the regular optimization script

set -euo pipefail

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; }

say "=== Force Optimizing k3s Database ==="
warn "This will cause brief downtime (~30-60 seconds)"

# Find database file
DB_PATH=$(colima ssh -- sh -c "find /var/lib/rancher/k3s -name '*.db' -type f 2>/dev/null | head -1" 2>/dev/null || echo "")

if [[ -z "$DB_PATH" ]]; then
  fail "Could not find k3s database file"
  say "k3s may be using PostgreSQL/MySQL backend"
  exit 1
fi

ok "Found database: $DB_PATH"

# Check database size
DB_SIZE=$(colima ssh -- sh -c "du -sh $DB_PATH 2>/dev/null | cut -f1" 2>/dev/null || echo "unknown")
say "Database size: $DB_SIZE"

# Stop k3s
say "Stopping k3s..."
colima kubernetes stop
sleep 5

# Wait for k3s to fully stop
say "Waiting for k3s to fully stop..."
for i in {1..10}; do
  if ! colima ssh -- sh -c "pgrep -f 'k3s server' >/dev/null 2>&1"; then
    ok "k3s stopped"
    break
  fi
  sleep 1
done

# Optimize database
say "Optimizing database..."
colima ssh -- sh -c "
sqlite3 $DB_PATH <<'EOFSQL'
-- Show current state
SELECT 'Before optimization:';
SELECT COUNT(*) as total_rows FROM kine;
SELECT name, COUNT(*) as count FROM kine GROUP BY name ORDER BY count DESC LIMIT 5;

-- Analyze for better query planning
ANALYZE;

-- Vacuum to reclaim space and optimize
VACUUM;

-- Reindex for better performance  
REINDEX;

-- Show after state
SELECT 'After optimization:';
SELECT COUNT(*) as total_rows FROM kine;
EOFSQL
" 2>&1

if [[ $? -eq 0 ]]; then
  ok "Database optimization completed"
else
  warn "Database optimization completed with warnings"
fi

# Start k3s
say "Starting k3s..."
colima kubernetes start
sleep 10

# Monitor restart
say "Monitoring k3s restart..."
for i in {1..12}; do
  if kubectl cluster-info >/dev/null 2>&1; then
    ok "k3s API server is accessible!"
    kubectl cluster-info | head -3
    exit 0
  fi
  echo "  Waiting... ($i/12)"
  sleep 5
done

warn "k3s API server did not become accessible"
say "Check logs: colima ssh -- journalctl -u k3s -n 50"
exit 1
