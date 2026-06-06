#!/usr/bin/env bash
# Push TLS handshake (and optional protocol) metrics to Prometheus Pushgateway.
# Usage: ./scripts/push-tls-metrics.sh <handshake_seconds> [protocol]
# Example: ./scripts/push-tls-metrics.sh 0.084 h3
# Set PUSHGATEWAY_URL (default http://localhost:9091) and JOB= (default tls_tests).
set -euo pipefail

HANDSHAKE_TIME="${1:?usage: $0 <handshake_seconds> [protocol]}"
PROTOCOL="${2:-h2}"
PUSHGATEWAY_URL="${PUSHGATEWAY_URL:-http://localhost:9091}"
JOB="${PUSHGATEWAY_JOB:-tls_tests}"

if ! curl -sf --connect-timeout 2 -o /dev/null "$PUSHGATEWAY_URL" 2>/dev/null; then
  echo "Pushgateway not reachable at $PUSHGATEWAY_URL (set PUSHGATEWAY_URL or start Pushgateway)" >&2
  exit 1
fi

# Push metric: tls_handshake_seconds{protocol="h3"} 0.084
printf 'tls_handshake_seconds{protocol="%s"} %s\n' "$PROTOCOL" "$HANDSHAKE_TIME" \
  | curl -sS --data-binary @- "${PUSHGATEWAY_URL}/metrics/job/${JOB}" || {
  echo "Failed to push TLS metric to Pushgateway" >&2
  exit 1
}

echo "Pushed tls_handshake_seconds{protocol=$PROTOCOL} $HANDSHAKE_TIME to $PUSHGATEWAY_URL"
