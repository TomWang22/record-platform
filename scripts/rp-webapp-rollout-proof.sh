#!/usr/bin/env bash
# Build webapp:dev, load into Colima/k3s, rollout, prove edge version marker.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

NS="${K8S_NAMESPACE:-record-platform}"
NO_CACHE="${NO_CACHE:-1}"
export NO_CACHE

GIT_COMMIT="$(git rev-parse --short=12 HEAD 2>/dev/null || echo unknown)"
REPORT_DIR="${REPORT_DIR:-bench_logs/frontend-contract}"
mkdir -p "$REPORT_DIR"
REPORT="$REPORT_DIR/webapp-rollout-proof.md"

chmod +x "$SCRIPT_DIR/rp-webapp-docker-build.sh" "$SCRIPT_DIR/smoke-rp-webapp-edge-staleness.sh"

echo "▶ Phase 1: docker build (repo root)"
bash "$SCRIPT_DIR/rp-webapp-docker-build.sh"

IMAGE_ID="$(docker image inspect webapp:dev --format '{{.Id}}' 2>/dev/null || echo unknown)"
IMAGE_CREATED="$(docker image inspect webapp:dev --format '{{.Created}}' 2>/dev/null || echo unknown)"

if command -v colima >/dev/null 2>&1 && colima status &>/dev/null 2>&1; then
  echo "▶ Loading webapp:dev into Colima"
  docker save webapp:dev | colima ssh -- docker load
else
  echo "⚠️  Colima not running — skip image load (assuming cluster can see host docker)"
fi

echo "▶ Rollout restart deployment/webapp -n $NS"
kubectl -n "$NS" rollout restart deployment/webapp
kubectl -n "$NS" rollout status deployment/webapp --timeout=300s

POD="$(kubectl -n "$NS" get pod -l app=webapp -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo '')"
POD_IMAGE="$(kubectl -n "$NS" get pod -l app=webapp -o jsonpath='{.items[0].status.containerStatuses[0].imageID}' 2>/dev/null || echo '')"
DEPLOY_IMAGE="$(kubectl -n "$NS" get deployment webapp -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || echo '')"

EDGE_BASE="${RP_EDGE_BASE:-https://record-platform.test}"
sleep 5
VERSION_JSON="$(curl -sk "$EDGE_BASE/api/webapp-version" 2>/dev/null || echo '{}')"
EDGE_SHA="$(echo "$VERSION_JSON" | tr -d '\n' | sed -n 's/.*"buildSha"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"

{
  echo "# Webapp rollout proof"
  echo ""
  echo "- Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "- Expected GIT_COMMIT: \`$GIT_COMMIT\`"
  echo "- Host image ID: \`$IMAGE_ID\`"
  echo "- Host image created: \`$IMAGE_CREATED\`"
  echo "- Deployment image: \`$DEPLOY_IMAGE\`"
  echo "- Running pod: \`$POD\`"
  echo "- Pod imageID: \`$POD_IMAGE\`"
  echo "- Edge buildSha: \`${EDGE_SHA:-unknown}\`"
  echo ""
} >"$REPORT"

if [[ "$EDGE_SHA" != "$GIT_COMMIT" ]]; then
  echo "❌ Edge buildSha '$EDGE_SHA' != expected '$GIT_COMMIT'" | tee -a "$REPORT" >&2
  exit 1
fi

echo "▶ Edge staleness guard"
bash "$SCRIPT_DIR/smoke-rp-webapp-edge-staleness.sh"

echo "✅ Rollout proof complete — $REPORT"
