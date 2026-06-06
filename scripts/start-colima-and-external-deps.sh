#!/usr/bin/env bash
# Start Colima (optional) and RP external infra only (Postgres 5433–5443, Redis, MinIO, Jaeger, Mailpit).
# Kafka and app services run in k3s — not docker compose.
# Usage: ./scripts/start-colima-and-external-deps.sh [--no-colima] [--verify-only]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=lib/rp-colima-running.sh
source "$SCRIPT_DIR/lib/rp-colima-running.sh"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

NO_COLIMA=0
VERIFY_ONLY=0
for a in "$@"; do
  [[ "$a" == "--no-colima" ]] && NO_COLIMA=1
  [[ "$a" == "--verify-only" ]] && VERIFY_ONLY=1
done

if [[ "$NO_COLIMA" -eq 0 ]] && [[ "$VERIFY_ONLY" -eq 0 ]]; then
  say "1. Colima (Docker + Kubernetes)"
  if command -v colima >/dev/null 2>&1; then
    if rp_colima_is_running; then
      ok "Colima already running"
    else
      colima start --with-kubernetes 2>&1 || { warn "colima start failed"; exit 1; }
      ok "Colima started"
    fi
  else
    warn "colima not found — install or use existing Docker"
  fi
fi

# shellcheck source=lib/ensure-colima-docker-context.sh
source "$SCRIPT_DIR/lib/ensure-colima-docker-context.sh"
if command -v colima >/dev/null 2>&1 && rp_colima_is_running; then
  OCH_FORCE_COLIMA_DOCKER=1 och_ensure_colima_docker_context || true
fi

docker info >/dev/null 2>&1 || { warn "Docker not reachable"; exit 1; }
ok "Docker reachable"

bash "$SCRIPT_DIR/rp-verify-compose-contract.sh"

if [[ "$VERIFY_ONLY" -eq 1 ]]; then
  bash "$SCRIPT_DIR/rp-verify-external-runtime-ports.sh"
  exit $?
fi

say "2. External infra (bring-up-external-infra — no Kafka/Zookeeper/apps)"
bash "$SCRIPT_DIR/bring-up-external-infra.sh"
ok "External deps ready — use k3s for Kafka (infra/k8s/kafka-kraft-metallb)"
