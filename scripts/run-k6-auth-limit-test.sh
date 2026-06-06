#!/usr/bin/env bash
set -euo pipefail

# Run k6 limit test for auth-service to find breaking points with latency graphs

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

say "=== K6 Auth Service Limit Test with Latency Graphs ==="

# Check if k6 image is available
K6_IMAGE="${K6_IMAGE:-grafana/k6:latest}"

# Create output directory
OUTPUT_DIR="${OUTPUT_DIR:-$PROJECT_ROOT/results/k6-auth-limit-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$OUTPUT_DIR"

say "Output directory: $OUTPUT_DIR"

# Initialize array for temporary pods
TEMP_PODS=()

# Cleanup function
cleanup_k6_resources() {
  say "Cleaning up k6 resources..."
  
  if [[ -n "${JOB_NAME:-}" ]] && ./scripts/kubectl-kind-h3 -n record-platform get job "$JOB_NAME" >/dev/null 2>&1; then
    ./scripts/kubectl-kind-h3 -n record-platform delete job "$JOB_NAME" --ignore-not-found=true >/dev/null 2>&1
    ok "Deleted k6 job: $JOB_NAME"
  fi
  
  if [[ -n "${POD_NAME:-}" ]] && ./scripts/kubectl-kind-h3 -n record-platform get pod "$POD_NAME" >/dev/null 2>&1; then
    ./scripts/kubectl-kind-h3 -n record-platform delete pod "$POD_NAME" --ignore-not-found=true >/dev/null 2>&1
    ok "Deleted k6 pod: $POD_NAME"
  fi
}

JOB_NAME="${JOB_NAME:-}"
POD_NAME="${POD_NAME:-}"
trap cleanup_k6_resources EXIT INT TERM

