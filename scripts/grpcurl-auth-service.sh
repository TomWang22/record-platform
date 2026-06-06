#!/usr/bin/env bash
# Run grpcurl to auth-service gRPC via port-forward. Uses 127.0.0.1 and waits for
# the forward to be ready so we don't race. auth-service speaks TLS; use -insecure
# (or -cacert) so we don't kill the forward with plaintext.
#
# Note: run-preflight-scale-and-all-suites.sh uses MetalLB (Caddy LB IP:443) for gRPC,
# i.e. client → Caddy:LB_IP:443 → Envoy (h2c) → auth-service (mTLS). The "remote
# connection failure" is on the Envoy → auth-service leg. This script is for local
# diagnosis only (direct to auth-service); fixing mTLS (Envoy client cert) fixes the
# suite when it hits the LB IP.
#
# Usage: ./scripts/grpcurl-auth-service.sh

set -euo pipefail

NS="${NS:-record-platform}"
PORT="${PORT:-50051}"
MAX_TIME="${MAX_TIME:-10}"

echo "Starting port-forward to auth-service (background)..."
kubectl -n "$NS" port-forward svc/auth-service "$PORT:$PORT" &
PF_PID=$!
trap 'kill $PF_PID 2>/dev/null || true' EXIT

echo "Waiting for 127.0.0.1:$PORT to be reachable..."
for i in $(seq 1 20); do
  if nc -z 127.0.0.1 $PORT 2>/dev/null; then
    break
  fi
  sleep 1
done
# Give the forward a moment to stabilize
sleep 2

echo "Running grpcurl -insecure 127.0.0.1:$PORT grpc.health.v1.Health/Check"
grpcurl -insecure -max-time "$MAX_TIME" "127.0.0.1:$PORT" grpc.health.v1.Health/Check
