#!/usr/bin/env bash
set -euo pipefail

# Run k6 shopping service load tests in Kubernetes cluster
# Uses ClusterIP FQDN for in-cluster testing (same network as services)
# This matches the pattern from test-full-chain-with-rotation.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

# Configuration
TEST_TYPE="${1:-stress}"  # stress, ramp, db-validation
NS_K6="${NS_K6:-k6-load}"
HOST="${HOST:-record.local}"

# Use ClusterIP FQDN for in-cluster k6 testing (same network as services)
# This avoids NodePort TLS issues and port-forward bottlenecks
SHOPPING_URL="${SHOPPING_URL:-https://caddy-h3.ingress-nginx.svc.cluster.local:443}"
AUTH_URL="${AUTH_URL:-https://caddy-h3.ingress-nginx.svc.cluster.local:443}"

# Database configuration (for validation test)
DB_HOST="${DB_HOST:-postgres-shopping-1}"  # Docker container name
DB_PORT="${DB_PORT:-5436}"
DB_NAME="${DB_NAME:-records}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-postgres}"

# k6 test parameters
VUS="${VUS:-50}"
DURATION="${DURATION:-5m}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

# Cleanup function to delete job and pod
cleanup_k6_resources() {
  say "Cleaning up k6 resources..."
  
  # Delete the job (this will also delete the pod)
  if [[ -n "${JOB_NAME:-}" ]] && kubectl -n "${NS_K6:-k6-load}" get job "$JOB_NAME" >/dev/null 2>&1; then
    kubectl -n "${NS_K6:-k6-load}" delete job "$JOB_NAME" --ignore-not-found=true >/dev/null 2>&1
    ok "Deleted k6 job: $JOB_NAME"
  fi
  
  # Also ensure the pod is deleted (in case job deletion didn't work)
  if [[ -n "${POD_NAME:-}" ]] && kubectl -n "${NS_K6:-k6-load}" get pod "$POD_NAME" >/dev/null 2>&1; then
    kubectl -n "${NS_K6:-k6-load}" delete pod "$POD_NAME" --ignore-not-found=true >/dev/null 2>&1
    ok "Deleted k6 pod: $POD_NAME"
  fi
}

# Set up trap to cleanup on exit (including errors)
JOB_NAME="${JOB_NAME:-}"
POD_NAME="${POD_NAME:-}"
trap cleanup_k6_resources EXIT INT TERM

# Select test script based on type
case "$TEST_TYPE" in
  stress)
    TEST_SCRIPT="scripts/load/k6-shopping-stress.js"
    TEST_NAME="shopping-stress"
    ;;
  ramp)
    TEST_SCRIPT="scripts/load/k6-shopping-ramp.js"
    TEST_NAME="shopping-ramp"
    # Ramp test uses stages, not VUS/DURATION
    # Stages are defined in the k6 script itself
    VUS=""
    DURATION=""
    # Allow override via environment variable for aggressive testing
    if [[ -n "${RAMP_STAGES:-}" ]]; then
      K6_STAGES_ARG="--stages ${RAMP_STAGES}"
    else
      K6_STAGES_ARG=""
    fi
    ;;
  db-validation|db)
    TEST_SCRIPT="scripts/load/k6-shopping-db-validation.js"
    TEST_NAME="shopping-db-validation"
    ;;
  *)
    fail "Unknown test type: $TEST_TYPE (use: stress, ramp, db-validation)"
    ;;
esac

if [[ ! -f "$TEST_SCRIPT" ]]; then
  fail "Test script not found: $TEST_SCRIPT"
fi

say "Running k6 Shopping Service Load Test: $TEST_TYPE"
say "Configuration:"
echo "  Test Script: $TEST_SCRIPT"
echo "  Shopping URL: $SHOPPING_URL"
echo "  Auth URL: $AUTH_URL"
echo "  Host: $HOST"
echo "  Database: ${DB_HOST}:${DB_PORT}/${DB_NAME}"
if [[ -n "$VUS" ]]; then
  echo "  Virtual Users: $VUS"
fi
if [[ -n "$DURATION" ]]; then
  echo "  Duration: $DURATION"
fi

# Create namespace if it doesn't exist
kubectl get ns "$NS_K6" >/dev/null 2>&1 || kubectl create ns "$NS_K6" >/dev/null

# Create ConfigMap with k6 test script
say "Creating ConfigMap with k6 test script..."
kubectl -n "$NS_K6" create configmap "k6-${TEST_NAME}-script" \
  --from-file="${TEST_SCRIPT}" \
  --dry-run=client -o yaml | kubectl apply -f - >/dev/null
ok "ConfigMap created"

# Create CA certificate ConfigMap for strict TLS (REQUIRED for production)
CA_ROOT="$(mkcert -CAROOT 2>/dev/null)/rootCA.pem" || CA_ROOT=""
if [[ -f "$CA_ROOT" ]]; then
  say "Creating CA certificate ConfigMap for strict TLS (production-ready)..."
  kubectl -n "$NS_K6" create configmap k6-ca-cert \
    --from-file=ca.crt="$CA_ROOT" \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null
  ok "CA certificate ConfigMap created - strict TLS enabled"
else
  fail "mkcert CA not found at $CA_ROOT - strict TLS verification REQUIRED for production testing"
fi

# Create k6 Job
TIMESTAMP=$(date +%s)
JOB_NAME="k6-${TEST_NAME}-${TIMESTAMP}"
say "Creating k6 Job: $JOB_NAME"

