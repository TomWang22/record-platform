#!/usr/bin/env bash
set -euo pipefail

# k6 Comprehensive Test Runner with Strict TLS and Pod Count Reporting
# Extracts CA certificate and runs k6 with strict TLS verification

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

# Extract CA certificate
echo "=== Extracting CA Certificate for Strict TLS ==="
CA_CERT="/tmp/k6-ca.crt"
kubectl -n record-platform get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' | base64 -d > "$CA_CERT" || {
  echo "❌ Failed to extract CA certificate"
  exit 1
}
echo "✅ CA certificate extracted to $CA_CERT"

# Add CA certificate to system trust store (macOS) for k6 strict TLS
# k6 uses Go's TLS library which respects system trust store
if [[ "$(uname)" == "Darwin" ]]; then
  echo "=== Adding CA certificate to macOS Keychain (for k6 strict TLS) ==="
  # Check if certificate already exists
  if security find-certificate -c "dev-root-ca" -a /Library/Keychains/System.keychain >/dev/null 2>&1; then
    echo "✅ CA certificate already in keychain"
  else
    sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "$CA_CERT" 2>&1 || {
      echo "⚠️  Failed to add to keychain (may need sudo password or manual addition)"
      echo "   You can add manually: sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain $CA_CERT"
    }
  fi
fi

# Also set SSL_CERT_FILE (k6 should respect this, but system trust store is more reliable)
export SSL_CERT_FILE="$CA_CERT"

# Get pod counts for all services
echo ""
echo "=== Current Service Pod Counts ==="
POD_COUNTS=$(kubectl -n record-platform get deployments -o json 2>/dev/null | jq -r '.items[] | "\(.metadata.name):\(.spec.replicas)/\(.status.readyReplicas)"' | sort)
echo "$POD_COUNTS"
echo ""

# Get Caddy pod count
CADDY_REPLICAS=$(kubectl -n ingress-nginx get deployment caddy-h3 -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "0")
CADDY_READY=$(kubectl -n ingress-nginx get deployment caddy-h3 -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
echo "Caddy (ingress-nginx): ${CADDY_REPLICAS}/${CADDY_READY}"
echo ""

# Export pod counts as JSON for k6
export POD_COUNTS_JSON=$(kubectl -n record-platform get deployments -o json 2>/dev/null | jq -r '{deployments: [.items[] | {name: .metadata.name, replicas: .spec.replicas, ready: .status.readyReplicas}]}')

# Add Caddy to pod counts
export POD_COUNTS_JSON=$(echo "$POD_COUNTS_JSON" | jq ".deployments += [{\"name\": \"caddy-h3\", \"namespace\": \"ingress-nginx\", \"replicas\": ${CADDY_REPLICAS}, \"ready\": ${CADDY_READY}}]")

# Run k6 with strict TLS
echo "=== Running k6 Comprehensive Test with Strict TLS ==="
SSL_CERT_FILE="$CA_CERT" k6 run \
  --vus "${K6_VUS:-50}" \
  --duration "${K6_DURATION:-5m}" \
  --out json="${K6_JSON_OUTPUT:-/tmp/k6-comprehensive-strict-tls.json}" \
  -e BASE_URL="${BASE_URL:-https://record.local:30443}" \
  -e HOST="${HOST:-record.local}" \
  -e POD_COUNTS="$POD_COUNTS_JSON" \
  scripts/load/k6-all-services-comprehensive.js 2>&1 | tee "${K6_LOG_OUTPUT:-/tmp/k6-comprehensive-strict-tls.log}"

echo ""
echo "=== Test Complete ==="
echo "Results: ${K6_JSON_OUTPUT:-/tmp/k6-comprehensive-strict-tls.json}"
echo "Log: ${K6_LOG_OUTPUT:-/tmp/k6-comprehensive-strict-tls.log}"
