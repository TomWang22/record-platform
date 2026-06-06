#!/usr/bin/env bash
# Verify RP owns host ports 5433–5443, 6379, 9000/9001 — no OCH runtime on 5444–5448 or 6380.
set -euo pipefail

FAIL=0

# port → expected container name prefix + display label
declare -A PORT_LABEL=(
  [5433]="records"
  [5434]="messaging"
  [5435]="listings"
  [5436]="shopping"
  [5437]="auth"
  [5438]="auction_monitor_core (auction-monitor/core)"
  [5439]="analytics"
  [5440]="python_ai"
  [5441]="notification"
  [5442]="trust"
  [5443]="media"
)

check_port_owner() {
  local port="$1" want_prefix="$2" label="$3"
  local line name
  line="$(docker ps --format '{{.Names}}\t{{.Ports}}' | grep -E ":${port}->" | head -1 || true)"
  if [[ -z "$line" ]]; then
    echo "⚠️  port $port ($label): no container published (may be down)"
    return 0
  fi
  name="${line%%$'\t'*}"
  if [[ "$name" != ${want_prefix}* ]]; then
    echo "❌ port $port ($label): owned by $name (expected ${want_prefix}*)"
    FAIL=1
  else
    echo "✅ port $port ($label): $name"
  fi
}

echo "=== RP external runtime port check ==="
for p in 5433 5434 5435 5436 5437 5438 5439 5440 5441 5442 5443; do
  check_port_owner "$p" "record-platform-postgres" "${PORT_LABEL[$p]}"
done
check_port_owner 6379 "record-platform-redis" "redis"
if ! docker ps --format '{{.Names}}\t{{.Ports}}' | grep -q 'record-platform-minio.*9000'; then
  echo "⚠️  minio: not publishing 9000"
else
  echo "✅ minio: record-platform-minio (9000/9001)"
fi

if docker ps --format '{{.Names}}' | grep -q '^off-campus-housing-tracker-'; then
  echo "❌ OCH containers still running"
  docker ps --format '  {{.Names}}\t{{.Ports}}' | grep '^off-campus-housing-tracker-' || true
  FAIL=1
else
  echo "✅ no off-campus-housing-tracker-* containers"
fi

for p in 5444 5445 5446 5447 5448 6380 29093 9092 2181; do
  if docker ps --format '{{.Ports}}' | grep -qE ":${p}->"; then
    echo "❌ forbidden runtime port $p still published"
    docker ps --format 'table {{.Names}}\t{{.Ports}}' | grep -E ":${p}->" || true
    FAIL=1
  fi
done

[[ "$FAIL" -eq 0 ]] && echo "=== RP external runtime ports OK ===" && exit 0
echo "=== RP external runtime port check FAILED ===" >&2
exit 1
