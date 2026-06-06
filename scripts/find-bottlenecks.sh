#!/usr/bin/env bash
set -euo pipefail

# Find bottlenecks and upper limits of virtual users using k6
# Runs progressive load tests and analyzes results

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

# Configuration
SERVICE="${1:-shopping}"  # shopping, social, listings, etc.
# Use FQDN with /etc/hosts entry for strict TLS validation
# /etc/hosts will map record.local to Caddy service IP
CADDY_IP="${CADDY_IP:-$(kubectl get svc -n ingress-nginx caddy-h3 -o jsonpath='{.spec.clusterIP}' 2>/dev/null || echo '10.96.130.141')}"
BASE_URL="${BASE_URL:-https://record.local:443}"
API_PATH="${API_PATH:-/api}"
HOST="${HOST:-record.local}"
NS_K6="${NS_K6:-k6-load}"

# Test parameters
MIN_VUS="${MIN_VUS:-10}"
MAX_VUS="${MAX_VUS:-500}"
STAGE_DURATION="${STAGE_DURATION:-1m}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

# Create results directory
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
RESULTS_DIR="scripts/load/results/bottleneck-${SERVICE}-${TIMESTAMP}"
mkdir -p "$RESULTS_DIR"

say "🔍 Finding Bottlenecks for ${SERVICE} Service"
say "Results will be saved to: $RESULTS_DIR"

# Select test script based on service
case "$SERVICE" in
  shopping)
    TEST_SCRIPT="scripts/load/k6-bottleneck-finder.js"
    AUTH_URL="${AUTH_URL:-${BASE_URL}${API_PATH}/auth}"
    SHOPPING_URL="${SHOPPING_URL:-${BASE_URL}${API_PATH}/cart}"
    ORDERS_URL="${ORDERS_URL:-${BASE_URL}${API_PATH}/orders}"
    LISTINGS_URL="${LISTINGS_URL:-${BASE_URL}${API_PATH}/listings}"
    ;;
  *)
    fail "Service not supported: $SERVICE (use: shopping)"
    ;;
esac

if [[ ! -f "$TEST_SCRIPT" ]]; then
  fail "Test script not found: $TEST_SCRIPT"
fi

# Create namespace if needed
kubectl get ns "$NS_K6" >/dev/null 2>&1 || kubectl create ns "$NS_K6" >/dev/null

# Get authentication token
say "Getting authentication token..."
TOKEN=""
if [[ -n "${TOKEN:-}" ]]; then
  ok "Using provided token"
