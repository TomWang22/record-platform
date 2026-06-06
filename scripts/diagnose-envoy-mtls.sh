#!/usr/bin/env bash
# Diagnose Envoy → backend mTLS: answer "Is auth-service plaintext or TLS?"
# Run from repo root. Uses in-cluster grpcurl so result is deterministic.
#
# If plaintext succeeds → service is plaintext → Envoy's TLS upstream will fail (remote connection failure).
# If plaintext fails and TLS succeeds → service is TLS → debug cert/SAN/CA alignment next.
#
# Usage: ./scripts/diagnose-envoy-mtls.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

AUTH_SVC="auth-service.record-platform.svc.cluster.local:50051"
NS_RP="record-platform"
MAX_TIME=10

echo "=== Envoy ↔ backend mTLS diagnostic ==="
echo "Target: $AUTH_SVC (from inside cluster)"
echo ""

# Pre-check: auth-service pod ready?
if ! kubectl get pods -n "$NS_RP" -l app=auth-service --no-headers 2>/dev/null | grep -q Running; then
  echo "Warning: no auth-service pod Running in $NS_RP. Start auth-service first."
  echo ""
fi

# 1) Plaintext from inside cluster (one-liner that answers "does plaintext work?")
echo "Step 1: Plaintext to auth-service (from inside cluster, max-time ${MAX_TIME}s)"
echo "  grpcurl -plaintext -max-time $MAX_TIME $AUTH_SVC grpc.health.v1.Health/Check"
# Image entrypoint is grpcurl; pass only args (no extra "grpcurl" or we get "Too many arguments")
# Use -i only when needed; 2>&1 strips kubectl stdin warning from output
PLAIN=$(kubectl run grpcurl-mtls-diagnose --rm -i --restart=Never -n "$NS_RP" --image=fullstorydev/grpcurl -- \
  -plaintext -max-time "$MAX_TIME" "$AUTH_SVC" grpc.health.v1.Health/Check 2>&1) || true
if echo "$PLAIN" | grep -q '"status":"SERVING"'; then
  echo "  Result: PLAINTEXT WORKS"
  echo ""
  echo "  >>> Service is PLAINTEXT. Envoy is configured for TLS upstream."
  echo "  >>> That causes: upstream connect error / reset before headers / remote connection failure."
  echo ""
  echo "  Fix: Either (A) remove transport_socket from Envoy clusters (Envoy → plaintext),"
  echo "       or (B) ensure auth-service actually starts with TLS (mount service-tls, certs present)."
  exit 1
else
  echo "  Result: plaintext failed (expected if service is TLS)"
  echo "  Output: $(echo "$PLAIN" | grep -v "recorded in container" | grep -E "Failed to dial|deadline exceeded|status|SERVING" | head -2)"
  echo ""
fi

# 2) TLS with -insecure (skip server cert verification)
echo "Step 2: TLS to auth-service (-insecure, from inside cluster, max-time ${MAX_TIME}s)"
TLS_INSECURE=$(kubectl run grpcurl-mtls-diagnose2 --rm -i --restart=Never -n "$NS_RP" --image=fullstorydev/grpcurl -- \
  -insecure -max-time "$MAX_TIME" "$AUTH_SVC" grpc.health.v1.Health/Check 2>&1) || true
if echo "$TLS_INSECURE" | grep -q '"status":"SERVING"'; then
  echo "  Result: TLS (-insecure) WORKS → service is TLS-enabled."
  echo ""
  echo "  Next: Verify Envoy has client cert mounted and same CA as service (see docs/ENVOY_REAL_MTLS.md)."
  exit 0
else
  echo "  Result: TLS (-insecure) failed or not SERVING"
  echo "  Output: $(echo "$TLS_INSECURE" | grep -v "recorded in container" | grep -E "Failed to dial|deadline exceeded|status|SERVING" | head -2)"
  echo ""
  # If both failed with timeout/unreachable, result is inconclusive
  if echo "$PLAIN$TLS_INSECURE" | grep -qE "deadline exceeded|Failed to dial"; then
    echo "  >>> Inconclusive: both plaintext and TLS failed to connect (timeout/unreachable)."
    echo "  >>> auth-service may be down, not listening on 50051, or network blocked from one-off pod."
    echo "  >>> Use port-forward from host for a definitive answer (see below)."
    echo ""
  else
    echo "  If plaintext failed and TLS failed: check auth-service logs and service-tls secret/certs."
  fi
fi

echo ""
echo "Definitive check from host (port-forward):"
echo "  kubectl -n record-platform port-forward svc/auth-service 50051:50051"
echo "  # In another terminal (auth-service is TLS; use -insecure so plaintext doesn't kill the forward):"
echo "  grpcurl -insecure -max-time 5 localhost:50051 grpc.health.v1.Health/Check"
echo ""
echo "One-liner (port-forward in background, then grpcurl with TLS; use 127.0.0.1 to avoid IPv6):"
echo "  kubectl -n record-platform port-forward svc/auth-service 50051:50051 &"
echo "  sleep 4"
echo "  grpcurl -insecure -max-time 10 127.0.0.1:50051 grpc.health.v1.Health/Check"
echo "  kill %1 2>/dev/null"
echo ""
echo "Or run the helper script (waits for port, then grpcurl):"
echo "  ./scripts/grpcurl-auth-service.sh"
