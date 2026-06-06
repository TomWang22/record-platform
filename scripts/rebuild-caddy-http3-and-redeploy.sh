#!/usr/bin/env bash
# Build Caddy image with HTTP/3 (xcaddy + experimental_http3), then push to registry (if used) and redeploy caddy-h3.
# Use this after updating docker/caddy-with-tcpdump/Dockerfile so the cluster runs Caddy with QUIC.
#
# Usage:
#   ./scripts/rebuild-caddy-http3-and-redeploy.sh
#
# Optional:
#   PLATFORM=linux/amd64   for Colima/k3d nodes (default when unset: host arch)
#   SKIP_PUSH=1            build only, do not push or patch (you will redeploy manually)
#   FORCE_REBUILD=1        pass --no-cache to docker build (force xcaddy to run; avoids using cached minimal binary)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PLATFORM="${PLATFORM:-}"
SKIP_PUSH="${SKIP_PUSH:-0}"
FORCE_REBUILD="${FORCE_REBUILD:-0}"
REG_PORT="${REG_PORT:-5000}"
PUSH_ADDR="127.0.0.1:${REG_PORT}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
info() { echo "ℹ️  $*"; }

# When registry is not used: set deployment to caddy-with-tcpdump:dev and try to load image into cluster (Colima/k3s).
use_local_caddy_with_tcpdump() {
  if ! command -v kubectl >/dev/null 2>&1 || ! kubectl get deployment caddy-h3 -n ingress-nginx --request-timeout=5s >/dev/null 2>&1; then
    info "kubectl or caddy-h3 not available; set image to caddy-with-tcpdump:dev manually after loading the image into your cluster."
    return 0
  fi
  if command -v colima >/dev/null 2>&1 && colima status 2>/dev/null | grep -q "colima is running"; then
    info "Loading caddy-with-tcpdump:dev into cluster (Colima VM)..."
    if colima ssh -- "docker save caddy-with-tcpdump:dev -o /tmp/caddy-with-tcpdump-dev.tar 2>/dev/null && sudo k3s ctr images import /tmp/caddy-with-tcpdump-dev.tar 2>/dev/null && rm -f /tmp/caddy-with-tcpdump-dev.tar"; then
      ok "Image loaded into k3s"
    else
      warn "Could not load image into k3s (k3s ctr may not be in PATH or image not in Colima Docker). Run manually: colima ssh -- sh -c 'docker save caddy-with-tcpdump:dev -o /tmp/caddy.tar && sudo k3s ctr images import /tmp/caddy.tar'; or add 127.0.0.1:5000 to Docker insecure registries and re-run."
    fi
  fi
  kubectl set image deployment/caddy-h3 -n ingress-nginx caddy=caddy-with-tcpdump:dev --request-timeout=15s 2>/dev/null && ok "Set caddy-h3 image to caddy-with-tcpdump:dev" || warn "Failed to set image; run: kubectl set image deployment/caddy-h3 -n ingress-nginx caddy=caddy-with-tcpdump:dev"
}

cd "$REPO_ROOT"

# 1) Build caddy-with-tcpdump with HTTP/3 (Dockerfile uses xcaddy)
BUILD_OPTS=(-t caddy-with-tcpdump:dev -f docker/caddy-with-tcpdump/Dockerfile)
[[ "$FORCE_REBUILD" == "1" ]] && BUILD_OPTS=(--no-cache "${BUILD_OPTS[@]}")
[[ -n "$PLATFORM" ]] && BUILD_OPTS=(--platform "$PLATFORM" "${BUILD_OPTS[@]}")
say "Building caddy-with-tcpdump:dev (with HTTP/3)...${FORCE_REBUILD:+ [FORCE_REBUILD=1, no cache]}"
docker build "${BUILD_OPTS[@]}" . 2>&1
ok "Built caddy-with-tcpdump:dev"

# 2) Push to registry and patch deployment (if registry reachable and not SKIP_PUSH)
if [[ "$SKIP_PUSH" == "1" ]]; then
  warn "SKIP_PUSH=1: not pushing or patching. Apply deploy and rollout manually."
