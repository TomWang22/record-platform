#!/usr/bin/env bash
set -euo pipefail

# Wrapper script to run k6 Python AI pipeline test with automatic pod cleanup
# Usage: ./scripts/run-k6-python-ai-with-cleanup.sh

NS="${NS:-record-platform}"
K6_POD_NAME="k6-python-ai-test"
SCRIPT_PATH="scripts/load/k6-python-ai-pipeline.js"

echo "🧪 Running k6 Python AI Pipeline Test"
echo "======================================"
echo ""

# Cleanup any existing pod
echo "🧹 Cleaning up any existing k6 pod..."
kubectl -n "$NS" delete pod "$K6_POD_NAME" --ignore-not-found=true 2>/dev/null || true
sleep 2

# Run k6 test
echo "🚀 Starting k6 test..."
echo "   Pod name: $K6_POD_NAME"
echo "   Namespace: $NS"
echo ""

# Run k6 test and capture output
# Use --rm flag but also ensure cleanup in finally block
# k6 handleSummary outputs both text and JSON, so we capture both
(
  kubectl -n "$NS" run "$K6_POD_NAME" \
    --rm -i --restart=Never \
    --image=grafana/k6:latest \
    -- run - < "$SCRIPT_PATH" 2>&1 | tee /tmp/k6-python-ai-output.log
) || true

EXIT_CODE=${PIPESTATUS[0]}

# Extract summary JSON if available (k6 handleSummary outputs it at the end)
if [ -f /tmp/k6-python-ai-output.log ]; then
  # Try to extract JSON from output (k6 handleSummary outputs JSON after text)
  # Look for the JSON object that starts with '{' and contains "summary.json" or "raw-data.json"
  awk '/^\{/,/^}$/' /tmp/k6-python-ai-output.log > /tmp/k6-summary.json 2>/dev/null || true
  if [ -s /tmp/k6-summary.json ] && grep -q '"summary"' /tmp/k6-summary.json 2>/dev/null; then
    # Valid JSON found, use it for graph generation
    echo "📊 Found k6 summary JSON, using for accurate percentile extraction"
  else
    # No JSON found, will use text parsing
    rm -f /tmp/k6-summary.json
  fi
fi

# ALWAYS ensure pod is deleted (even if --rm didn't work or test failed)
echo ""
echo "🧹 Ensuring pod cleanup..."
kubectl -n "$NS" delete pod "$K6_POD_NAME" --ignore-not-found=true --wait=false 2>/dev/null || true

# Wait a moment and verify deletion
sleep 2
if kubectl -n "$NS" get pod "$K6_POD_NAME" &>/dev/null; then
  echo "⚠️  Pod still exists, forcing deletion..."
  kubectl -n "$NS" delete pod "$K6_POD_NAME" --force --grace-period=0 2>/dev/null || true
  sleep 1
fi

# Generate graph if test completed
if [ $EXIT_CODE -eq 0 ] || [ -f /tmp/k6-python-ai-output.log ]; then
  echo ""
  echo "📊 Generating latency graph..."
  # Use JSON if available, otherwise use text output
  if [ -s /tmp/k6-summary.json ]; then
    python3 scripts/load/generate-latency-graph.py /tmp/k6-summary.json 2>&1 | tail -3
  else
    python3 scripts/load/generate-latency-graph.py /tmp/k6-python-ai-output.log 2>&1 | tail -3
  fi
fi

echo ""
echo "✅ Test complete (exit code: $EXIT_CODE)"
exit $EXIT_CODE

