#!/usr/bin/env bash
# Diagnostic: verify Caddy → Envoy gRPC path.
# Run when gRPC via LB fails. Confirms: Envoy svc/port, Caddy upstream, Caddy→Envoy connectivity.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "  ✅ $*"; }
warn() { echo "  ⚠️  $*"; }
fail() { echo "  ❌ $*" >&2; }
info() { echo "  ℹ️  $*"; }

say "=== Caddy → Envoy gRPC Diagnostic ==="

# 1. Envoy service
say "1. Envoy service (envoy-test namespace)"
if kubectl get svc -n envoy-test envoy-test --request-timeout=5s 2>/dev/null; then
  kubectl -n envoy-test get svc envoy-test -o custom-columns='NAME:.metadata.name,TYPE:.spec.type,PORT:.spec.ports[0].port,TARGET:.spec.ports[0].targetPort' --no-headers 2>/dev/null | sed 's/^/  /' || true
  ok "Envoy service exists (expect port 10000)"
else
  fail "Envoy service not found in envoy-test"
fi

# 2. Envoy pod
say "2. Envoy pod"
ENVOY_POD=$(kubectl -n envoy-test get pods -l app=envoy-test -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [[ -n "$ENVOY_POD" ]]; then
  ok "Envoy pod: $ENVOY_POD"
  kubectl -n envoy-test get pod "$ENVOY_POD" -o custom-columns='NAME:.metadata.name,STATUS:.status.phase,READY:.status.containerStatuses[0].ready' --no-headers 2>/dev/null | sed 's/^/  /'
else
  fail "No Envoy pod found"
fi

# 3. Caddy live config (verify upstream)
say "3. Caddy live config (gRPC upstream)"
CADDY_CFG=$(kubectl -n ingress-nginx exec deploy/caddy-h3 -- cat /etc/caddy/Caddyfile 2>/dev/null || echo "")
if echo "$CADDY_CFG" | grep -q "envoy-test.envoy-test.svc.cluster.local:10000"; then
  ok "Caddy upstream: envoy-test.envoy-test.svc.cluster.local:10000"
else
  warn "Caddy upstream may not match; expected envoy-test.envoy-test.svc.cluster.local:10000"
  echo "$CADDY_CFG" | grep -E "envoy|@grpc|reverse_proxy" | head -20 | sed 's/^/  /'
fi

# 4. Cluster → Envoy connectivity (ephemeral pod; Caddy image has no curl)
say "4. Cluster → Envoy connectivity (ephemeral curl pod)"
BODY=$(kubectl run caddy-envoy-diag-$$ --rm -i --restart=Never -n ingress-nginx --image=curlimages/curl:latest --overrides='{"spec":{"terminationGracePeriodSeconds":0}}' -- curl -sS -w "\n%{http_code}" --http2-prior-knowledge --max-time 5 http://envoy-test.envoy-test.svc.cluster.local:10000 2>&1 || echo "exec failed")
HTTP_CODE=$(echo "$BODY" | tail -1)
RESP=$(echo "$BODY" | head -n -1)
if echo "$BODY" | grep -qE "Connection refused|could not resolve|No route to host|Connection timed out"; then
  fail "Cluster cannot reach Envoy :10000 (Caddy would also fail)"
  echo "  $BODY"
elif [[ "$HTTP_CODE" == "400" ]] || [[ "$HTTP_CODE" == "503" ]]; then
  if echo "$RESP" | grep -q "CERTIFICATE_VERIFY_FAILED"; then
    warn "Envoy reachable but returns 503 (Envoy→backend mTLS failed: CERTIFICATE_VERIFY_FAILED)"
    info "Cause: envoy-test has stale CA/client cert (rotation suite didn't sync envoy-test)."
    info "Fix: Re-run rotation with ROTATE_CA=1 to persist CA key and sync envoy-test."
    info "     Or, if certs/dev-root.key exists: ./scripts/generate-envoy-client-cert.sh && ./scripts/strict-tls-bootstrap.sh"
  else
    ok "Cluster reached Envoy :10000 (HTTP $HTTP_CODE; 400=OK for GET on gRPC port)"
  fi
  echo "  HTTP $HTTP_CODE"
elif [[ -n "$HTTP_CODE" ]] && [[ "$HTTP_CODE" =~ ^[0-9]+$ ]]; then
  ok "Cluster reached Envoy :10000 (HTTP $HTTP_CODE)"
else
  echo "  $BODY"
fi

# 5. In-cluster grpcurl (ephemeral pod)
say "5. In-cluster grpcurl → Envoy :10000"
OUT=$(kubectl run grpc-envoy-diag-$$ --rm -i --restart=Never --image=fullstorydev/grpcurl -n record-platform --overrides='{"spec":{"terminationGracePeriodSeconds":0}}' -- grpcurl -plaintext -max-time 5 envoy-test.envoy-test.svc.cluster.local:10000 grpc.health.v1.Health/Check 2>&1 || echo "grpcurl failed")
if echo "$OUT" | grep -q "SERVING"; then
  ok "In-cluster grpcurl → Envoy: SERVING"
elif echo "$OUT" | grep -qE "Connection refused|could not connect"; then
  fail "In-cluster cannot reach Envoy :10000"
  echo "$OUT" | tail -5 | sed 's/^/  /'
else
  warn "grpcurl output: $OUT"
fi

say "=== Diagnostic complete ==="
info "If step 4 or 5 fails: Caddy → Envoy path is broken. Verify: kubectl -n envoy-test get svc, get pods; ensure envoy-test listens on 10000."
