#!/usr/bin/env bash
# List Docker volumes used by Postgres (docker-compose) and show size.
# Use: ./scripts/check-postgres-volumes.sh
#   COMPOSE_PROJECT_NAME=record-platform  (default) to match docker-compose project.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

PROJECT="${COMPOSE_PROJECT_NAME:-record-platform}"
# Volume names from docker-compose.yml (named volumes for postgres)
VOLUMES=(pgdata pgdata-social pgdata-listings pgdata-shopping pgdata-auth pgdata-auction-monitor pgdata-analytics pgdata-python-ai)
# Full names are typically ${PROJECT}_pgdata etc.
say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
info() { echo "ℹ️  $*"; }

say "=== Postgres Docker volumes (project: $PROJECT) ==="
info "Volumes from docker-compose: ${VOLUMES[*]}"
echo ""

if ! command -v docker >/dev/null 2>&1; then
  warn "Docker not found; cannot list volumes."
  exit 1
fi

for v in "${VOLUMES[@]}"; do
  full="${PROJECT}_${v}"
  if docker volume inspect "$full" >/dev/null 2>&1; then
    echo "  $full: exists"
  else
    echo "  $full: (not found)"
  fi
done
# Show size summary if available (docker system df -v)
if docker system df -v 2>/dev/null | grep -q "Local Volumes"; then
  echo ""
  info "Volume sizes (docker system df -v):"
  docker system df -v 2>/dev/null | grep -E "VOLUME|$PROJECT" | head -20 || true
fi

echo ""
info "To load millions of rows per DB: ROWS_PER_SCHEMA=2000000 ./scripts/seed-all-eight-databases.sh (see docs/ANALYTICS_PYTHON_AI_DUAL_WRITE_AND_AUTH.md)"
info "Records only: TARGET_ROWS=2500000 ./scripts/load-records-millions.sh (see scripts/PGBENCH_HARDENING.md)"
info "Data lives in these volumes; switching k3d→k3s does not change them (same Docker host). See docs/K3D_TO_K3S_DATA.md"
