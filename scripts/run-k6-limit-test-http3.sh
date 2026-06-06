#!/usr/bin/env bash
set -euo pipefail

# k6 HTTP/3 Limit Test Runner with Strict TLS and Pod Count Reporting
# Incrementally increases VUs by 10 until failure

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

# Add to keychain if on macOS
if [[ "$(uname)" == "Darwin" ]]; then
  if ! security find-certificate -c "dev-root-ca" -a /Library/Keychains/System.keychain >/dev/null 2>&1; then
    echo "=== Adding CA certificate to macOS Keychain ==="
    sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "$CA_CERT" 2>&1 || {
      echo "⚠️  Failed to add to keychain (may need sudo password)"
    }
  fi
fi

export SSL_CERT_FILE="$CA_CERT"

# Get pod counts
echo ""
echo "=== Current Service Pod Counts ==="
POD_COUNTS_JSON=$(kubectl -n record-platform get deployments -o json 2>/dev/null | jq -r '{deployments: [.items[] | {name: .metadata.name, replicas: .spec.replicas, ready: .status.readyReplicas}]}')
CADDY_REPLICAS=$(kubectl -n ingress-nginx get deployment caddy-h3 -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "0")
CADDY_READY=$(kubectl -n ingress-nginx get deployment caddy-h3 -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
POD_COUNTS_JSON=$(echo "$POD_COUNTS_JSON" | jq ".deployments += [{\"name\": \"caddy-h3\", \"namespace\": \"ingress-nginx\", \"replicas\": ${CADDY_REPLICAS}, \"ready\": ${CADDY_READY}}]")
echo "$POD_COUNTS_JSON" | jq -r '.deployments[] | "\(.name): \(.replicas)/\(.ready)"'
echo ""

# Run limit test (increment by 10 VUs)
START_VUS="${START_VUS:-10}"
MAX_VUS="${MAX_VUS:-50}"
INCREMENT="${INCREMENT:-10}"
DURATION="${DURATION:-2m}"

echo "=== Running HTTP/3 Limit Test (increment by ${INCREMENT} VUs) ==="
echo "Starting at ${START_VUS} VUs, max ${MAX_VUS} VUs, ${DURATION} per test"
echo "Note: HTTP/3 requires custom k6 binary or will fall back to HTTP/2"
echo ""

RESULTS_FILE="/tmp/k6-http3-limit-test-$(date +%Y%m%d-%H%M%S).log"
echo "Test Results: $RESULTS_FILE" > "$RESULTS_FILE"
echo "Pod Counts: $POD_COUNTS_JSON" >> "$RESULTS_FILE"
echo "" >> "$RESULTS_FILE"

for vus in $(seq "$START_VUS" "$INCREMENT" "$MAX_VUS"); do
  echo "=== Testing with $vus VUs (HTTP/3) ===" | tee -a "$RESULTS_FILE"
  
  SSL_CERT_FILE="$CA_CERT" k6 run \
    --vus "$vus" \
    --duration "$DURATION" \
    -e BASE_URL="${BASE_URL:-https://record.local:30443}" \
    -e HOST="${HOST:-record.local}" \
    -e HTTP_VERSION=HTTP/3 \
    -e POD_COUNTS="$POD_COUNTS_JSON" \
    scripts/load/k6-all-services-comprehensive.js 2>&1 | tee -a "$RESULTS_FILE" | tail -15 | grep -E "http_req_failed|http_reqs|success_rate|error" | head -10
  
  sleep 5
done

echo ""
echo "=== Limit Test Complete ==="
echo "Results: $RESULTS_FILE"
