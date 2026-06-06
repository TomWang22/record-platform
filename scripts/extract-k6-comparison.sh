#!/usr/bin/env bash
# Extract and compare HTTP/2 vs HTTP/3 results from k6 output files

H2_FILE="${1:-/tmp/k6-http2-results.txt}"
H3_FILE="${2:-/tmp/k6-http3-results.txt}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }

if [[ ! -f "$H2_FILE" ]] || [[ ! -f "$H3_FILE" ]]; then
  echo "Usage: $0 [http2-results.txt] [http3-results.txt]"
  exit 1
fi

say "=== HTTP/2 vs HTTP/3 Comparison ==="

# Extract HTTP/2 metrics
H2_REQUESTS=$(grep -E "http_reqs.*:" "$H2_FILE" | grep -oE '[0-9]+' | head -1 || echo "0")
H2_SUCCESS_RATE=$(grep -E "http2_success.*:" "$H2_FILE" | grep -oE '[0-9.]+%' | head -1 || echo "0%")
H2_AVG=$(grep -E "http2_latency_ms.*avg=" "$H2_FILE" | grep -oE 'avg=[0-9.]+' | cut -d= -f2 || echo "N/A")
H2_P90=$(grep -E "http2_latency_ms.*p\(90\)" "$H2_FILE" | grep -oE 'p\(90\)=[0-9.]+' | cut -d= -f2 || echo "N/A")
H2_P95=$(grep -E "http2_latency_ms.*p\(95\)" "$H2_FILE" | grep -oE 'p\(95\)=[0-9.]+' | cut -d= -f2 || echo "N/A")
H2_P99=$(grep -E "http2_latency_ms.*p\(99\)" "$H2_FILE" | grep -oE 'p\(99\)=[0-9.]+' | cut -d= -f2 || echo "N/A")

# Extract HTTP/3 metrics
H3_REQUESTS=$(grep -E "iterations.*:" "$H3_FILE" | grep -oE '[0-9]+' | head -1 || echo "0")
H3_SUCCESS_RATE=$(grep -E "http3_success.*:" "$H3_FILE" | grep -oE '[0-9.]+%' | head -1 || echo "0%")
H3_AVG=$(grep -E "http3_latency_ms.*avg=" "$H3_FILE" | grep -oE 'avg=[0-9.]+' | cut -d= -f2 || echo "N/A")
H3_P90=$(grep -E "http3_latency_ms.*p\(90\)" "$H3_FILE" | grep -oE 'p\(90\)=[0-9.]+' | cut -d= -f2 || echo "N/A")
H3_P95=$(grep -E "http3_latency_ms.*p\(95\)" "$H3_FILE" | grep -oE 'p\(95\)=[0-9.]+' | cut -d= -f2 || echo "N/A")
H3_P99=$(grep -E "http3_latency_ms.*p\(99\)" "$H3_FILE" | grep -oE 'p\(99\)=[0-9.]+' | cut -d= -f2 || echo "N/A")

echo ""
echo "=== HTTP/2 Results ==="
echo "Total Requests: $H2_REQUESTS"
echo "Success Rate: $H2_SUCCESS_RATE"
echo "Average Latency: ${H2_AVG}ms"
echo "p90 Latency: ${H2_P90}ms"
echo "p95 Latency: ${H2_P95}ms"
echo "p99 Latency: ${H2_P99}ms"

echo ""
echo "=== HTTP/3 Results ==="
echo "Total Requests: $H3_REQUESTS"
echo "Success Rate: $H3_SUCCESS_RATE"
echo "Average Latency: ${H3_AVG}ms"
echo "p90 Latency: ${H3_P90}ms"
echo "p95 Latency: ${H3_P95}ms"
echo "p99 Latency: ${H3_P99}ms"

echo ""
echo "=== Comparison ==="
if [[ "$H2_P95" != "N/A" ]] && [[ "$H3_P95" != "N/A" ]]; then
  H2_P95_NUM=$(echo "$H2_P95" | cut -d. -f1)
  H3_P95_NUM=$(echo "$H3_P95" | cut -d. -f1)
  if [[ "$H3_P95_NUM" -gt "$H2_P95_NUM" ]]; then
    DIFF=$((H3_P95_NUM - H2_P95_NUM))
    PERCENT=$(echo "scale=1; $DIFF * 100 / $H2_P95_NUM" | bc 2>/dev/null || echo "0")
    echo "⚠️  HTTP/3 p95 latency is ${DIFF}ms higher (${PERCENT}% slower) than HTTP/2"
  else
    DIFF=$((H2_P95_NUM - H3_P95_NUM))
    PERCENT=$(echo "scale=1; $DIFF * 100 / $H2_P95_NUM" | bc 2>/dev/null || echo "0")
    echo "✅ HTTP/3 p95 latency is ${DIFF}ms lower (${PERCENT}% faster) than HTTP/2"
  fi
fi

if [[ "$H2_AVG" != "N/A" ]] && [[ "$H3_AVG" != "N/A" ]]; then
  H2_AVG_NUM=$(echo "$H2_AVG" | cut -d. -f1)
  H3_AVG_NUM=$(echo "$H3_AVG" | cut -d. -f1)
  if [[ "$H3_AVG_NUM" -gt "$H2_AVG_NUM" ]]; then
    DIFF=$((H3_AVG_NUM - H2_AVG_NUM))
    PERCENT=$(echo "scale=1; $DIFF * 100 / $H2_AVG_NUM" | bc 2>/dev/null || echo "0")
    echo "⚠️  HTTP/3 average latency is ${DIFF}ms higher (${PERCENT}% slower) than HTTP/2"
  else
    DIFF=$((H2_AVG_NUM - H3_AVG_NUM))
    PERCENT=$(echo "scale=1; $DIFF * 100 / $H2_AVG_NUM" | bc 2>/dev/null || echo "0")
    echo "✅ HTTP/3 average latency is ${DIFF}ms lower (${PERCENT}% faster) than HTTP/2"
  fi
fi

