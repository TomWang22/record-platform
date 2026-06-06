#!/usr/bin/env bash
# Diagnose Envoy gRPC listener mode and connectivity. Shows raw errors so we can see what's going on.
# Run from repo root. See docs/RCA-GRPC-CADDY-ENVOY-TLS.md.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
PF_PORT="${ENVOY_PF_PORT:-15000}"
CA_CERT="${CA_CERT:-$REPO_ROOT/certs/dev-root.pem}"

echo "=== 1. Envoy and auth-service (gRPC backend) status ==="
kubectl -n envoy-test get pods -l app=envoy-test -o wide 2>/dev/null || echo "  (kubectl or namespace failed)"
kubectl -n envoy-test get deploy envoy-test -o jsonpath='  envoy replicas: {.status.readyReplicas}/{.spec.replicas}' 2>/dev/null; echo ""
# Envoy routes grpc.health.v1.Health to auth_service; ensure auth-service has rolled out with GRPC_REQUIRE_CLIENT_CERT=false
echo "  Waiting for auth-service rollout (so gRPC backend has GRPC_REQUIRE_CLIENT_CERT=false)..."
kubectl -n record-platform rollout status deployment/auth-service --timeout=90s 2>/dev/null && echo "  auth-service rollout OK" || echo "  auth-service rollout wait failed or skipped"
AUTH_GRPC_ENV=$(kubectl -n record-platform get deploy auth-service -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="GRPC_REQUIRE_CLIENT_CERT")].value}' 2>/dev/null || echo "")
echo "  auth-service GRPC_REQUIRE_CLIENT_CERT=$AUTH_GRPC_ENV (must be false for Envoy without client cert)"

echo ""
echo "=== 2. Port-forward Envoy 10000 -> 127.0.0.1:$PF_PORT ==="
kubectl -n envoy-test port-forward deploy/envoy-test "${PF_PORT}:10000" 2>/tmp/envoy-pf-$$.err &
PF_PID=$!
for i in 1 2 3 4 5; do
  nc -z 127.0.0.1 "$PF_PORT" 2>/dev/null && break
  sleep 1
done
if ! nc -z 127.0.0.1 "$PF_PORT" 2>/dev/null; then
  echo "  Port-forward failed to bind. Stderr:"
  cat /tmp/envoy-pf-$$.err 2>/dev/null | sed 's/^/  /'
  kill $PF_PID 2>/dev/null; wait $PF_PID 2>/dev/null || true
  rm -f /tmp/envoy-pf-$$.err
  exit 1
fi
echo "  Forwarding OK"

echo ""
echo "=== 3. grpcurl -plaintext (raw output) ==="
PLAIN_OUT=$(grpcurl -plaintext -max-time 5 -d '{}' "127.0.0.1:${PF_PORT}" grpc.health.v1.Health/Check 2>&1) || true
echo "$PLAIN_OUT" | sed 's/^/  /'
PLAIN_OK=""
echo "$PLAIN_OUT" | grep -q -iE "SERVING|healthy|\"status\":\"SERVING\"" && PLAIN_OK=1

echo ""
echo "=== 4. grpcurl -cacert (raw output) ==="
if [[ -f "$CA_CERT" ]] && [[ -s "$CA_CERT" ]]; then
  TLS_OUT=$(grpcurl -cacert "$CA_CERT" -max-time 5 -d '{}' "127.0.0.1:${PF_PORT}" grpc.health.v1.Health/Check 2>&1) || true
  echo "$TLS_OUT" | sed 's/^/  /'
  TLS_OK=""
  echo "$TLS_OUT" | grep -q -iE "SERVING|healthy|\"status\":\"SERVING\"" && TLS_OK=1
else
  echo "  (skip: no CA at $CA_CERT)"
  TLS_OK=""
fi