# Create results directory for this test run
RESULTS_DIR="${RESULTS_DIR:-scripts/load/results/shopping-${TEST_NAME}}"
mkdir -p "$RESULTS_DIR"
SUMMARY_JSON="${RESULTS_DIR}/${TEST_NAME}-${TIMESTAMP}.json"
OUTPUT_LOG="${RESULTS_DIR}/${TEST_NAME}-${TIMESTAMP}.txt"

say "Results will be saved to: $RESULTS_DIR"
echo "  Summary JSON: ${SUMMARY_JSON##*/}"
echo "  Output Log: ${OUTPUT_LOG##*/}"

# Build k6 command as a string (simpler for embedding in YAML)
# Strict TLS verification (production-ready) - CA cert mounted at /etc/ssl/certs/k6-ca.crt
K6_CMD="k6 run --summary-export /results/summary.json"
if [[ -n "$VUS" ]]; then
  K6_CMD="$K6_CMD --vus $VUS"
fi
if [[ -n "$DURATION" ]]; then
  K6_CMD="$K6_CMD --duration $DURATION"
fi
# Add stages argument for ramp test if provided
if [[ "$TEST_TYPE" == "ramp" && -n "${K6_STAGES_ARG:-}" ]]; then
  K6_CMD="$K6_CMD ${K6_STAGES_ARG}"
fi
# Script path comes last
K6_CMD="$K6_CMD /tmp/test.js"

# Create Job YAML
cat <<EOF | kubectl -n "$NS_K6" apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: $JOB_NAME
  namespace: $NS_K6
spec:
  ttlSecondsAfterFinished: 300  # Clean up after 5 minutes
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
          
          # Run k6 test with strict TLS verification (production-ready)
          export SSL_CERT_FILE=/etc/ssl/certs/k6-ca.crt
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
          name: k6-${TEST_NAME}-script
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

# Stream logs
say "Streaming k6 test logs (press Ctrl+C to stop streaming, job will continue)..."
kubectl -n "$NS_K6" logs -f "pod/$POD_NAME" --tail=100 || true

# Wait for job to complete
say "Waiting for k6 job to complete..."
if kubectl -n "$NS_K6" wait --for=condition=complete "job/$JOB_NAME" --timeout=30m >/dev/null 2>&1; then
  ok "k6 job completed successfully"
  
  # Copy results from pod to local filesystem
  say "Copying results from pod..."
  if kubectl -n "$NS_K6" cp "${POD_NAME}:/results/output.txt" "$OUTPUT_LOG" >/dev/null 2>&1; then
    ok "Output log saved to: $OUTPUT_LOG"
  else
    warn "Could not copy output log (pod may have already terminated)"
  fi
  
  if kubectl -n "$NS_K6" cp "${POD_NAME}:/results/final-summary.json" "$SUMMARY_JSON" >/dev/null 2>&1; then
    ok "Summary JSON saved to: $SUMMARY_JSON"
    
    # Generate latency graph if Python script exists
    if [[ -f "scripts/load/generate-latency-graph.py" ]]; then
      say "Generating latency graph..."
      GRAPH_OUTPUT="${RESULTS_DIR}/${TEST_NAME}-${TIMESTAMP}-latency.html"
      if python3 scripts/load/generate-latency-graph.py "$SUMMARY_JSON" "$GRAPH_OUTPUT" 2>/dev/null; then
        ok "Latency graph generated: $GRAPH_OUTPUT"
      else
        warn "Could not generate latency graph (check Python dependencies)"
      fi
    fi
  else
    warn "Could not copy summary JSON (pod may have already terminated)"
    # Try to get summary from logs
    say "Attempting to extract summary from logs..."
    kubectl -n "$NS_K6" logs "pod/$POD_NAME" 2>&1 | grep -A 100 "Shopping Service" > "${RESULTS_DIR}/${TEST_NAME}-${TIMESTAMP}-summary.txt" || true
  fi
  
  # Show final logs
  say "Final k6 test results:"
  kubectl -n "$NS_K6" logs "pod/$POD_NAME" --tail=200 || true
  
  # Extract summary if available
  say "Test Summary:"
  kubectl -n "$NS_K6" logs "pod/$POD_NAME" 2>&1 | grep -A 50 "Shopping Service" || true
else
  warn "k6 job may still be running or failed"
  say "Current job status:"
  kubectl -n "$NS_K6" get job "$JOB_NAME" -o wide
  say "Pod logs:"
  kubectl -n "$NS_K6" logs "pod/$POD_NAME" --tail=100 || true
  
  # Try to copy results anyway
  if [[ -n "$POD_NAME" ]]; then
    kubectl -n "$NS_K6" cp "${POD_NAME}:/results/output.txt" "$OUTPUT_LOG" >/dev/null 2>&1 || true
    kubectl -n "$NS_K6" cp "${POD_NAME}:/results/final-summary.json" "$SUMMARY_JSON" >/dev/null 2>&1 || true
  fi
fi

say "k6 test complete"
say "Results saved to: $RESULTS_DIR"

# Run bottleneck analysis if results exist
if [[ -f "${SUMMARY_JSON}" ]] && [[ -f "scripts/analyze-bottlenecks.sh" ]]; then
  say "Running bottleneck analysis..."
  bash scripts/analyze-bottlenecks.sh "${RESULTS_DIR}" "${TEST_NAME}" || warn "Analysis had issues, but results are available"
fi

say "To view full logs: kubectl -n $NS_K6 logs pod/$POD_NAME"
say "Job and pod will be cleaned up automatically on exit"

