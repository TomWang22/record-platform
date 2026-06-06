#!/usr/bin/env bash
set -euo pipefail

# Daily k6 shopping service load test runner
# Designed to run as a Kubernetes CronJob
# Automatically cleans up pods and jobs after completion

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

# Configuration
TEST_TYPE="${TEST_TYPE:-ramp}"  # Default to ramp test for daily runs
NS_K6="${NS_K6:-k6-load}"
HOST="${HOST:-record.local}"

# Use ClusterIP FQDN for in-cluster k6 testing
SHOPPING_URL="${SHOPPING_URL:-https://caddy-h3.ingress-nginx.svc.cluster.local:443}"
AUTH_URL="${AUTH_URL:-https://caddy-h3.ingress-nginx.svc.cluster.local:443}"

# Database configuration
DB_HOST="${DB_HOST:-postgres-shopping-1}"
DB_PORT="${DB_PORT:-5436}"
DB_NAME="${DB_NAME:-records}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-postgres}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

# Select test script based on type
case "$TEST_TYPE" in
  stress)
    TEST_SCRIPT="scripts/load/k6-shopping-stress.js"
    TEST_NAME="shopping-stress"
    VUS="${VUS:-50}"
    DURATION="${DURATION:-5m}"
    ;;
  ramp)
    TEST_SCRIPT="scripts/load/k6-shopping-ramp.js"
    TEST_NAME="shopping-ramp"
    VUS=""
    DURATION=""
    ;;
  db-validation|db)
    TEST_SCRIPT="scripts/load/k6-shopping-db-validation.js"
    TEST_NAME="shopping-db-validation"
    VUS="${VUS:-20}"
    DURATION="${DURATION:-5m}"
    ;;
  *)
    fail "Unknown test type: $TEST_TYPE (use: stress, ramp, db-validation)"
    ;;
esac

if [[ ! -f "$TEST_SCRIPT" ]]; then
  fail "Test script not found: $TEST_SCRIPT"
fi

# Create namespace if it doesn't exist
kubectl get ns "$NS_K6" >/dev/null 2>&1 || kubectl create ns "$NS_K6" >/dev/null

# Create timestamped results directory
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
RESULTS_DIR="${RESULTS_DIR:-scripts/load/results/shopping-${TEST_NAME}}"
mkdir -p "$RESULTS_DIR"
SUMMARY_JSON="${RESULTS_DIR}/${TEST_NAME}-${TIMESTAMP}.json"
OUTPUT_LOG="${RESULTS_DIR}/${TEST_NAME}-${TIMESTAMP}.txt"

say "Running daily k6 Shopping Service Load Test: $TEST_TYPE"
say "Results will be saved to: $RESULTS_DIR"
echo "  Summary JSON: ${SUMMARY_JSON##*/}"
echo "  Output Log: ${OUTPUT_LOG##*/}"

# Create ConfigMap with k6 test script
say "Creating ConfigMap with k6 test script..."
kubectl -n "$NS_K6" create configmap "k6-${TEST_NAME}-script-${TIMESTAMP}" \
  --from-file="${TEST_SCRIPT}" \
  --dry-run=client -o yaml | kubectl apply -f - >/dev/null
ok "ConfigMap created"

# Create CA certificate ConfigMap for strict TLS (if mkcert CA exists)
CA_ROOT="$(mkcert -CAROOT 2>/dev/null)/rootCA.pem" || CA_ROOT=""
if [[ -f "$CA_ROOT" ]]; then
  say "Creating CA certificate ConfigMap for strict TLS..."
  kubectl -n "$NS_K6" create configmap k6-ca-cert \
    --from-file=ca.crt="$CA_ROOT" \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null
  ok "CA certificate ConfigMap created"
else
  warn "mkcert CA not found - k6 will skip TLS verification"
fi

# Build k6 command
K6_CMD="k6 run --insecure-skip-tls-verify --summary-export /results/summary.json"
if [[ -n "$VUS" ]]; then
  K6_CMD="$K6_CMD --vus $VUS"
fi
if [[ -n "$DURATION" ]]; then
  K6_CMD="$K6_CMD --duration $DURATION"
fi
K6_CMD="$K6_CMD /tmp/test.js"

# Create Job with unique name
JOB_NAME="k6-${TEST_NAME}-${TIMESTAMP}"
say "Creating k6 Job: $JOB_NAME"

cat <<EOF | kubectl -n "$NS_K6" apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: $JOB_NAME
  namespace: $NS_K6
  labels:
    app: k6-shopping-test
    test-type: ${TEST_NAME}
    scheduled: daily
