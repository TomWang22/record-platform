#!/usr/bin/env bash
# Invariant: docker-compose must publish RP Postgres 5433–5443 and Redis 6379.
# Run after `docker compose up` (local / Colima). Not for GitHub-hosted CI (no daemon).
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "❌ docker not found."
  exit 1
fi

required_ports=(5433 5434 5435 5436 5437 5438 5439 5440 5441 5442 5443 6379 9000)
ports_blob="$(docker ps --format '{{.Ports}}' 2>/dev/null | tr '\n' ' ')"

for port in "${required_ports[@]}"; do
  if ! printf '%s' "$ports_blob" | grep -qE "(0\\.0\\.0\\.0|\\[::\\]):${port}->"; then
    echo "❌ Required host port ${port} not mapped (expected 0.0.0.0:${port}-> or [::]:${port}-> in docker ps)."
    exit 1
  fi
done

echo "✅ All required ports mapped (Postgres 5433–5443, Redis 6379, MinIO 9000)."
