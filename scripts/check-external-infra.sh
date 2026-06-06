#!/usr/bin/env bash
# Check that external infra is up: Redis (6379), Kafka (29093), Zookeeper, 8 Postgres (5433–5440).
# Optionally start containers first with START=1 or run ./scripts/bring-up-external-infra.sh.
#
# Usage:
#   ./scripts/check-external-infra.sh           # check only
#   START=1 ./scripts/check-external-infra.sh   # start compose then check

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

START="${START:-0}"
ok()   { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*"; }

# Docker available?
if ! command -v docker >/dev/null 2>&1; then
  fail "Docker not found."
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  fail "Docker daemon not reachable (e.g. start Colima)."
  exit 1
fi

if [[ "$START" == "1" ]]; then
  echo "Starting Redis, Zookeeper, Kafka, 8 Postgres (docker compose)..."
  docker compose up -d \
    zookeeper kafka redis \
    postgres postgres-social postgres-listings postgres-shopping \
    postgres-auth postgres-auction-monitor postgres-analytics postgres-python-ai \
    2>&1 || true
  echo "Waiting 15s for services to bind..."
  sleep 15
fi

echo ""
echo "--- External infra check ---"

# 1) Redis 6379
if nc -z 127.0.0.1 6379 2>/dev/null; then
  ok "Redis (6379)"
else
  warn "Redis (6379) not reachable"
fi

# 2) Kafka 29093 (SSL)
if nc -z 127.0.0.1 29093 2>/dev/null; then
  ok "Kafka (29093)"
else
  warn "Kafka (29093) not reachable"
fi

# 3) Zookeeper (no host port in compose; check container running/healthy)
_zoo_ok=0
_state=$(docker compose ps zookeeper --format "{{.Status}}" 2>/dev/null || echo "")
if echo "$_state" | grep -qiE "up|healthy"; then
  _zoo_ok=1
fi
if [[ $_zoo_ok -eq 1 ]]; then
  ok "Zookeeper (container up)"
else
  warn "Zookeeper (container not up: $_state)"
fi

# 4) 8 Postgres (5433–5440)
_all_pg=1
for port in 5433 5434 5435 5436 5437 5438 5439 5440; do
  if ! nc -z 127.0.0.1 "$port" 2>/dev/null; then
    _all_pg=0
    break
  fi
done
if [[ $_all_pg -eq 1 ]]; then
  ok "Postgres x8 (5433–5440)"
else
  warn "Postgres (5433–5440): one or more ports not reachable"
  for port in 5433 5434 5435 5436 5437 5438 5439 5440; do
    nc -z 127.0.0.1 "$port" 2>/dev/null && echo "  $port OK" || echo "  $port FAIL"
  done
fi

echo ""

# Summary: exit 1 if any critical check failed
_failed=0
nc -z 127.0.0.1 6379 2>/dev/null   || _failed=1
nc -z 127.0.0.1 29093 2>/dev/null  || _failed=1
[[ $_all_pg -eq 1 ]]                || _failed=1

if [[ $_failed -eq 1 ]]; then
  echo "To start everything: ./scripts/bring-up-external-infra.sh"
  echo "Or: docker compose up -d zookeeper kafka redis postgres postgres-social postgres-listings postgres-shopping postgres-auth postgres-auction-monitor postgres-analytics postgres-python-ai"
  exit 1
fi

ok "All external infra reachable (Redis, Kafka, Zookeeper, 8 Postgres)."
exit 0
