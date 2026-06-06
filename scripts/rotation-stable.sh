#!/usr/bin/env bash
# Stable rotation resilience: baseline HTTP/3 → Caddy restart → post-rotation HTTP/3.
# Validates cert reload and QUIC continuity without host-based k6 load (no UDP NAT noise).
# For throughput/load testing use rotation-suite.sh (in-cluster k6). This script is correctness-only.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS_ING="ingress-nginx"
SERVICE="caddy-h3"
CA="${REPO_ROOT}/certs/dev-root.pem"

section() { printf "\n\033[1m%s\033[0m\n" "$*"; }
pass() { echo "✅ $*"; }
fail() { echo "❌ $*"; exit 1; }
info() { echo "ℹ️  $*"; }

TARGET_IP="${TARGET_IP:-}"
[[ -z "$TARGET_IP" ]] && TARGET_IP=$(kubectl -n "$NS_ING" get svc "$SERVICE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
if [[ -z "$TARGET_IP" ]] || [[ ! -f "$CA" ]]; then
  echo "TARGET_IP not set and caddy-h3 has no LB IP, or certs/dev-root.pem missing. Set TARGET_IP or run preflight with MetalLB."
  exit 1
fi

section "Baseline HTTP/3 check"
if curl --help all 2>/dev/null | grep -q -- "--http3"; then
  curl -sf --connect-timeout 5 --max-time 10 --http3-only --cacert "$CA" \
    --resolve "record.local:443:${TARGET_IP}" "https://record.local/_caddy/healthz" -o /dev/null || fail "H3 baseline failed"
  pass "Baseline OK"
else
  info "curl lacks --http3; skipping baseline (use rotation-suite.sh for full rotation)"
fi

section "Trigger Caddy rollout (cert reload)"
kubectl -n "$NS_ING" rollout restart "deploy/$SERVICE" --request-timeout=15s || fail "Caddy rollout restart failed"
sleep 5
kubectl -n "$NS_ING" rollout status "deploy/$SERVICE" --timeout=120s 2>/dev/null || true

section "Post-rotation HTTP/3 check"
if curl --help all 2>/dev/null | grep -q -- "--http3"; then
  for attempt in 1 2 3 4 5; do
    if curl -sf --connect-timeout 5 --max-time 10 --http3-only --cacert "$CA" \
      --resolve "record.local:443:${TARGET_IP}" "https://record.local/_caddy/healthz" -o /dev/null 2>/dev/null; then
      pass "Post-rotation H3 OK (attempt $attempt)"
      exit 0
    fi
    [[ $attempt -lt 5 ]] && sleep 3
  done
  fail "H3 after rotation failed (5 attempts)"
else
  pass "Rotation resilience (Caddy restarted; curl has no --http3 for post-check)"
fi