echo ""
echo "=== 5. grpcurl -plaintext list (what does Envoy expose?) ==="
LIST_OUT=$(grpcurl -plaintext -max-time 3 "127.0.0.1:${PF_PORT}" list 2>&1) || true
echo "$LIST_OUT" | sed 's/^/  /'
# If list shows grpc.health.v1.Health but Check failed with "details" invalid map, connectivity is OK; proto mismatch.
LIST_OK=""
echo "$LIST_OUT" | grep -q "grpc.health.v1.Health" && LIST_OK=1
PROTO_DETAILS_ERR=""
echo "$PLAIN_OUT" | grep -q "HealthCheckResponse.details.*invalid map" && PROTO_DETAILS_ERR=1

echo ""
echo "=== 6. Envoy pod logs (last 20 lines) ==="
kubectl -n envoy-test logs deploy/envoy-test --tail=20 2>&1 | sed 's/^/  /' || echo "  (could not get logs)"

# If plaintext failed with upstream TLS_error, show auth-service (gRPC backend) state
if echo "$PLAIN_OUT" | grep -q -iE "upstream.*TLS_error|SSLV3_ALERT_HANDSHAKE_FAILURE"; then
  echo ""
  echo "=== 7. auth-service (gRPC backend) — relevant when upstream TLS_error ==="
  AUTH_POD=$(kubectl -n record-platform get pods -l app=auth-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  if [[ -n "$AUTH_POD" ]]; then
    echo "  Pod: $AUTH_POD"
    kubectl -n record-platform get pod "$AUTH_POD" -o jsonpath='  Age: {.metadata.creationTimestamp}' 2>/dev/null; echo ""
    RUNNING_GRPC=$(kubectl -n record-platform get pod "$AUTH_POD" -o jsonpath='{.spec.containers[0].env[?(@.name=="GRPC_REQUIRE_CLIENT_CERT")].value}' 2>/dev/null || echo "?")
    echo "  Running pod GRPC_REQUIRE_CLIENT_CERT=$RUNNING_GRPC (must be false for Envoy)"
    echo "  auth-service gRPC log lines:"
    kubectl -n record-platform logs "$AUTH_POD" --tail=30 2>&1 | grep -E "gRPC|TLS|Client cert|DISABLED|ENABLED" | sed 's/^/    /' || echo "    (none)"
  else
    echo "  (no auth-service pod found)"
  fi
fi

kill $PF_PID 2>/dev/null; wait $PF_PID 2>/dev/null || true
rm -f /tmp/envoy-pf-$$.err

echo ""
echo "=== Result ==="
if [[ -n "${PLAIN_OK:-}" ]] && [[ -z "${TLS_OK:-}" ]]; then
  echo "  Envoy listener is PLAINTEXT (Model A). Use h2c and -plaintext."
  echo "  gRPC Health/Check returned SERVING."
elif [[ -z "${PLAIN_OK:-}" ]] && [[ -n "${TLS_OK:-}" ]]; then
  echo "  Envoy listener is TLS (Model B). Use https upstream and -cacert."
elif [[ -n "${PLAIN_OK:-}" ]] && [[ -n "${TLS_OK:-}" ]]; then
  echo "  Both plaintext and TLS worked (unusual). Prefer plaintext for Model A."
elif [[ -n "${LIST_OK:-}" ]] && [[ -n "${PROTO_DETAILS_ERR:-}" ]]; then
  echo "  Connectivity OK (list shows grpc.health.v1.Health). Health/Check failed due to proto: HealthCheckResponse.details map."
  echo "  Fix: use standard health.proto (status only). Re-apply config + restart gRPC backends."
else
  echo "  Neither worked. Use the raw output above: connection refused, timeout, TLS error, or upstream error?"
  echo "  If TLS_error/SSLV3_ALERT: client TLS to plaintext listener or vice versa."
  echo "  If upstream ... CERTIFICATE_VERIFY_FAILED: Envoy's CA (dev-root-ca in envoy-test) is out of date; run: ./scripts/sync-envoy-tls-secrets.sh && kubectl -n envoy-test rollout restart deploy/envoy-test"
  echo "  If upstream ... TLS_error (handshake): Envoy->backend TLS; ensure gRPC backends have GRPC_REQUIRE_CLIENT_CERT=false and rollout completed."
  echo "  If connection refused: port-forward or Envoy not listening on 10000."
  echo "  If upstream/503: Envoy routes to backend; check auth-service (and others) gRPC pods."
fi
