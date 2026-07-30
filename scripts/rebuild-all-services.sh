#!/usr/bin/env bash
# Rebuild all app service images (strict TLS/mTLS, gRPC health probes).
# Usage: ./scripts/rebuild-all-services.sh [--apply] [--no-python]
#   --apply   also run kubectl apply -k infra/k8s/overlays/dev
#   --no-python  skip python-ai-service build
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

APPLY=false
SKIP_PYTHON=false
while [[ $# -gt 0 ]]; do
  case $1 in
    --apply)    APPLY=true; shift ;;
    --no-python) SKIP_PYTHON=true; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

bold() { printf "\033[1m%s\033[0m\n" "$*"; }
step() { echo; bold "▶ $*"; }

# All Node/TS services: build from repo root with -f (monorepo context). Tag both for kind and local.
NODE_SERVICES=(
  api-gateway
  auth-service
  records-service
  listings-service
  messaging-service
  shopping-service
  analytics-service
  auction-monitor
)

step "Building Node/TS service images (strict TLS/mTLS)"
for svc in "${NODE_SERVICES[@]}"; do
  if [[ -f "services/${svc}/Dockerfile" ]]; then
    echo "  Building ${svc}..."
    docker build -t "${svc}:dev" -t "ghcr.io/yourorg/${svc}:dev" -f "services/${svc}/Dockerfile" . || {
      echo "  ❌ ${svc} build failed" >&2
      exit 1
    }
  else
    echo "  Skipping ${svc} (no Dockerfile)"
  fi
done

if [[ "$SKIP_PYTHON" != "true" ]] && [[ -f services/python-ai-service/Dockerfile ]]; then
  step "Building python-ai-service (context = repo root)"
  docker build -t python-ai-service:dev -t ghcr.io/yourorg/python-ai-service:dev -f services/python-ai-service/Dockerfile . || {
    echo "  ❌ python-ai-service build failed" >&2
    exit 1
  }
fi

if [[ -f services/cron-jobs/Dockerfile ]]; then
  step "Building cron-jobs"
  docker build -t cron-jobs:dev -t ghcr.io/yourorg/cron-jobs:dev -f services/cron-jobs/Dockerfile . || true
fi

step "Image list (dev tags)"
docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}" | grep -E "dev\s*$|REPOSITORY" | head -20

if [[ "$APPLY" == "true" ]]; then
  step "Applying kustomize overlay (infra/k8s/overlays/dev)"
  kubectl create ns record-platform 2>/dev/null || true
  kubectl apply -k infra/k8s/overlays/dev
  step "Rollout status (timeout 120s per deploy)"
  for d in api-gateway auth-service records-service listings-service messaging-service shopping-service analytics-service auction-monitor python-ai-service haproxy nginx; do
    kubectl -n record-platform rollout status "deploy/$d" --timeout=120s 2>/dev/null || echo "  (deploy/$d not found or still rolling)"
  done
  step "Pods"
  kubectl -n record-platform get pods -o wide 2>/dev/null || true
fi

echo
bold "Done. All services use gRPC + TLS/mTLS health probes (except api-gateway/nginx which are edge HTTP)."
echo "  To apply manifests: $0 --apply"
echo "  To load into kind:  for i in \$(docker images --format '{{.Repository}}:{{.Tag}}' | grep dev); do kind load docker-image \$i --name record-platform; done"
