#!/usr/bin/env bash
# Single entry point: bring up external stack (Redis, Kafka, Zookeeper, 8 Postgres) and ensure DBs exist.
# Then optionally verify Kafka SSL secret for k8s and list volumes.
#
# Usage: ./scripts/ensure-dependencies-ready.sh
#   SKIP_DB_CREATE=1   — do not run ensure-external-databases-created.sh
#   ENFORCE_DB_TUNING=1 — passed to bring-up-external-infra.sh
#
# See: scripts/bring-up-external-infra.sh, scripts/ensure-external-databases-created.sh, docs/PLATFORM_LAYOUT.md

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
info(){ echo "ℹ️  $*"; }

say "=== Ensure dependencies ready (external stack + DBs) ==="

"$SCRIPT_DIR/bring-up-external-infra.sh"

if [[ "${SKIP_DB_CREATE:-0}" != "1" ]]; then
  "$SCRIPT_DIR/ensure-external-databases-created.sh"
fi

# Optional: list Docker volumes for the 8 Postgres (so user can verify volumes)
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  info "Postgres volumes (docker):"
  docker volume ls --format '{{.Name}}' 2>/dev/null | grep -E '^[a-z0-9_-]*pgdata' || true
fi

# Reminder for k8s
if command -v kubectl >/dev/null 2>&1 && kubectl get ns record-platform &>/dev/null; then
  info "K8s record-platform exists. Ensure kafka-external Endpoints point at host: kubectl get endpoints kafka-external -n record-platform; run ./scripts/patch-kafka-external-host.sh if needed."
fi

ok "Dependencies ready. Next: deploy k8s (kustomize / bring-up) or run preflight."
