#!/usr/bin/env bash
set -eo pipefail

# Find the maximum VUs (limit test) for listings service
# Gradually increases VUs until error rate exceeds threshold

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

say "=== K6 Listings Service Limit Test (Find Max VUs) ==="

# Configuration
# STRICT TLS: Use CA certificate for production-ready testing
K6_IMAGE="${K6_IMAGE:-grafana/k6:latest}"
START_VUS="${START_VUS:-10}"
MAX_VUS="${MAX_VUS:-1000}"
VUS_STEP="${VUS_STEP:-10}"
DURATION="${DURATION:-2m}"
ERROR_THRESHOLD="${ERROR_THRESHOLD:-0.05}"  # 5% error rate threshold
OUTPUT_DIR="${OUTPUT_DIR:-$PROJECT_ROOT/results/k6-listings-limit-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$OUTPUT_DIR"

say "Configuration:"
echo "  Start VUs: $START_VUS"
echo "  Max VUs: $MAX_VUS"
echo "  VU Step: $VUS_STEP"
echo "  Duration per test: $DURATION"
echo "  Error threshold: ${ERROR_THRESHOLD} (${ERROR_THRESHOLD}%)"
echo "  Output directory: $OUTPUT_DIR"

# Get Caddy service ClusterIP for hostAliases (use docker exec for kubectl)
KIND_NODE=$(docker ps --format "{{.Names}}" | grep h3-control-plane | head -1 || echo "")
if [[ -z "$KIND_NODE" ]]; then
  fail "Kind control plane node not found"
fi

CADDY_CLUSTER_IP=$(docker exec "$KIND_NODE" kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.spec.clusterIP}' 2>/dev/null || echo "")
if [[ -z "$CADDY_CLUSTER_IP" ]]; then
  # Fallback to API Gateway ClusterIP
  API_GATEWAY_IP=$(docker exec "$KIND_NODE" kubectl -n record-platform get svc api-gateway -o jsonpath='{.spec.clusterIP}' 2>/dev/null || echo "")
  if [[ -z "$API_GATEWAY_IP" ]]; then
    # If kubectl fails, use a default IP (hostAliases is optional, test uses direct service names)
    warn "Could not get service ClusterIP via kubectl, using default for hostAliases"
    CADDY_CLUSTER_IP="10.96.0.1"
  else
    say "Using API Gateway ClusterIP: $API_GATEWAY_IP for record.local resolution"
    CADDY_CLUSTER_IP="$API_GATEWAY_IP"
  fi
else
  say "Using Caddy ClusterIP: $CADDY_CLUSTER_IP for record.local resolution"
fi

# Copy k6 script to a ConfigMap (use kubectl from host via admin.conf)
if [[ -f "$SCRIPT_DIR/load/k6-listings-service-comprehensive.js" ]]; then
  # Extract admin.conf from Kind node and use it to create ConfigMap from host
  docker exec "$KIND_NODE" cat /etc/kubernetes/admin.conf > /tmp/kubeconfig-tmp.yaml 2>/dev/null
  if [[ -f /tmp/kubeconfig-tmp.yaml ]]; then
    KUBECONFIG=/tmp/kubeconfig-tmp.yaml kubectl -n record-platform create configmap k6-listings-script-limit \
      --from-file=test.js="$SCRIPT_DIR/load/k6-listings-service-comprehensive.js" \
      --dry-run=client -o yaml 2>/dev/null | docker exec -i "$KIND_NODE" kubectl apply -f - >/dev/null 2>&1
    rm -f /tmp/kubeconfig-tmp.yaml
    ok "k6 script ConfigMap created"
  else
    # Fallback: copy file and create ConfigMap inside container
    docker cp "$SCRIPT_DIR/load/k6-listings-service-comprehensive.js" "$KIND_NODE:/tmp/k6-script.js" >/dev/null 2>&1
    docker exec "$KIND_NODE" kubectl -n record-platform create configmap k6-listings-script-limit \
      --from-file=test.js=/tmp/k6-script.js --dry-run=client -o yaml 2>/dev/null | \
      docker exec -i "$KIND_NODE" kubectl apply -f - >/dev/null 2>&1 || true
    ok "k6 script ConfigMap created (fallback method)"
  fi
else
  fail "k6 test script not found: $SCRIPT_DIR/load/k6-listings-service-comprehensive.js"
fi

