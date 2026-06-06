#!/usr/bin/env bash
# Assert certificate SAN includes expected hostname (record-platform.test by default; avoids .local mDNS).
# Verifies SNI routing and cert issuance; no wildcard masking.
# Usage: ./scripts/http3-assert-cert-san.sh

set -euo pipefail

EXPECTED_HOST="${HTTP3_EXPECTED_HOST:-record-platform.test}"
LB_IP="${TARGET_IP:-127.0.0.1}"
PORT="${PORT:-443}"

CERT=$(echo | \
  openssl s_client \
    -connect "${LB_IP}:${PORT}" \
    -servername "${EXPECTED_HOST}" \
    -alpn h3 \
    2>/dev/null | \
  openssl x509 -noout -text 2>/dev/null || true)

if [[ -z "$CERT" ]]; then
  echo "❌ Could not retrieve certificate from ${LB_IP}:${PORT} (SNI ${EXPECTED_HOST})"
  exit 1
fi

if ! echo "$CERT" | grep -q "DNS:${EXPECTED_HOST}"; then
  echo "❌ Certificate SAN does not include ${EXPECTED_HOST}"
  exit 1
fi

echo "✅ Certificate SAN includes ${EXPECTED_HOST}"