else
  if curl -sS -o /dev/null -w "%{http_code}" --connect-timeout 2 "http://${PUSH_ADDR}/v2/" 2>/dev/null | grep -qE '200|401|403'; then
    info "Registry at ${PUSH_ADDR} reachable; pushing and patching..."
    docker tag caddy-with-tcpdump:dev "${PUSH_ADDR}/caddy-with-tcpdump:dev"
    if docker push "${PUSH_ADDR}/caddy-with-tcpdump:dev" 2>/dev/null; then
      ok "Pushed caddy-with-tcpdump:dev"
      if command -v kubectl >/dev/null 2>&1 && kubectl get deployment caddy-h3 -n ingress-nginx --request-timeout=5s >/dev/null 2>&1; then
        REGISTRY_NAME="${K3D_REGISTRY_NAME:-k3d-record-platform-registry}"
        kubectl set image deployment/caddy-h3 -n ingress-nginx "caddy=${REGISTRY_NAME}:${REG_PORT}/caddy-with-tcpdump:dev" --request-timeout=15s 2>/dev/null && ok "Patched caddy-h3 to use caddy-with-tcpdump:dev" || warn "Patch failed (nodes may use different registry name)"
      fi
    else
      warn "Push to ${PUSH_ADDR} failed (insecure registry? Add to Docker daemon and retry)."
      use_local_caddy_with_tcpdump
    fi
  else
    info "No registry at ${PUSH_ADDR}; using local image caddy-with-tcpdump:dev (load into cluster if needed)."
    use_local_caddy_with_tcpdump
  fi
fi

# 3) Restart deployment so new image is pulled and rolled out
say "Restarting caddy-h3 deployment..."
if command -v kubectl >/dev/null 2>&1; then
  kubectl rollout restart deployment/caddy-h3 -n ingress-nginx 2>/dev/null && ok "Rollout restarted" || { warn "kubectl rollout restart failed"; exit 1; }
  kubectl rollout status deployment/caddy-h3 -n ingress-nginx --timeout=120s 2>/dev/null || { warn "Rollout status timed out or failed"; exit 1; }
  ok "Caddy is running with new image"
  # Quick verification: which image the pod is using and whether UDP 443 is open (in-pod and on VM)
  POD_NAME="$(kubectl get pod -n ingress-nginx -l app=caddy-h3 -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)" || true
  if [[ -n "$POD_NAME" ]]; then
    POD_IMAGE="$(kubectl get pod -n ingress-nginx "$POD_NAME" -o jsonpath='{.status.containerStatuses[0].imageID}' 2>/dev/null)" || true
    info "Pod image: ${POD_IMAGE:-unknown}"
    IN_POD="$(kubectl exec -n ingress-nginx "$POD_NAME" -- sh -c 'ss -lunp 2>/dev/null || netstat -ulnp 2>/dev/null' 2>/dev/null | grep -E '[:.]443\s' || true)"
    info "UDP 443 in pod: ${IN_POD:-none}"
    info "UDP 443 on VM:  $(colima ssh -- ss -lunp 2>/dev/null | grep 443 || echo 'none')"
    # Adapted config: does it enable HTTP/3 (h3)? Caddy only binds UDP 443 when TLS + protocols include h3.
    ADAPTED="$(kubectl exec -n ingress-nginx "$POD_NAME" -- caddy adapt --config /etc/caddy/Caddyfile 2>/dev/null)" || true
    if echo "$ADAPTED" | grep -qE '"protocols".*"h3"|"h3".*"protocols"'; then
      info "Caddyfile adapt: protocols include h3 (HTTP/3 enabled in config)"
    else
      PROTOCOLS="$(echo "$ADAPTED" | grep -oE '"protocols":\s*\[[^]]*\]' | head -1)"
      warn "Caddyfile adapt: h3 not found in protocols. Snippet: ${PROTOCOLS:-none}"
    fi
  fi
  info "Verify: kubectl exec -n ingress-nginx \$(kubectl get pod -n ingress-nginx -l app=caddy-h3 -o jsonpath='{.items[0].metadata.name}') -- caddy adapt --config /etc/caddy/Caddyfile | grep -E 'h3|protocols'"
  info "Then: python3 scripts/run_transport_validation.py --capture --transport-gate --v2"
  info "Manual HTTP/3: system curl often lacks --http3; use the script above (k6) or install curl with HTTP/3 (e.g. brew install curl-quiche)."
else
  warn "kubectl not found; apply and rollout manually"
  exit 1
fi