spec:
  ttlSecondsAfterFinished: 3600  # Auto-delete after 1 hour
  template:
    spec:
      restartPolicy: Never
      containers:
      - name: k6
        image: grafana/k6:latest
        command: ["/bin/sh", "-c"]
        args:
        - |
          # Copy script from ConfigMap
          cp /scripts/${TEST_SCRIPT##*/} /tmp/test.js
          
          # Set environment variables
          export SHOPPING_URL="${SHOPPING_URL}"
          export AUTH_URL="${AUTH_URL}"
          export HOST="${HOST}"
          export DB_HOST="${DB_HOST}"
          export DB_PORT="${DB_PORT}"
          export DB_NAME="${DB_NAME}"
          export DB_USER="${DB_USER}"
          export DB_PASSWORD="${DB_PASSWORD}"
          
          # Run k6 test and save output
          ${K6_CMD} 2>&1 | tee /results/output.txt
          
          # Copy summary JSON to results volume
          if [[ -f /results/summary.json ]]; then
            cp /results/summary.json /results/final-summary.json
          fi
        volumeMounts:
        - name: k6-script
          mountPath: /scripts
          readOnly: true
        - name: k6-ca-cert
          mountPath: /etc/ssl/certs/k6-ca.crt
          subPath: ca.crt
          readOnly: true
        - name: k6-results
          mountPath: /results
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "2Gi"
            cpu: "2000m"
      volumes:
      - name: k6-script
        configMap:
          name: k6-${TEST_NAME}-script-${TIMESTAMP}
      - name: k6-ca-cert
        configMap:
          name: k6-ca-cert
          optional: true
      - name: k6-results
        emptyDir: {}
EOF

ok "k6 Job created: $JOB_NAME"

# Wait for pod to be ready
say "Waiting for k6 pod to be ready..."
kubectl -n "$NS_K6" wait --for=condition=ready pod -l job-name="$JOB_NAME" --timeout=60s >/dev/null 2>&1 || {
  warn "Pod not ready yet, continuing..."
  sleep 5
}

# Get pod name
POD_NAME=$(kubectl -n "$NS_K6" get pods -l job-name="$JOB_NAME" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [[ -z "$POD_NAME" ]]; then
  fail "Could not find pod for job $JOB_NAME"
fi

ok "k6 pod ready: $POD_NAME"

# Wait for job to complete (with timeout)
say "Waiting for k6 job to complete (max 35 minutes)..."
MAX_WAIT=2100  # 35 minutes
ELAPSED=0
while [[ $ELAPSED -lt $MAX_WAIT ]]; do
  if kubectl -n "$NS_K6" get job "$JOB_NAME" >/dev/null 2>&1; then
    STATUS=$(kubectl -n "$NS_K6" get job "$JOB_NAME" -o jsonpath='{.status.conditions[?(@.type=="Complete")].status}' 2>/dev/null || echo "False")
    if [[ "$STATUS" == "True" ]]; then
      ok "Job completed successfully"
      break
    fi
    # Check if failed
    FAILED=$(kubectl -n "$NS_K6" get job "$JOB_NAME" -o jsonpath='{.status.conditions[?(@.type=="Failed")].status}' 2>/dev/null || echo "False")
    if [[ "$FAILED" == "True" ]]; then
      warn "Job failed"
      break
    fi
  else
    warn "Job not found - may have been cleaned up"
    break
  fi
  sleep 30
  ELAPSED=$((ELAPSED + 30))
  if [[ $((ELAPSED % 300)) -eq 0 ]]; then
    say "Still running... (${ELAPSED}s elapsed)"
  fi
done

# Copy results from pod to local filesystem
say "Retrieving results from pod..."
if [[ -n "$POD_NAME" ]] && kubectl -n "$NS_K6" get pod "$POD_NAME" >/dev/null 2>&1; then
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
else
  warn "Pod not found - retrieving from job logs"
  kubectl -n "$NS_K6" logs -l job-name="$JOB_NAME" --tail=200 > "$OUTPUT_LOG" 2>&1 || true
fi

# Generate latency graph if summary exists
if [[ -f "$SUMMARY_JSON" ]]; then
  say "Generating latency graph..."
  GRAPH_OUTPUT="${RESULTS_DIR}/${TEST_NAME}-${TIMESTAMP}-latency.html"
  if [[ -f "scripts/load/generate-latency-graph.py" ]]; then
    if python3 scripts/load/generate-latency-graph.py "$SUMMARY_JSON" "$GRAPH_OUTPUT" 2>/dev/null; then
      ok "Latency graph generated: $GRAPH_OUTPUT"
    else
      warn "Could not generate latency graph"
    fi
  fi
fi

# Show summary
say "Test Summary:"
if [[ -f "$OUTPUT_LOG" ]]; then
  grep -A 50 "Shopping Service" "$OUTPUT_LOG" | head -30 || tail -50 "$OUTPUT_LOG"
fi

# Cleanup: Delete job and pod (ttlSecondsAfterFinished should handle this, but ensure cleanup)
say "Cleaning up resources..."
kubectl -n "$NS_K6" delete job "$JOB_NAME" --ignore-not-found=true >/dev/null 2>&1 && ok "Job deleted" || warn "Job already deleted"
if [[ -n "$POD_NAME" ]]; then
  kubectl -n "$NS_K6" delete pod "$POD_NAME" --ignore-not-found=true >/dev/null 2>&1 && ok "Pod deleted" || warn "Pod already deleted"
fi

# Clean up old ConfigMaps (keep last 5)
say "Cleaning up old ConfigMaps..."
kubectl -n "$NS_K6" get configmap -l app=k6-shopping-test 2>/dev/null | \
  awk 'NR>1 {print $1}' | \
  sort -r | \
  tail -n +6 | \
  xargs -r kubectl -n "$NS_K6" delete configmap 2>/dev/null || true

say "Daily test complete"
say "Results saved to: $RESULTS_DIR"
ok "Test finished at $(date)"

