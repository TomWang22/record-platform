#!/usr/bin/env bash
# Idempotent prep before caddy-h3 rollout: config sync, TLS/CA/mTLS secrets, edge image in Colima.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
NS="${NAMESPACE_INGRESS:-ingress-nginx}"
TLS_SECRET="${TLS_SECRET:-record-platform-local-tls}"
CADDY_IMAGE="${RP_CADDY_EDGE_IMAGE:-caddy-with-tcpdump:dev}"

# shellcheck source=lib/rp-colima-running.sh
source "$SCRIPT_DIR/lib/rp-colima-running.sh"

cd "$REPO_ROOT"

echo "▶ prepare-caddy-edge-rollout (image=$CADDY_IMAGE ns=$NS)"

chmod +x "$SCRIPT_DIR/sync-caddy-h3-configmap.sh" \
  "$SCRIPT_DIR/apply-rp-mtls-test-ca-secret.sh" \
  "$SCRIPT_DIR/generate-rp-mtls-test-certs.sh" 2>/dev/null || true
bash "$SCRIPT_DIR/sync-caddy-h3-configmap.sh"

kubectl create namespace "$NS" --dry-run=client -o yaml | kubectl apply -f - >/dev/null

if ! kubectl get secret "$TLS_SECRET" -n "$NS" &>/dev/null; then
  echo "❌ Missing secret $TLS_SECRET in $NS — run ./scripts/strict-tls-bootstrap.sh (B.crypto)" >&2
  exit 1
fi
if ! kubectl get secret dev-root-ca -n "$NS" &>/dev/null; then
  echo "❌ Missing secret dev-root-ca in $NS — run ./scripts/strict-tls-bootstrap.sh" >&2
  exit 1
fi
bash "$SCRIPT_DIR/apply-rp-mtls-test-ca-secret.sh"

kubectl -n "$NS" create configmap caddy-h3 \
  --from-file=Caddyfile="$REPO_ROOT/Caddyfile" \
  --dry-run=client -o yaml | kubectl apply -f -

if ! docker image inspect "$CADDY_IMAGE" >/dev/null 2>&1; then
  echo "  ▶ build $CADDY_IMAGE on host Docker"
  REPO_ROOT="$REPO_ROOT" bash "$SCRIPT_DIR/rp-build-required-images.sh"
fi
if ! docker image inspect "$CADDY_IMAGE" >/dev/null 2>&1; then
  echo "❌ host Docker missing $CADDY_IMAGE after build" >&2
  exit 1
fi

if rp_colima_is_running; then
  if ! colima ssh -- docker image inspect "$CADDY_IMAGE" >/dev/null 2>&1; then
    echo "  ▶ load $CADDY_IMAGE into Colima VM Docker"
    docker save "$CADDY_IMAGE" | colima ssh -- docker load
  fi
  colima ssh -- docker image inspect "$CADDY_IMAGE" >/dev/null 2>&1 \
    || { echo "❌ $CADDY_IMAGE not visible in Colima after docker load" >&2; exit 1; }
  echo "✅ $CADDY_IMAGE present in Colima VM Docker"
else
  echo "ℹ️  Colima not running — skip VM image load (k3s must pull $CADDY_IMAGE another way)"
fi

echo "✅ prepare-caddy-edge-rollout complete (secrets: $TLS_SECRET, dev-root-ca, rp-mtls-test-ca)"