else
  # Try to get token
  EMAIL="${EMAIL:-testuser@example.com}"
  PASS="${PASS:-password123}"
  
  TOKEN_RESPONSE=$(curl -k -sS -X POST "${AUTH_URL}/login" \
    -H "Content-Type: application/json" \
    -H "Host: ${HOST}" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" 2>/dev/null || echo "")
  
  if [[ -n "$TOKEN_RESPONSE" ]]; then
    TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.token // empty' 2>/dev/null || echo "")
  fi
  
  if [[ -z "$TOKEN" || "$TOKEN" == "null" ]]; then
    warn "Could not get token, test will create users during setup"
  else
    ok "Token obtained"
  fi
fi

# Create ConfigMap with test script
say "Creating ConfigMap with bottleneck finder script..."
kubectl -n "$NS_K6" create configmap k6-bottleneck-script \
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

# Build stages for progressive load test
STAGES="0s:${MIN_VUS}"
CURRENT_VUS=$MIN_VUS
STAGE_TIME=30
while [[ $CURRENT_VUS -lt $MAX_VUS ]]; do
  CURRENT_VUS=$((CURRENT_VUS * 2))
  if [[ $CURRENT_VUS -gt $MAX_VUS ]]; then
    CURRENT_VUS=$MAX_VUS
  fi
  STAGES="${STAGES},${STAGE_TIME}s:${CURRENT_VUS}"
  STAGE_TIME=$((STAGE_TIME + 60))
done
# Hold at max, then ramp down
STAGES="${STAGES},${STAGE_TIME}s:${MAX_VUS},$((STAGE_TIME + 120))s:0"

say "Progressive stages: $STAGES"

# Create k6 Job
JOB_NAME="k6-bottleneck-${SERVICE}-${TIMESTAMP}"
say "Creating k6 Job: $JOB_NAME"

cat <<EOF | kubectl -n "$NS_K6" apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: $JOB_NAME
  namespace: $NS_K6
  labels:
    app: k6-bottleneck-test
    service: ${SERVICE}
spec:
  ttlSecondsAfterFinished: 3600
  template:
    spec:
      restartPolicy: Never
      # Add record.local to /etc/hosts for TLS certificate validation
      hostAliases:
      - ip: "${CADDY_IP}"
        hostnames:
        - "record.local"
      containers:
      - name: k6
        image: grafana/k6:latest
        command: ["/bin/sh", "-c"]
        args:
        - |
          set -euo pipefail
          
          cp /scripts/$(basename "$TEST_SCRIPT") /tmp/test.js
          
          export BASE_URL="${BASE_URL}"
          export API_PATH="${API_PATH}"
          export AUTH_URL="${AUTH_URL:-${BASE_URL}${API_PATH}/auth}"
          export SHOPPING_URL="${SHOPPING_URL:-${BASE_URL}${API_PATH}/cart}"
          export ORDERS_URL="${ORDERS_URL:-${BASE_URL}${API_PATH}/orders}"
          export LISTINGS_URL="${LISTINGS_URL:-${BASE_URL}${API_PATH}/listings}"
          export HOST="${HOST}"
          export TOKEN="${TOKEN:-}"
          export CADDY_IP="${CADDY_IP:-10.96.130.141}"
          
          # k6 stages are defined in the script itself, not as CLI flag
          # The script has stages built-in, so just run it
          # Strict TLS verification (production-ready)
          # CA certificate is mounted at /etc/ssl/certs/k6-ca.crt
          export SSL_CERT_FILE=/etc/ssl/certs/k6-ca.crt
          k6 run --summary-export /results/summary.json \
            /tmp/test.js 2>&1 | tee /results/output.txt
          
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
          name: k6-bottleneck-script
      - name: k6-ca-cert
        configMap:
          name: k6-ca-cert
          optional: true
      - name: k6-results
        emptyDir: {}
EOF

ok "Job created: $JOB_NAME"

# Wait for pod
say "Waiting for pod..."
kubectl -n "$NS_K6" wait --for=condition=ready pod -l job-name="$JOB_NAME" --timeout=60s >/dev/null 2>&1 || {
  warn "Pod not ready yet, continuing..."
  sleep 5
}

POD_NAME=$(kubectl -n "$NS_K6" get pods -l job-name="$JOB_NAME" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [[ -z "$POD_NAME" ]]; then
  fail "Could not find pod"
fi

ok "Pod ready: $POD_NAME"

# Stream logs
say "Streaming test progress (test will continue in background)..."
kubectl -n "$NS_K6" logs -f "pod/$POD_NAME" --tail=50 &
LOG_PID=$!

# Wait for completion
say "Waiting for test to complete (this may take 10-15 minutes)..."
MAX_WAIT=1800
ELAPSED=0
while [[ $ELAPSED -lt $MAX_WAIT ]]; do
  if kubectl -n "$NS_K6" get job "$JOB_NAME" >/dev/null 2>&1; then
    STATUS=$(kubectl -n "$NS_K6" get job "$JOB_NAME" -o jsonpath='{.status.conditions[?(@.type=="Complete")].status}' 2>/dev/null || echo "False")
    if [[ "$STATUS" == "True" ]]; then
      kill $LOG_PID 2>/dev/null || true
      ok "Test completed"
      break
    fi
  else
    kill $LOG_PID 2>/dev/null || true
    warn "Job not found"
    break
  fi
  sleep 30
  ELAPSED=$((ELAPSED + 30))
  if [[ $((ELAPSED % 120)) -eq 0 ]]; then
    say "Still running... (${ELAPSED}s elapsed)"
  fi
done

# Retrieve results
say "Retrieving results..."
if [[ -n "$POD_NAME" ]] && kubectl -n "$NS_K6" get pod "$POD_NAME" >/dev/null 2>&1; then
  kubectl -n "$NS_K6" cp "${POD_NAME}:/results/output.txt" "${RESULTS_DIR}/output.txt" >/dev/null 2>&1 && ok "Output saved" || warn "Could not copy output"
  kubectl -n "$NS_K6" cp "${POD_NAME}:/results/final-summary.json" "${RESULTS_DIR}/summary.json" >/dev/null 2>&1 && ok "Summary saved" || warn "Could not copy summary"
else
  warn "Pod not found, getting from logs"
  kubectl -n "$NS_K6" logs -l job-name="$JOB_NAME" > "${RESULTS_DIR}/output.txt" 2>&1 || true
fi

# Extract bottleneck analysis
say "Bottleneck Analysis:"
if [[ -f "${RESULTS_DIR}/output.txt" ]]; then
  grep -A 100 "BOTTLENECK ANALYSIS" "${RESULTS_DIR}/output.txt" | head -80 || tail -50 "${RESULTS_DIR}/output.txt"
fi

# Extract JSON analysis if available
if [[ -f "${RESULTS_DIR}/output.txt" ]]; then
  # Try to extract JSON from output
  grep -o 'bottleneck-analysis\.json.*' "${RESULTS_DIR}/output.txt" | \
    sed 's/bottleneck-analysis\.json://' | \
    jq '.' > "${RESULTS_DIR}/bottleneck-analysis.json" 2>/dev/null && \
    ok "Bottleneck analysis JSON saved" || warn "Could not extract JSON analysis"
fi

# Generate graph if summary exists
if [[ -f "${RESULTS_DIR}/summary.json" ]]; then
  say "Generating latency graph..."
  if [[ -f "scripts/load/generate-latency-graph.py" ]]; then
    python3 scripts/load/generate-latency-graph.py \
      "${RESULTS_DIR}/summary.json" \
      "${RESULTS_DIR}/bottleneck-latency-graph.html" 2>/dev/null && \
      ok "Graph generated: ${RESULTS_DIR}/bottleneck-latency-graph.html" || \
      warn "Could not generate graph"
  fi
fi

# Run bottleneck analysis
say "Running detailed bottleneck analysis..."
if [[ -f "scripts/analyze-bottlenecks.sh" ]]; then
  bash scripts/analyze-bottlenecks.sh "${RESULTS_DIR}" "${SERVICE}" || warn "Analysis script had issues, but results are available"
fi

# Cleanup
say "Cleaning up..."
kubectl -n "$NS_K6" delete job "$JOB_NAME" --ignore-not-found=true >/dev/null 2>&1 && ok "Job deleted" || warn "Job already deleted"

say "✅ Bottleneck analysis complete!"
say "Results saved to: $RESULTS_DIR"
say "View bottleneck analysis: cat ${RESULTS_DIR}/bottleneck-analysis.json | jq"
say "View graph: open ${RESULTS_DIR}/bottleneck-latency-graph.html"

