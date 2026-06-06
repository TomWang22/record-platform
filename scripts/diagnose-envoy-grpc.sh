#!/usr/bin/env bash
# Diagnose gRPC via Caddy → Envoy → backend chain.
# Use when: "gRPC via LB IP fails" with "upstream connect error or disconnect/reset before headers".
#
# Exposes Envoy admin (port 15000) temporarily to inspect:
#   - /clusters  → Is auth_service cluster present? Healthy?
#   - /config_dump → What SNI/TLS context is configured?
#
# Prereqs: Envoy deploy must have admin on 0.0.0.0:15000 (see infra/k8s/base/envoy-test/deploy.yaml).
# Usage: ./scripts/diagnose-envoy-grpc.sh [--save DIR]

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SAVE_DIR=""
[[ "${1:-}" == "--save" ]] && [[ -n "${2:-}" ]] && SAVE_DIR="$2"

# Always use envoy-test (Envoy runs here); ignore NS env from preflight/record-platform
ENVOY_NS="${ENVOY_NS:-envoy-test}"
POD=""
PF_PID=""

cleanup() {
  [[ -n "$PF_PID" ]] && kill "$PF_PID" 2>/dev/null || true
}
trap cleanup EXIT

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; }

# Colima/k3d kubectl shim
_kb() {
  ctx=$(kubectl config current-context 2>/dev/null || echo "")
  if [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
    colima ssh -- kubectl --request-timeout=10s "$@" 2>/dev/null || true
  else
    kubectl --request-timeout=10s "$@" 2>/dev/null || true
  fi
}

say "=== Envoy gRPC Diagnostic ==="
echo "Namespace: $ENVOY_NS"
echo ""

# Get Envoy pod
POD=$(_kb -n "$ENVOY_NS" get pod -l app=envoy-test -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
if [[ -z "$POD" ]]; then
  fail "No envoy-test pod in $ENVOY_NS"
  _kb -n "$ENVOY_NS" get pods -l app=envoy-test 2>/dev/null || true
  exit 1
fi
ok "Envoy pod: $POD"

# Check if admin port is exposed (deploy must have admin on 15000)
ADMIN_PORT=$(_kb -n "$ENVOY_NS" get pod "$POD" -o jsonpath='{.spec.containers[0].ports[?(@.name=="admin")].containerPort}' 2>/dev/null || true)
if [[ -z "$ADMIN_PORT" ]] || [[ "$ADMIN_PORT" != "15000" ]]; then
  warn "Envoy may not have admin on 15000. Re-apply: kubectl apply -k infra/k8s/base/envoy-test"
  echo "  Current ports:"
  _kb -n "$ENVOY_NS" get pod "$POD" -o jsonpath='{.spec.containers[0].ports}' | jq -r '.[].name' 2>/dev/null || true
fi

say "Starting port-forward (admin 15000:15000)..."
kubectl -n "$ENVOY_NS" port-forward "deploy/envoy-test" 15000:15000 &
PF_PID=$!
sleep 3
if ! kill -0 "$PF_PID" 2>/dev/null; then
  fail "Port-forward failed. Is Envoy admin exposed on 15000?"
  exit 1
fi
ok "Port-forward active (kill on exit)"

say "Fetching Envoy /clusters..."
CLUSTERS=$(curl -sS --max-time 10 http://localhost:15000/clusters 2>/dev/null || echo "")
if [[ -z "$CLUSTERS" ]]; then
  fail "Could not fetch /clusters (curl failed or empty)"
  echo "  Try: curl -s http://localhost:15000/clusters"
  exit 1
fi

if echo "$CLUSTERS" | grep -q "auth_service"; then
  ok "auth_service cluster present"
  echo "  auth_service excerpt:"
  echo "$CLUSTERS" | grep -A 5 "auth_service" | head -20
else
  warn "auth_service cluster NOT found in /clusters"
fi

say "Fetching Envoy /config_dump..."
CONFIG=$(curl -sS --max-time 10 "http://localhost:15000/config_dump?include_eds" 2>/dev/null || echo "")
if [[ -z "$CONFIG" ]]; then
  warn "Could not fetch /config_dump"
else
  ok "config_dump retrieved"
  if echo "$CONFIG" | grep -q "sni:"; then
    echo "  SNI (sample):"
    echo "$CONFIG" | grep -o '"sni":"[^"]*"' | head -5
  fi
  if echo "$CONFIG" | grep -qE "tls_certificates|tlsCertificates|certificate_chain|certificateChain|envoy\.crt|/etc/certs/client"; then
    ok "Upstream TLS with tls_certificates (mTLS client cert) configured"
  elif _kb -n "$ENVOY_NS" get pod "$POD" -o jsonpath='{.spec.containers[0].volumeMounts}' 2>/dev/null | grep -q "envoy-client"; then
    # config_dump may encode TLS in base64; volume mount confirms deploy has mTLS
    ok "Envoy has envoy-client volume (mTLS); config_dump may encode TLS in binary"
  else
    warn "tls_certificates not found; envoy-client volume missing?"
    echo "  Run: ./scripts/strict-tls-bootstrap.sh then: kubectl -n envoy-test rollout restart deploy/envoy-test"
  fi
fi

# Save if requested
if [[ -n "$SAVE_DIR" ]]; then
  mkdir -p "$SAVE_DIR"
  echo "$CLUSTERS" > "$SAVE_DIR/envoy-clusters.txt"
  echo "$CONFIG" > "$SAVE_DIR/envoy-config-dump.json"
  ok "Saved to $SAVE_DIR/"
fi

say "=== Summary ==="
echo "If auth_service is present but gRPC still fails:"
echo "  1. SNI per cluster = backend FQDN (auth-service.record-platform.svc.cluster.local, etc.)"
echo "  2. service-tls must have all gRPC service SANs: ./scripts/ensure-strict-tls-mtls-preflight.sh"
echo "  3. Envoy must present client cert (envoy-client-tls): ./scripts/strict-tls-bootstrap.sh"
echo ""
echo "See: docs/RCA-GRPC-CADDY-ENVOY-TLS.md, docs/ENVOY_REAL_MTLS.md"
