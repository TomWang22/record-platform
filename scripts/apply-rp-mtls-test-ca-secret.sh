#!/usr/bin/env bash
# Ensure dev mTLS test CA exists on disk and as K8s secret for caddy-h3 (Caddyfile client_auth + /mtls-healthz).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${NAMESPACE_INGRESS:-ingress-nginx}"
SECRET_NAME="${RP_MTLS_TEST_CA_SECRET:-rp-mtls-test-ca}"
CERT_DIR="${RP_MTLS_TEST_CERT_DIR:-$REPO_ROOT/certs/mtls-test}"
CA_FILE="$CERT_DIR/mtls-test-ca.pem"

chmod +x "$SCRIPT_DIR/generate-rp-mtls-test-certs.sh" 2>/dev/null || true
bash "$SCRIPT_DIR/generate-rp-mtls-test-certs.sh"

[[ -f "$CA_FILE" ]] || { echo "ERROR: missing $CA_FILE after generate-rp-mtls-test-certs.sh" >&2; exit 1; }

kubectl create namespace "$NS" --dry-run=client -o yaml | kubectl apply -f - >/dev/null

kubectl -n "$NS" create secret generic "$SECRET_NAME" \
  --from-file=mtls-test-ca.pem="$CA_FILE" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "✅ secret/$SECRET_NAME in namespace $NS (mtls-test-ca.pem → /etc/caddy/mtls-test/mtls-test-ca.pem)"
