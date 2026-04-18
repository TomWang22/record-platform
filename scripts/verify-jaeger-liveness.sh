#!/usr/bin/env bash
set -euo pipefail

: "${JAEGER_QUERY_BASE:?Must set JAEGER_QUERY_BASE}"

base="${JAEGER_QUERY_BASE%/}"
attempts="${JAEGER_LIVENESS_ATTEMPTS:-10}"
sleep_sec="${JAEGER_LIVENESS_SLEEP_SEC:-3}"

echo "Checking Jaeger liveness (${base}/api/services)..."
for i in $(seq 1 "$attempts"); do
  if curl -sf --max-time 10 "${base}/api/services" >/dev/null; then
    echo "✅ Jaeger query API reachable"
    exit 0
  fi
  echo "Waiting for Jaeger (attempt ${i}/${attempts})..."
  [[ "$i" -lt "$attempts" ]] && sleep "$sleep_sec"
done

echo "❌ Jaeger unreachable after retries"
exit 1