# Verify auth-service is running
say "Verifying auth-service..."
AUTH_POD=$(./scripts/kubectl-kind-h3 -n record-platform get pods -l app=auth-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")

if [[ -n "$AUTH_POD" ]] && ./scripts/kubectl-kind-h3 -n record-platform get pod "$AUTH_POD" -o jsonpath='{.status.phase}' 2>/dev/null | grep -q "Running"; then
  ok "Auth-service pod is running: $AUTH_POD"
  AUTH_REPLICAS=$(./scripts/kubectl-kind-h3 -n record-platform get deployment auth-service -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "1")
  ok "Auth-service replicas: $AUTH_REPLICAS"
else
  warn "Auth-service pod not found or not running"
fi

# Create a Job to run k6 inside the cluster
JOB_NAME="k6-auth-limit-$(date +%s)"

say "Creating k6 limit test job: $JOB_NAME"

# Copy k6 script to a ConfigMap
K6_TEST_SCRIPT="$PROJECT_ROOT/scripts/load/k6-auth-limit-test.js"
if [[ ! -f "$K6_TEST_SCRIPT" ]]; then
  fail "k6 test script not found: $K6_TEST_SCRIPT"
fi

./scripts/kubectl-kind-h3 -n record-platform create configmap k6-auth-limit-script \
  --from-file=test.js="$K6_TEST_SCRIPT" \
  --dry-run=client -o yaml | ./scripts/kubectl-kind-h3 apply -f - >/dev/null 2>&1 || true

# Get Caddy service ClusterIP for hostAliases
CADDY_CLUSTER_IP=$(./scripts/kubectl-kind-h3 -n ingress-nginx get svc caddy-h3 -o jsonpath='{.spec.clusterIP}' 2>/dev/null)
if [[ -z "$CADDY_CLUSTER_IP" ]]; then
  fail "Could not get Caddy service ClusterIP"
fi
say "Using Caddy ClusterIP: $CADDY_CLUSTER_IP for record.local resolution"

# Create k6 job to run inside cluster
cat <<EOF | ./scripts/kubectl-kind-h3 apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: ${JOB_NAME}
  namespace: record-platform
spec:
  ttlSecondsAfterFinished: 600
  template:
    spec:
      restartPolicy: Never
      containers:
      - name: k6
        image: ${K6_IMAGE}
        command: ["sh", "-c"]
        args:
        - |
          export SSL_CERT_FILE=/etc/ssl/certs/k6-ca.crt
          k6 run \
            --out json=/results/k6-results.json \
            --summary-export=/results/k6-summary.json \
            /scripts/test.js
        env:
        - name: BASE_URL
          value: "https://record.local"
        - name: API_HOST
          value: "record.local"
        - name: IN_CLUSTER
          value: "true"
        volumeMounts:
        - name: k6-script
          mountPath: /scripts
          readOnly: true
        - name: k6-ca-cert
          mountPath: /etc/ssl/certs/k6-ca.crt
          subPath: ca.crt
          readOnly: true
        - name: results
          mountPath: /results
      hostAliases:
      - ip: "${CADDY_CLUSTER_IP}"
        hostnames:
        - "record.local"
      volumes:
      - name: k6-script
        configMap:
          name: k6-auth-limit-script
      - name: k6-ca-cert
        configMap:
          name: k6-ca-cert
      - name: results
        emptyDir: {}
EOF

ok "Job created: $JOB_NAME"

# Wait for job to start
say "Waiting for job to start..."
sleep 5

# Get pod name
POD_NAME=$(./scripts/kubectl-kind-h3 -n record-platform get pods -l job-name="$JOB_NAME" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")

if [[ -z "$POD_NAME" ]]; then
  warn "Pod not found yet, waiting..."
  sleep 10
  POD_NAME=$(./scripts/kubectl-kind-h3 -n record-platform get pods -l job-name="$JOB_NAME" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
fi

if [[ -z "$POD_NAME" ]]; then
  fail "Could not find k6 pod"
fi

ok "Pod started: $POD_NAME"

# Follow logs
say "Following k6 test execution..."
say "This is a progressive limit test (10 -> 500 VUs over ~12 minutes)"
say "Press Ctrl+C to stop following logs (test will continue running)"

./scripts/kubectl-kind-h3 -n record-platform logs -f "$POD_NAME" 2>&1 | tee "$OUTPUT_DIR/k6-output.log" || true

# Wait for job to complete
say "Waiting for job to complete..."
./scripts/kubectl-kind-h3 -n record-platform wait --for=condition=complete --timeout=30m job/"$JOB_NAME" 2>/dev/null || warn "Job may still be running or timed out"

# Copy results
say "Copying results..."
if ./scripts/kubectl-kind-h3 -n record-platform exec "$POD_NAME" -- test -f /results/k6-results.json 2>/dev/null; then
  ./scripts/kubectl-kind-h3 -n record-platform cp "$POD_NAME:/results/k6-results.json" "$OUTPUT_DIR/k6-results.json"
  ok "Results copied: $OUTPUT_DIR/k6-results.json"
fi

if ./scripts/kubectl-kind-h3 -n record-platform exec "$POD_NAME" -- test -f /results/k6-summary.json 2>/dev/null; then
  ./scripts/kubectl-kind-h3 -n record-platform cp "$POD_NAME:/results/k6-summary.json" "$OUTPUT_DIR/k6-summary.json"
  ok "Summary copied: $OUTPUT_DIR/k6-summary.json"
fi

# Generate latency graph
say "Generating latency graph..."
if [[ -f "$OUTPUT_DIR/k6-results.json" ]] && [[ -f "$SCRIPT_DIR/load/generate-latency-graph.py" ]]; then
  python3 "$SCRIPT_DIR/load/generate-latency-graph.py" \
    --input "$OUTPUT_DIR/k6-results.json" \
    --output "$OUTPUT_DIR/latency-graph.html" \
    --test-name "Auth Service Limit Test" \
    2>&1 | tee "$OUTPUT_DIR/graph-generation.log"
  
  if [[ -f "$OUTPUT_DIR/latency-graph.html" ]]; then
    ok "Latency graph generated: $OUTPUT_DIR/latency-graph.html"
  else
    warn "Latency graph generation may have failed"
  fi
else
  warn "Could not generate latency graph (missing files)"
fi

# Show summary
say "=== Test Summary ==="
if [[ -f "$OUTPUT_DIR/k6-summary.json" ]]; then
  cat "$OUTPUT_DIR/k6-summary.json" | jq -r '
    "Total Requests: \(.metrics.http_reqs.values.count)",
    "HTTP Error Rate: \((.metrics.http_req_failed.values.rate * 100) | floor / 100)%",
    "P95 Latency: \(.metrics.http_req_duration.values[\"p(95)\"] | floor)ms",
    "P99 Latency: \(.metrics.http_req_duration.values[\"p(99)\"] | floor)ms",
    "Average Latency: \(.metrics.http_req_duration.values.avg | floor)ms"
  ' 2>/dev/null || cat "$OUTPUT_DIR/k6-summary.json"
fi

ok "Limit test complete! Results in: $OUTPUT_DIR"

# Cleanup
say "Cleaning up job..."
./scripts/kubectl-kind-h3 -n record-platform delete job "$JOB_NAME" --ignore-not-found=true >/dev/null 2>&1

ok "Done!"

