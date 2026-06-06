#!/usr/bin/env bash
# State-aware preflight: layered checks so failures stop at the correct layer.
# L0 Host infra → L1 Pod→Host DB → L2 Gateway health → L3 TLS → L4 HTTP/3.
# Use as first gate before full preflight or CI. No linear bash chaos — each layer is explicit.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="record-platform"
NS_ING="ingress-nginx"
STATE_OK=true

section() { printf "\n\033[1m%s\033[0m\n" "$*"; }
pass() { echo "✅ $*"; }
fail() { echo "❌ $*"; STATE_OK=false; }
info() { echo "ℹ️  $*"; }

# L0 — Host Infra (Postgres ports)
section "L0 — Host Infra"
for p in 5433 5434 5435 5436 5437 5438 5439 5440; do
  nc -z -w2 127.0.0.1 "$p" 2>/dev/null && pass "Postgres $p" || fail "Postgres $p"
done

# L1 — Pod → Host DB
section "L1 — Pod DB Reachability"
POD=$(kubectl get pod -n "$NS" -l app=analytics-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
[[ -z "$POD" ]] && POD=$(kubectl get pod -n "$NS" -l app=api-gateway -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [[ -n "$POD" ]]; then
  kubectl exec -n "$NS" "$POD" -- sh -c "nc -z -w2 host.docker.internal 5433" 2>/dev/null && pass "Pod→records DB" || fail "Pod→records DB"
else
  fail "No pod in $NS for L1 check"
fi

# L2 — API Gateway health (in-cluster)
section "L2 — API Gateway"
if kubectl get deploy api-gateway -n "$NS" >/dev/null 2>&1; then
  GW_POD="curl-gw-$$"
  kubectl run "$GW_POD" --restart=Never -n "$NS" --image=curlimages/curl:latest -- \
    curl -sf --connect-timeout 3 --max-time 5 "http://api-gateway.${NS}.svc.cluster.local:4000/healthz" -o /dev/null 2>/dev/null || true
  sleep 6
  PHASE=$(kubectl get pod "$GW_POD" -n "$NS" -o jsonpath='{.status.phase}' 2>/dev/null || echo "Unknown")
  kubectl delete pod "$GW_POD" -n "$NS" --ignore-not-found --request-timeout=5s 2>/dev/null || true
  [[ "$PHASE" == "Succeeded" ]] && pass "API Gateway healthy" || fail "API Gateway unhealthy"
else
  fail "api-gateway deployment not found"
fi

# L3 — TLS (Caddy; needs TARGET_IP or record.local resolve)
section "L3 — TLS Chain"
TARGET_IP="${TARGET_IP:-}"
[[ -z "$TARGET_IP" ]] && TARGET_IP=$(kubectl -n "$NS_ING" get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
if [[ -n "$TARGET_IP" ]] && [[ -f "$REPO_ROOT/certs/dev-root.pem" ]]; then
  curl -sf --connect-timeout 5 --max-time 10 --http2 --cacert "$REPO_ROOT/certs/dev-root.pem" \
    --resolve "record.local:443:${TARGET_IP}" "https://record.local/_caddy/healthz" -o /dev/null 2>/dev/null && pass "TLS valid" || fail "TLS invalid"
else
  info "Skipped (no TARGET_IP or certs/dev-root.pem)"
fi

# L4 — HTTP/3 (optional; host curl must support --http3)
section "L4 — HTTP/3"
if [[ -n "$TARGET_IP" ]] && [[ -f "$REPO_ROOT/certs/dev-root.pem" ]]; then
  if curl --help all 2>/dev/null | grep -q -- "--http3"; then
    curl -sf --connect-timeout 5 --max-time 10 --http3-only --cacert "$REPO_ROOT/certs/dev-root.pem" \
      --resolve "record.local:443:${TARGET_IP}" "https://record.local/_caddy/healthz" -o /dev/null 2>/dev/null && pass "HTTP/3 working" || fail "HTTP/3 failing"
  else
    info "Skipped (curl lacks --http3)"
  fi
else
  info "Skipped (no TARGET_IP)"
fi

section "Preflight State Result"
if [[ "$STATE_OK" == "true" ]]; then
  pass "Preflight PASSED (all layers OK)"
  exit 0
else
  fail "Preflight FAILED (see failed layer above)"
  exit 1
fi
