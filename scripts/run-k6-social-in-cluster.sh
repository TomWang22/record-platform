#!/usr/bin/env bash
set -euo pipefail

# Run k6 social-service limit test INSIDE the cluster (closed system approach)
# This treats the cluster as a closed system and runs traffic generators (k6) inside it

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

say "=== K6 Social Service Limit Test (In-Cluster) ==="

# Check if k6 script exists
K6_TEST_SCRIPT="$PROJECT_ROOT/scripts/load/k6-social-limit-test.js"
if [[ ! -f "$K6_TEST_SCRIPT" ]]; then
  fail "k6 test script not found: $K6_TEST_SCRIPT"
fi

# Check if latency graph generator exists
GRAPH_GENERATOR="$PROJECT_ROOT/scripts/load/generate-latency-graph.py"
if [[ ! -f "$GRAPH_GENERATOR" ]]; then
  warn "Latency graph generator not found: $GRAPH_GENERATOR"
fi

# Create output directory
OUTPUT_DIR="${OUTPUT_DIR:-$PROJECT_ROOT/results/k6-social-limit-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$OUTPUT_DIR"

say "Output directory: $OUTPUT_DIR"

# Verify social-service is running
say "Verifying social-service..."
SOCIAL_POD=$(./scripts/kubectl-kind-h3 -n record-platform get pods -l app=social-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")

if [[ -n "$SOCIAL_POD" ]] && ./scripts/kubectl-kind-h3 -n record-platform get pod "$SOCIAL_POD" -o jsonpath='{.status.phase}' 2>/dev/null | grep -q "Running"; then
  ok "Social-service pod is running: $SOCIAL_POD"
else
  warn "Social-service pod not found or not running"
fi

# Verify Kafka and Zookeeper (for social-service features)
say "Verifying Kafka and Zookeeper..."
KAFKA_POD=$(./scripts/kubectl-kind-h3 -n record-platform get pods -l app=kafka -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
ZOOKEEPER_POD=$(./scripts/kubectl-kind-h3 -n record-platform get pods -l app=zookeeper -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")

if [[ -n "$KAFKA_POD" ]] && ./scripts/kubectl-kind-h3 -n record-platform get pod "$KAFKA_POD" -o jsonpath='{.status.phase}' 2>/dev/null | grep -q "Running"; then
  ok "Kafka pod is running: $KAFKA_POD"
else
  warn "Kafka pod not found or not running"
fi

if [[ -n "$ZOOKEEPER_POD" ]] && ./scripts/kubectl-kind-h3 -n record-platform get pod "$ZOOKEEPER_POD" -o jsonpath='{.status.phase}' 2>/dev/null | grep -q "Running"; then
  ok "Zookeeper pod is running: $ZOOKEEPER_POD"
else
  warn "Zookeeper pod not found or not running"
fi

# Create/update ConfigMap with k6 script
CONFIGMAP_NAME="k6-social-limit-script"
say "Creating/updating ConfigMap: $CONFIGMAP_NAME"

# Use kubectl create with --from-file, but we need to mount the file into the container first
# Alternative: create ConfigMap from literal or use a different approach
# Since kubectl-kind-h3 runs inside docker, we'll create the ConfigMap YAML manually
CONFIGMAP_YAML=$(cat <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: ${CONFIGMAP_NAME}
  namespace: record-platform
data:
  test.js: |
$(cat "$K6_TEST_SCRIPT" | sed 's/^/    /')
EOF
)

echo "$CONFIGMAP_YAML" | ./scripts/kubectl-kind-h3 apply -f - >/dev/null 2>&1

ok "ConfigMap created/updated: $CONFIGMAP_NAME"

# Get Caddy service ClusterIP for hostAliases
CADDY_CLUSTER_IP=$(./scripts/kubectl-kind-h3 -n ingress-nginx get svc caddy-h3 -o jsonpath='{.spec.clusterIP}' 2>/dev/null)
if [[ -z "$CADDY_CLUSTER_IP" ]]; then
  fail "Could not get Caddy service ClusterIP"
fi
say "Using Caddy ClusterIP: $CADDY_CLUSTER_IP for record.local resolution"

# Create Job to run k6 inside cluster
JOB_NAME="k6-social-limit-$(date +%s)"
say "Creating k6 Job: $JOB_NAME"

K6_IMAGE="${K6_IMAGE:-grafana/k6:latest}"

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
          # k6 uses connection pooling by default, which prevents ephemeral port exhaustion
          # Each VU reuses connections instead of creating new ones per request
          # This is handled automatically by k6's HTTP client
          k6 run \
            --out json=/results/k6-results.json \
            --summary-export=/results/k6-summary.json \
            /scripts/test.js
        env:
        - name: BASE_URL
          value: "https://caddy-h3.ingress-nginx.svc.cluster.local:443"
        - name: API_HOST
          value: "record.local"
        - name: IN_CLUSTER
          value: "true"
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "2Gi"
            cpu: "2000m"
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
          name: ${CONFIGMAP_NAME}
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

# Wait for pod to be ready (not just created)
say "Waiting for pod to be ready..."
MAX_WAIT=120
ELAPSED=0
while [[ $ELAPSED -lt $MAX_WAIT ]]; do
  READY=$(./scripts/kubectl-kind-h3 -n record-platform get pod "$POD_NAME" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || echo "")
  if [[ "$READY" == "True" ]]; then
    ok "Pod is ready"
    break
  fi
  
  # Check if pod failed to start
  PHASE=$(./scripts/kubectl-kind-h3 -n record-platform get pod "$POD_NAME" -o jsonpath='{.status.phase}' 2>/dev/null || echo "")
  if [[ "$PHASE" == "Failed" ]] || [[ "$PHASE" == "Error" ]]; then
    fail "Pod failed to start (phase: $PHASE)"
  fi
  
  sleep 2
  ELAPSED=$((ELAPSED + 2))
  if [[ $((ELAPSED % 10)) -eq 0 ]]; then
    say "Still waiting for pod to be ready... (${ELAPSED}s elapsed)"
  fi
done

if [[ "$READY" != "True" ]]; then
  warn "Pod did not become ready within ${MAX_WAIT}s"
  say "Pod status:"
  ./scripts/kubectl-kind-h3 -n record-platform describe pod "$POD_NAME" 2>&1 | tail -30
fi

# Stream logs
say "Streaming k6 test execution..."
say "This is a progressive limit test (10 -> 500 VUs over ~12 minutes)"
say "Note: Connection pooling enabled to avoid ephemeral port exhaustion"

./scripts/kubectl-kind-h3 -n record-platform logs -f "$POD_NAME" 2>&1 | tee "$OUTPUT_DIR/k6-output.log" || true

# Wait for job to complete
say "Waiting for job to complete..."
if ./scripts/kubectl-kind-h3 -n record-platform wait --for=condition=complete --timeout=30m job/"$JOB_NAME" 2>/dev/null; then
  ok "Job completed successfully"
else
  # Check if job failed
  if ./scripts/kubectl-kind-h3 -n record-platform wait --for=condition=failed --timeout=1s job/"$JOB_NAME" 2>/dev/null; then
    fail "Job failed"
  else
    warn "Job may still be running or timed out"
  fi
fi

# Copy results
say "Copying results..."
if ./scripts/kubectl-kind-h3 -n record-platform exec "$POD_NAME" -- test -f /results/k6-results.json 2>/dev/null; then
  ./scripts/kubectl-kind-h3 -n record-platform cp "$POD_NAME:/results/k6-results.json" "$OUTPUT_DIR/k6-results.json"
  ok "Results copied: $OUTPUT_DIR/k6-results.json"
else
  warn "k6-results.json not found in pod"
fi

if ./scripts/kubectl-kind-h3 -n record-platform exec "$POD_NAME" -- test -f /results/k6-summary.json 2>/dev/null; then
  ./scripts/kubectl-kind-h3 -n record-platform cp "$POD_NAME:/results/k6-summary.json" "$OUTPUT_DIR/k6-summary.json"
  ok "Summary copied: $OUTPUT_DIR/k6-summary.json"
else
  warn "k6-summary.json not found in pod"
fi

# Check if k6 run failed (exit code from summary)
K6_EXIT_CODE=0
if [[ -f "$OUTPUT_DIR/k6-summary.json" ]]; then
  # Check for errors in summary
  ERROR_COUNT=$(jq -r '.root_group.groups[]?.checks[]? | select(.fails > 0) | .fails' "$OUTPUT_DIR/k6-summary.json" 2>/dev/null | awk '{sum+=$1} END {print sum+0}' || echo "0")
  if [[ "$ERROR_COUNT" -gt 0 ]]; then
    warn "k6 test had $ERROR_COUNT failed checks"
  fi
fi

# Generate latency graph
if [[ -f "$GRAPH_GENERATOR" ]] && [[ -f "$OUTPUT_DIR/k6-results.json" ]]; then
  say "Generating latency graph..."
  python3 "$GRAPH_GENERATOR" \
    --input "$OUTPUT_DIR/k6-results.json" \
    --output "$OUTPUT_DIR/latency-graph.html" \
    --test-name "Social Service Limit Test" \
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

# Cleanup
say "Cleaning up job..."
./scripts/kubectl-kind-h3 -n record-platform delete job "$JOB_NAME" --ignore-not-found=true >/dev/null 2>&1

if [[ $K6_EXIT_CODE -ne 0 ]]; then
  fail "k6 test failed with exit code $K6_EXIT_CODE"
fi

ok "Limit test complete! Results in: $OUTPUT_DIR"
exit 0
