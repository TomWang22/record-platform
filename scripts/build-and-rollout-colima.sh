#!/usr/bin/env bash
# Build all app images and rollout restart deployments for Colima k3s.
# Use this instead of build-and-load.sh (which is for Kind). Images are built as :dev
# and are visible to Colima's k3s. Run from repo root.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PLATFORM="${PLATFORM:-linux/amd64}"
SERVICES=(
  api-gateway
  auth-service
  records-service
  listings-service
  analytics-service
  python-ai-service
  messaging-service
  shopping-service
  auction-monitor
  cron-jobs
)

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

say "=== Building images (platform: $PLATFORM) ==="
for s in "${SERVICES[@]}"; do
  if [[ -f "services/$s/Dockerfile" ]]; then
    echo "→ Building $s:dev ..."
    if docker build --platform="$PLATFORM" -t "$s:dev" -f "services/$s/Dockerfile" .; then
      ok "built $s:dev"
    else
      warn "build failed: $s"
    fi
  else
    warn "No Dockerfile for $s, skipping"
  fi
done

say "=== Restarting deployments (record-platform namespace) ==="
if kubectl get namespace record-platform &>/dev/null; then
  # cron-jobs is commented out in kustomization (Temporarily disabled) so omit from restart
  kubectl rollout restart deployment api-gateway auth-service records-service listings-service analytics-service python-ai-service messaging-service shopping-service auction-monitor -n record-platform
  kubectl rollout status deployment api-gateway messaging-service analytics-service python-ai-service -n record-platform --timeout=120s
  ok "Rollout restarted; status checked for api-gateway, messaging-service, analytics-service, python-ai-service"
else
  warn "Namespace record-platform not found (cluster may not be up). Build completed; run kubectl rollout restart when cluster is ready."
fi

say "Done. Re-run the test suite or preflight as needed."
