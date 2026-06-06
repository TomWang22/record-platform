#!/usr/bin/env bash
# Apply MetalLB pool + L2 and Caddy LoadBalancer service (sessionAffinity).
# Tolerates API 503: waits for API, then retries apply with backoff.
# Usage: ./scripts/apply-metallb-pool-and-caddy-service.sh
# See: METALLB_AND_API_503_REPORT.md (root) for full context.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

POOL_YAML="$REPO_ROOT/infra/k8s/metallb/ipaddresspool.yaml"
L2_YAML="$REPO_ROOT/infra/k8s/metallb/l2advertisement.yaml"
CADDY_YAML="$REPO_ROOT/infra/k8s/caddy-h3-service.yaml"
MAX_WAIT="${MAX_WAIT:-60}"
MAX_RETRIES="${MAX_RETRIES:-12}"
RETRY_SLEEP="${RETRY_SLEEP:-5}"

ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
info(){ echo "ℹ️  $*"; }

# 1. Wait for API to accept at least one request (avoids immediate 503)
info "Checking API (up to ${MAX_WAIT}s)..."
for i in $(seq 1 "$MAX_WAIT"); do
  if kubectl get ns default --request-timeout=5s >/dev/null 2>&1; then
    ok "API responding"
    break
  fi
  [[ $i -eq 1 ]] && echo -n "  "
  echo -n "."
  sleep 1
  if [[ $i -eq "$MAX_WAIT" ]]; then
    warn "API still not responding. Try: colima ssh -- sudo systemctl restart k3s ; sleep 30 ; re-run this script"
    exit 1
  fi
done
echo ""

# 2. Wait for MetalLB controller (webhook) so pool/L2 apply doesn't hit "endpoints webhook-service not found"
if kubectl get ns metallb-system --request-timeout=5s >/dev/null 2>&1; then
  info "Waiting for MetalLB controller (webhook) to be ready..."
  for i in $(seq 1 30); do
    if kubectl get endpoints -n metallb-system webhook-service --request-timeout=5s -o jsonpath='{.subsets[*].addresses[*].ip}' 2>/dev/null | grep -q .; then
      ok "MetalLB webhook ready"
      break
    fi
    [[ $i -eq 1 ]] && echo -n "  "
    echo -n "."
    sleep 2
    if [[ $i -eq 30 ]]; then
      warn "Webhook not ready; pool apply may fail with InternalError (endpoints not found)"
      echo ""
      echo "  MetalLB diagnostic (why webhook has no endpoints):"
      kubectl get pods -n metallb-system -o wide 2>/dev/null | sed 's/^/    /'
      kubectl get svc,ep -n metallb-system 2>/dev/null | sed 's/^/    /'
      echo "  If controller is not Running: kubectl logs -n metallb-system deploy/controller --tail=30"
      echo "  See METALLB_AND_API_503_REPORT.md Option B2 and PREFLIGHT_WHY_IT_WORKED_AND_WHATS_BROKEN.md"
    fi
  done
  echo ""
fi

# 3. Apply MetalLB pool + L2 with retries (apply does GET then PATCH; GET can 503 under load)
info "Applying MetalLB pool + L2 (retries up to ${MAX_RETRIES}, ${RETRY_SLEEP}s apart)..."
_apply_metallb() {
  kubectl apply -f "$POOL_YAML" -f "$L2_YAML" --request-timeout=25s --validate=false 2>&1
}
for r in $(seq 1 "$MAX_RETRIES"); do
  if _apply_metallb; then
    ok "MetalLB pool + L2 applied"
    break
  fi
  if [[ $r -eq "$MAX_RETRIES" ]]; then
    warn "MetalLB pool/L2 apply failed after ${MAX_RETRIES} attempts. See METALLB_AND_API_503_REPORT.md"
    exit 1
  fi
  sleep "$RETRY_SLEEP"
done

# 4. Apply Caddy LoadBalancer service with retries
info "Applying Caddy LoadBalancer service (sessionAffinity)..."
for r in $(seq 1 "$MAX_RETRIES"); do
  if kubectl apply -f "$CADDY_YAML" --request-timeout=25s --validate=false 2>/dev/null; then
    ok "Caddy service applied"
    break
  fi
  if [[ $r -eq "$MAX_RETRIES" ]]; then
    warn "Caddy service apply failed after ${MAX_RETRIES} attempts."
    exit 1
  fi
  sleep "$RETRY_SLEEP"
done

ok "Done. Check: kubectl -n ingress-nginx get svc caddy-h3"
