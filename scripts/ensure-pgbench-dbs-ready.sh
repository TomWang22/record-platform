#!/usr/bin/env bash
# Ensure the 8 Postgres instances (ports 5433–5440) are up so pgbench can run.
# If Docker is available, starts postgres* services via docker compose and waits for readiness.
# Use before run-daily-pgbench-standalone-with-results.sh or run-all-8-pgbench-standalone.sh.
#
# Usage: ./scripts/ensure-pgbench-dbs-ready.sh
#   SKIP_COMPOSE_UP=1  — only wait for existing containers (do not start)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

PORTS="5433 5434 5435 5436 5437 5438 5439 5440"
MAX_WAIT="${PGBENCH_DB_MAX_WAIT:-120}"
SKIP_COMPOSE_UP="${SKIP_COMPOSE_UP:-0}"

ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }

# Check Docker
if ! command -v docker >/dev/null 2>&1; then
  warn "docker not found. Install Docker or start Colima."
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  warn "Docker daemon not reachable. Start Colima: colima start --with-kubernetes"
  exit 1
fi

# Start postgres services if not skipped
if [[ "$SKIP_COMPOSE_UP" != "1" ]]; then
  echo "Starting Postgres services (docker compose)..."
  docker compose up -d postgres postgres-social postgres-listings postgres-shopping postgres-auth postgres-auction-monitor postgres-analytics postgres-python-ai 2>&1 || true
  sleep 5
fi

# Wait for each port
echo "Waiting for DBs (ports 5433–5440)..."
elapsed=0
while [[ $elapsed -lt $MAX_WAIT ]]; do
  all_ok=true
  for port in $PORTS; do
    if ! ( nc -z 127.0.0.1 "$port" 2>/dev/null || nc -z ::1 "$port" 2>/dev/null ); then
      all_ok=false
      break
    fi
  done
  if [[ "$all_ok" == "true" ]]; then
    ok "All 8 Postgres ports (5433–5440) are reachable."
    exit 0
  fi
  sleep 5
  elapsed=$((elapsed + 5))
done

warn "Not all DBs became ready within ${MAX_WAIT}s. Start Colima and run: docker compose up -d postgres postgres-social postgres-listings postgres-shopping postgres-auth postgres-auction-monitor postgres-analytics postgres-python-ai"
exit 1
