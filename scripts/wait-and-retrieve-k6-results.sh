#!/usr/bin/env bash
set -euo pipefail

# Wait for k6 job to complete and retrieve results

JOB_NAME="${1:-k6-shopping-ramp-1765149041}"
NS_K6="${NS_K6:-k6-load}"
TIMESTAMP="${2:-1765149041}"
TEST_NAME="${3:-shopping-ramp}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

RESULTS_DIR="scripts/load/results/shopping-${TEST_NAME}"
mkdir -p "$RESULTS_DIR"
SUMMARY_JSON="${RESULTS_DIR}/${TEST_NAME}-${TIMESTAMP}.json"
OUTPUT_LOG="${RESULTS_DIR}/${TEST_NAME}-${TIMESTAMP}.txt"

say "Waiting for k6 job to complete: $JOB_NAME"

# Wait for job to complete
MAX_WAIT=1800  # 30 minutes
ELAPSED=0
while [[ $ELAPSED -lt $MAX_WAIT ]]; do
  if kubectl -n "$NS_K6" get job "$JOB_NAME" >/dev/null 2>&1; then
    STATUS=$(kubectl -n "$NS_K6" get job "$JOB_NAME" -o jsonpath='{.status.conditions[?(@.type=="Complete")].status}' 2>/dev/null || echo "False")
    if [[ "$STATUS" == "True" ]]; then
      ok "Job completed!"
      break
    fi
    # Show progress
    POD=$(kubectl -n "$NS_K6" get pods -l job-name="$JOB_NAME" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
    if [[ -n "$POD" ]]; then
      kubectl -n "$NS_K6" logs "$POD" --tail=2 2>&1 | grep -E "running|VUs" | tail -1 || true
    fi
  else
    warn "Job not found - may have completed or been deleted"
    break
  fi
  sleep 30
  ELAPSED=$((ELAPSED + 30))
done

# Get pod name
POD_NAME=$(kubectl -n "$NS_K6" get pods -l job-name="$JOB_NAME" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")

if [[ -z "$POD_NAME" ]]; then
  warn "Pod not found - retrieving from job logs"
  kubectl -n "$NS_K6" logs -l job-name="$JOB_NAME" --tail=200 > "$OUTPUT_LOG" 2>&1 || true
else
  say "Retrieving results from pod: $POD_NAME"
  
  # Copy results
  if kubectl -n "$NS_K6" cp "${POD_NAME}:/results/output.txt" "$OUTPUT_LOG" >/dev/null 2>&1; then
    ok "Output log saved to: $OUTPUT_LOG"
  else
    warn "Could not copy output log, getting from logs"
    kubectl -n "$NS_K6" logs "$POD_NAME" > "$OUTPUT_LOG" 2>&1 || true
  fi
  
  if kubectl -n "$NS_K6" cp "${POD_NAME}:/results/final-summary.json" "$SUMMARY_JSON" >/dev/null 2>&1; then
    ok "Summary JSON saved to: $SUMMARY_JSON"
  else
    warn "Could not copy summary JSON"
  fi
fi

# Generate latency graph if summary exists
if [[ -f "$SUMMARY_JSON" ]]; then
  say "Generating latency graph..."
  GRAPH_OUTPUT="${RESULTS_DIR}/${TEST_NAME}-${TIMESTAMP}-latency.html"
  if [[ -f "scripts/load/generate-latency-graph.py" ]]; then
    if python3 scripts/load/generate-latency-graph.py "$SUMMARY_JSON" "$GRAPH_OUTPUT" 2>/dev/null; then
      ok "Latency graph generated: $GRAPH_OUTPUT"
      say "Open the report: open $GRAPH_OUTPUT"
    else
      warn "Could not generate latency graph"
    fi
  fi
fi

# Show summary from output
say "Test Summary:"
if [[ -f "$OUTPUT_LOG" ]]; then
  grep -A 50 "Shopping Service" "$OUTPUT_LOG" | head -30 || tail -50 "$OUTPUT_LOG"
fi

say "Results saved to: $RESULTS_DIR"

