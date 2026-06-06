#!/usr/bin/env bash
set -euo pipefail

# Restart all services in Kubernetes to pick up newly built images
CLUSTER="${1:-h3}"
NS="${NAMESPACE:-record-platform}"

log()  { printf "\n\033[1;36m▶ %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m⚠ %s\033[0m\n" "$*"; }

# Check if cluster exists
if ! kind get clusters 2>/dev/null | grep -qx "$CLUSTER"; then
  warn "kind cluster '$CLUSTER' not found."
  exit 1
fi

# Services to restart
SERVICES=(
  api-gateway
  auth-service
  records-service
  listings-service
  analytics-service
  python-ai-service
  social-service
  shopping-service
  auction-monitor
  cron-jobs
  webapp
)

log "Restarting services in namespace '$NS' to pick up new images..."

for service in "${SERVICES[@]}"; do
  if kubectl get deployment "$service" -n "$NS" >/dev/null 2>&1; then
    log "Restarting $service..."
    kubectl rollout restart deployment "$service" -n "$NS" || warn "Failed to restart $service"
  else
    warn "Deployment $service not found, skipping..."
  fi
done

log "Waiting for rollouts to complete..."
for service in "${SERVICES[@]}"; do
  if kubectl get deployment "$service" -n "$NS" >/dev/null 2>&1; then
    kubectl rollout status deployment "$service" -n "$NS" --timeout=120s || warn "Rollout for $service timed out or failed"
  fi
done

log "✅ All services restarted!"
log "💡 Check status with: kubectl get pods -n $NS"