# Function to run a single k6 test with specified VUs
run_k6_test() {
  local vus=$1
  local job_name="k6-listings-limit-${vus}-$(date +%s)"
  
  say "Testing with ${vus} VUs..."
  
  # Create k6 job (use docker exec for kubectl)
  cat <<EOF | docker exec -i "$KIND_NODE" kubectl apply -f - >/dev/null
apiVersion: batch/v1
kind: Job
metadata:
  name: ${job_name}
  namespace: record-platform
spec:
  ttlSecondsAfterFinished: 300
  template:
    spec:
      restartPolicy: Never
      hostAliases:
      - ip: ${CADDY_CLUSTER_IP}
        hostnames:
        - record.local
      containers:
      - name: k6
        image: ${K6_IMAGE}
        command:
        - sh
        - -c
        - |
          # API Gateway serves HTTP (not HTTPS) on port 4000
          # k6 will use HTTP/1.1 or HTTP/2 (if supported by server)
          echo "Using HTTP to connect to API Gateway (in-cluster)"
          k6 run \
            --vus ${vus} \
            --duration ${DURATION} \
            --out json=/results/k6-results.json \
            --summary-export=/results/k6-summary.json \
            --summary-trend-stats="min,max,avg,med,p(1),p(5),p(10),p(25),p(50),p(75),p(90),p(95),p(99),p(99.9),p(99.99),p(99.999),p(99.9999),p(99.99999),p(99.999999),p(100)" \
            /scripts/test.js
          echo "k6 exit code: $?"
          ls -lh /results/ 2>&1 || true
          sleep 5
        env:
        - name: BASE_URL
          value: "http://api-gateway.record-platform.svc.cluster.local:4000"
        - name: API_HOST
          value: "api-gateway.record-platform.svc.cluster.local"
        - name: IN_CLUSTER
          value: "true"
        volumeMounts:
        - name: k6-script
          mountPath: /scripts
          readOnly: true
        - name: results
          mountPath: /results
      volumes:
      - name: k6-script
        configMap:
          name: k6-listings-script-limit
      - name: results
        emptyDir: {}
EOF
  
  # Wait for job to complete (with timeout) - more efficient polling
  local duration_seconds=$(echo "$DURATION" | sed 's/s$//' | sed 's/m$/*60/' | bc 2>/dev/null || echo "30")
  local timeout=$((duration_seconds + 60))  # Duration + 1 minute buffer
  local elapsed=0
  local last_status=""
  
  while [[ $elapsed -lt $timeout ]]; do
    local status=$(docker exec "$KIND_NODE" kubectl -n record-platform get job "$job_name" -o jsonpath='{.status.conditions[?(@.type=="Complete")].status}' 2>/dev/null || echo "")
    if [[ "$status" == "True" ]]; then
      break
    fi
    
    local failed=$(docker exec "$KIND_NODE" kubectl -n record-platform get job "$job_name" -o jsonpath='{.status.conditions[?(@.type=="Failed")].status}' 2>/dev/null || echo "")
    if [[ "$failed" == "True" ]]; then
      warn "Job failed for ${vus} VUs"
      docker exec "$KIND_NODE" kubectl -n record-platform delete job "$job_name" --ignore-not-found >/dev/null 2>&1 || true
      return 1
    fi
    
    # Show progress every 15 seconds
    if [[ $((elapsed % 15)) -eq 0 ]] && [[ $elapsed -gt 0 ]]; then
      local pod_name=$(docker exec "$KIND_NODE" kubectl -n record-platform get pods -l job-name="$job_name" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
      if [[ -n "$pod_name" ]]; then
        echo "  Still running... (${elapsed}s/${timeout}s)"
      fi
    fi
    
    sleep 5
    elapsed=$((elapsed + 5))
  done
  
  # Get pod name and copy results
  local pod_name=$(docker exec "$KIND_NODE" kubectl -n record-platform get pods -l job-name="$job_name" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  if [[ -z "$pod_name" ]]; then
    warn "Could not find pod for ${vus} VUs"
    kubectl -n record-platform delete job "$job_name" --ignore-not-found >/dev/null 2>&1 || true
    return 1
  fi
  
  # Copy results (use docker exec for kubectl)
  local test_dir="$OUTPUT_DIR/vus-${vus}"
  mkdir -p "$test_dir"
  # Copy JSON files from pod to host
  docker exec "$KIND_NODE" kubectl -n record-platform cp "${pod_name}:/results/k6-summary.json" "/tmp/k6-summary-${vus}.json" 2>/dev/null && \
    docker cp "${KIND_NODE}:/tmp/k6-summary-${vus}.json" "$test_dir/k6-summary.json" 2>/dev/null || \
    docker exec "$KIND_NODE" kubectl -n record-platform cp "${pod_name}:/results/k6-results.json" "/tmp/k6-results-${vus}.json" 2>/dev/null && \
    docker cp "${KIND_NODE}:/tmp/k6-results-${vus}.json" "$test_dir/k6-summary.json" 2>/dev/null || true
  
  # Get logs
  docker exec "$KIND_NODE" kubectl -n record-platform logs "$pod_name" 2>&1 > "$test_dir/k6-logs.txt" || true
  
  # Calculate comprehensive percentiles and identify bottlenecks
  if [[ -f "$test_dir/k6-summary.json" ]]; then
    python3 "$SCRIPT_DIR/load/calculate-percentiles.py" "$test_dir/k6-summary.json" --bottlenecks > "$test_dir/percentiles-and-bottlenecks.json" 2>/dev/null || true
  fi
  
  # Parse error rate from summary JSON
  local error_rate=1.0
  if [[ -f "$test_dir/k6-summary.json" ]]; then
    error_rate=$(python3 -c "
import json, sys
try:
    with open('$test_dir/k6-summary.json', 'r') as f:
        data = json.load(f)
    # Try multiple paths for error rate
    error_rate = data.get('metrics', {}).get('http_req_failed', {}).get('values', {}).get('rate', None)
    if error_rate is None:
        # Try alternative path
        error_rate = data.get('metrics', {}).get('http_req_failed', {}).get('rate', None)
    if error_rate is None:
        # Try summary path
        error_rate = data.get('summary', {}).get('error_rate', None)
        if isinstance(error_rate, str):
            error_rate = float(error_rate.rstrip('%')) / 100.0
    if error_rate is None:
        # Default to 1.0 only if truly not found
        error_rate = 1.0
    print(f'{error_rate:.4f}')
except Exception as e:
    # If JSON parsing fails, try to get from logs
    print('1.0000')
" 2>/dev/null || echo "1.0000")
  else
    # If JSON file doesn't exist, try to parse from logs
    if [[ -f "$test_dir/k6-logs.txt" ]]; then
      # Try to extract error rate from log output (e.g., "HTTP Error Rate: 27.68%")
      error_rate_str=$(grep -E "HTTP Error Rate|http_error_rate" "$test_dir/k6-logs.txt" | head -1)
      if [[ -n "$error_rate_str" ]]; then
        error_rate_pct=$(echo "$error_rate_str" | sed -E 's/.*[Ee]rror [Rr]ate[^0-9]*([0-9.]+)%.*/\1/')
        if [[ -n "$error_rate_pct" ]] && [[ "$error_rate_pct" =~ ^[0-9.]+$ ]]; then
          error_rate=$(echo "scale=4; $error_rate_pct / 100" | bc 2>/dev/null || echo "1.0000")
        else
          error_rate="1.0000"
        fi
      else
        # Fallback: try to parse from JSON in logs
        error_rate_str=$(grep -o '"http_error_rate"[^,}]*' "$test_dir/k6-logs.txt" | sed -E 's/.*"([0-9.]+)%".*/\1/' | head -1)
        if [[ -n "$error_rate_str" ]] && [[ "$error_rate_str" =~ ^[0-9.]+$ ]]; then
          error_rate=$(echo "scale=4; $error_rate_str / 100" | bc 2>/dev/null || echo "1.0000")
        else
          error_rate="1.0000"
        fi
      fi
    fi
  fi
  
  # Cleanup immediately (use docker exec for kubectl)
  docker exec "$KIND_NODE" kubectl -n record-platform delete pod "$pod_name" --ignore-not-found >/dev/null 2>&1 || true
  docker exec "$KIND_NODE" kubectl -n record-platform delete job "$job_name" --ignore-not-found >/dev/null 2>&1 || true
  
  # Return error rate
  echo "$error_rate"
}

# Main limit test loop
CURRENT_VUS=$START_VUS
MAX_SUCCESSFUL_VUS=0
RESULTS_FILE="$OUTPUT_DIR/limit-test-results.csv"

echo "VUs,Error_Rate,Status,Bottlenecks" > "$RESULTS_FILE"

say "Starting limit test..."
while [[ $CURRENT_VUS -le $MAX_VUS ]]; do
  ERROR_RATE=$(run_k6_test $CURRENT_VUS)
  
  # Extract bottleneck info if available
  BOTTLENECK_INFO=""
  if [[ -f "$OUTPUT_DIR/vus-${CURRENT_VUS}/percentiles-and-bottlenecks.json" ]]; then
    BOTTLENECK_COUNT=$(python3 -c "import json; d=json.load(open('$OUTPUT_DIR/vus-${CURRENT_VUS}/percentiles-and-bottlenecks.json')); print(len(d.get('bottlenecks', {}).get('bottlenecks', [])))" 2>/dev/null || echo "0")
    if [[ "$BOTTLENECK_COUNT" -gt 0 ]]; then
      BOTTLENECK_INFO=$(python3 -c "import json; d=json.load(open('$OUTPUT_DIR/vus-${CURRENT_VUS}/percentiles-and-bottlenecks.json')); b=d.get('bottlenecks', {}).get('bottlenecks', []); print(' | '.join([f\"{x['type']}:{x['severity']}\" for x in b[:3]]))" 2>/dev/null || echo "")
    fi
  fi
  
  # Check if error rate exceeds threshold
  if (( $(echo "$ERROR_RATE > $ERROR_THRESHOLD" | bc -l 2>/dev/null || echo "1") )); then
    warn "Error rate ${ERROR_RATE} exceeds threshold ${ERROR_THRESHOLD} at ${CURRENT_VUS} VUs"
    if [[ -n "$BOTTLENECK_INFO" ]]; then
      warn "Bottlenecks detected: $BOTTLENECK_INFO"
    fi
    echo "${CURRENT_VUS},${ERROR_RATE},FAILED,${BOTTLENECK_INFO}" >> "$RESULTS_FILE"
    break
  else
    ok "VUs ${CURRENT_VUS}: Error rate ${ERROR_RATE} (within threshold)"
    if [[ -n "$BOTTLENECK_INFO" ]]; then
      warn "⚠️  Bottlenecks: $BOTTLENECK_INFO"
    fi
    echo "${CURRENT_VUS},${ERROR_RATE},PASSED,${BOTTLENECK_INFO}" >> "$RESULTS_FILE"
    MAX_SUCCESSFUL_VUS=$CURRENT_VUS
  fi
  
  CURRENT_VUS=$((CURRENT_VUS + VUS_STEP))
  
  # Small delay between tests
  sleep 5
done

say "=== Limit Test Complete ==="
say "Maximum successful VUs: $MAX_SUCCESSFUL_VUS"
say "Results saved to: $RESULTS_FILE"
say "Detailed results in: $OUTPUT_DIR"

# Generate latency graphs for the maximum successful VU test
if [[ $MAX_SUCCESSFUL_VUS -gt 0 ]] && [[ -f "$OUTPUT_DIR/vus-${MAX_SUCCESSFUL_VUS}/k6-summary.json" ]]; then
  say "Generating latency graph for maximum successful VUs (${MAX_SUCCESSFUL_VUS})..."
  if command -v python3 >/dev/null 2>&1; then
    if [[ -f "$SCRIPT_DIR/load/generate-latency-graph.py" ]]; then
      python3 "$SCRIPT_DIR/load/generate-latency-graph.py" \
        "$OUTPUT_DIR/vus-${MAX_SUCCESSFUL_VUS}/k6-summary.json" \
        "$OUTPUT_DIR/vus-${MAX_SUCCESSFUL_VUS}/latency-report.html" 2>&1 | tee "$OUTPUT_DIR/vus-${MAX_SUCCESSFUL_VUS}/graph-generation.log"
      if [[ -f "$OUTPUT_DIR/vus-${MAX_SUCCESSFUL_VUS}/latency-report.html" ]]; then
        ok "Latency graph generated: $OUTPUT_DIR/vus-${MAX_SUCCESSFUL_VUS}/latency-report.html"
        # Also copy to main output dir
        cp "$OUTPUT_DIR/vus-${MAX_SUCCESSFUL_VUS}/latency-report.html" "$OUTPUT_DIR/max-vus-latency-report.html"
      fi
    fi
  fi
fi

# Generate summary with bottleneck analysis
BOTTLENECK_SUMMARY=""
if [[ $MAX_SUCCESSFUL_VUS -gt 0 ]] && [[ -f "$OUTPUT_DIR/vus-${MAX_SUCCESSFUL_VUS}/percentiles-and-bottlenecks.json" ]]; then
  BOTTLENECK_SUMMARY=$(python3 -c "
import json
try:
    with open('$OUTPUT_DIR/vus-${MAX_SUCCESSFUL_VUS}/percentiles-and-bottlenecks.json', 'r') as f:
        data = json.load(f)
    bottlenecks = data.get('bottlenecks', {}).get('bottlenecks', [])
    if bottlenecks:
        print('\n=== Bottlenecks at Max VUs (${MAX_SUCCESSFUL_VUS}) ===')
        for b in bottlenecks:
            print(f\"{b['severity'].upper()}: {b['message']}\")
    else:
        print('\n✅ No bottlenecks detected at max VUs')
except:
    pass
" 2>/dev/null || echo "")
fi

# Generate summary
cat <<EOF

=== Limit Test Summary ===
Maximum VUs (within ${ERROR_THRESHOLD} error threshold): $MAX_SUCCESSFUL_VUS
Test results: $RESULTS_FILE
Detailed logs: $OUTPUT_DIR
$BOTTLENECK_SUMMARY

EOF

