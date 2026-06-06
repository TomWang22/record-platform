#!/usr/bin/env bash
set -eo pipefail

# Run k6 listings service tests INSIDE the cluster with latency graphs

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

say "=== K6 Listings Service Test with Latency Graphs ==="

       # Use standard k6 image with CA cert ConfigMap for strict TLS
       K6_IMAGE="${K6_IMAGE:-grafana/k6:latest}"

# Create output directory
OUTPUT_DIR="${OUTPUT_DIR:-$PROJECT_ROOT/results/k6-listings-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$OUTPUT_DIR"

say "Output directory: $OUTPUT_DIR"

# Create a Job to run k6 inside the cluster
JOB_NAME="k6-listings-graphs-$(date +%s)"

say "Creating k6 job: $JOB_NAME"

# Copy k6 script to a ConfigMap
kubectl -n record-platform create configmap k6-listings-script-graphs \
  --from-file=test.js="$SCRIPT_DIR/load/k6-listings-service-comprehensive.js" \
  --dry-run=client -o yaml | kubectl apply -f - >/dev/null 2>&1 || true

# Create CA certificate ConfigMap for strict TLS (REQUIRED for production)
CA_ROOT="$(mkcert -CAROOT 2>/dev/null)/rootCA.pem" || CA_ROOT=""
if [[ -f "$CA_ROOT" ]]; then
  say "Creating CA certificate ConfigMap for strict TLS (production-ready)..."
  kubectl -n record-platform create configmap k6-ca-cert \
    --from-file=ca.crt="$CA_ROOT" \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null
  ok "CA certificate ConfigMap created - strict TLS enabled"
else
  fail "mkcert CA not found at $CA_ROOT - strict TLS verification REQUIRED for production testing"
fi

# Get Caddy service ClusterIP for hostAliases
CADDY_CLUSTER_IP=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.spec.clusterIP}' 2>/dev/null)
if [[ -z "$CADDY_CLUSTER_IP" ]]; then
  # Fallback to API Gateway ClusterIP
  API_GATEWAY_IP=$(kubectl -n record-platform get svc api-gateway -o jsonpath='{.spec.clusterIP}' 2>/dev/null)
  if [[ -z "$API_GATEWAY_IP" ]]; then
    fail "Could not get Caddy or API Gateway service ClusterIP"
  fi
  say "Using API Gateway ClusterIP: $API_GATEWAY_IP for record.local resolution"
  CADDY_CLUSTER_IP="$API_GATEWAY_IP"
else
  say "Using Caddy ClusterIP: $CADDY_CLUSTER_IP for record.local resolution"
fi

# k6 image selection - use custom image if available for strict TLS
K6_IMAGE="${K6_IMAGE:-grafana/k6:latest}"
USE_INSECURE_TLS=true
# Check if custom k6 image with CA cert is available
if docker image inspect k6-strict-tls:dev >/dev/null 2>&1; then
  # Try to load into Kind cluster
  KIND_NODE=$(docker ps --format "{{.Names}}" | grep h3-control-plane | head -1 || echo "")
  if [[ -n "$KIND_NODE" ]]; then
    # Check if image already in Kind
    if docker exec "$KIND_NODE" ctr -n k8s.io images ls | grep -q "k6-strict-tls:dev"; then
      K6_IMAGE="k6-strict-tls:dev"
      USE_INSECURE_TLS=false
      say "Using custom k6 image with CA cert for strict TLS (already in Kind)"
    else
      # Load image into Kind
      docker save k6-strict-tls:dev -o /tmp/k6-strict-tls.tar 2>/dev/null && \
      docker cp /tmp/k6-strict-tls.tar "$KIND_NODE":/tmp/ 2>/dev/null && \
      docker exec "$KIND_NODE" ctr -n k8s.io images import /tmp/k6-strict-tls.tar 2>/dev/null && \
      docker exec "$KIND_NODE" rm -f /tmp/k6-strict-tls.tar 2>/dev/null && \
      rm -f /tmp/k6-strict-tls.tar 2>/dev/null && {
        K6_IMAGE="k6-strict-tls:dev"
        USE_INSECURE_TLS=false
        say "Using custom k6 image with CA cert for strict TLS (loaded into Kind)"
      } || warn "Failed to load custom image into Kind, using standard image"
    fi
  else
    warn "Kind node not found, using standard k6 image"
  fi
else
  warn "Custom k6 image not found, using grafana/k6:latest with --insecure-skip-tls-verify"
fi

# Test configuration
VUS="${VUS:-50}"
DURATION="${DURATION:-5m}"

# Create k6 job to run inside cluster with summary export
cat <<EOF | kubectl apply -f -
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
          # k6 automatically supports HTTP/2 and HTTP/3 (QUIC) via ALPN negotiation
          # STRICT TLS: CA certificate mounted at /etc/ssl/certs/k6-ca.crt
          # k6 will still use HTTP/2/3 - TLS verification ensures production-ready security
          export SSL_CERT_FILE=/etc/ssl/certs/k6-ca.crt
          echo "Using STRICT TLS (production-ready) - CA cert: $SSL_CERT_FILE"
          k6 run \
            --vus ${VUS} \
            --duration ${DURATION} \
            --summary-trend-stats="min,max,avg,med,p(1),p(5),p(10),p(25),p(50),p(75),p(90),p(95),p(99),p(99.9),p(99.99),p(99.999),p(99.9999),p(99.99999),p(99.999999),p(100)" \
            --out json=/results/k6-results.json \
            --summary-export=/results/k6-summary.json \
            /scripts/test.js || true
          echo "k6 exit code: $?"
          ls -lh /results/ 2>&1 || true
          # Keep container alive for a few seconds to allow file copy
          sleep 5
        env:
        - name: BASE_URL
          value: "https://caddy-h3.ingress-nginx.svc.cluster.local:443"
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
      volumes:
      - name: k6-script
        configMap:
          name: k6-listings-script-graphs
      - name: k6-ca-cert
        configMap:
          name: k6-ca-cert
      - name: results
        emptyDir: {}
EOF

ok "Job created: $JOB_NAME"

# Wait for job to complete (with timeout and progress monitoring)
TIMEOUT=1200  # 20 minutes
ELAPSED=0
say "Monitoring job progress..."
while [[ $ELAPSED -lt $TIMEOUT ]]; do
  STATUS=$(kubectl -n record-platform get job "$JOB_NAME" -o jsonpath='{.status.conditions[?(@.type=="Complete")].status}' 2>/dev/null || echo "")
  if [[ "$STATUS" == "True" ]]; then
    ok "Job completed successfully"
    # Try to copy files immediately while pod might still be available
    POD_NAME=$(kubectl -n record-platform get pods -l job-name="$JOB_NAME" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
    if [[ -n "$POD_NAME" ]]; then
      # Try to copy files before pod terminates
      kubectl -n record-platform cp "${POD_NAME}:/results/k6-summary.json" "$OUTPUT_DIR/k6-summary.json" 2>/dev/null || true
      kubectl -n record-platform cp "${POD_NAME}:/results/k6-results.json" "$OUTPUT_DIR/k6-results.json" 2>/dev/null || true
    fi
    # Wait a moment for files to be finalized
    sleep 2
    break
  fi
  
  FAILED=$(kubectl -n record-platform get job "$JOB_NAME" -o jsonpath='{.status.conditions[?(@.type=="Failed")].status}' 2>/dev/null || echo "")
  if [[ "$FAILED" == "True" ]]; then
    warn "Job failed, but will try to retrieve results anyway"
    # Try to copy files before pod terminates
    POD_NAME=$(kubectl -n record-platform get pods -l job-name="$JOB_NAME" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
    if [[ -n "$POD_NAME" ]]; then
      kubectl -n record-platform cp "${POD_NAME}:/results/k6-summary.json" "$OUTPUT_DIR/k6-summary.json" 2>/dev/null || true
      kubectl -n record-platform cp "${POD_NAME}:/results/k6-results.json" "$OUTPUT_DIR/k6-results.json" 2>/dev/null || true
    fi
    # Wait a moment for files to be finalized even if job failed
    sleep 2
    break
  fi
  
  # Show progress every 30 seconds
  if [[ $((ELAPSED % 30)) -eq 0 ]] && [[ $ELAPSED -gt 0 ]]; then
    POD_NAME=$(kubectl -n record-platform get pods -l job-name="$JOB_NAME" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
    if [[ -n "$POD_NAME" ]]; then
      # Get iteration count from logs (if available)
      ITERATIONS=$(kubectl -n record-platform logs "$POD_NAME" 2>&1 | grep -o "complete and [0-9]* interrupted iterations" | tail -1 | grep -o "[0-9]*" | head -1 || echo "")
      if [[ -n "$ITERATIONS" ]]; then
        echo "  Progress: ${ITERATIONS} iterations completed (${ELAPSED}s elapsed)"
      else
        echo "  Still running... (${ELAPSED}s elapsed)"
      fi
    fi
  fi
  
  sleep 5
  ELAPSED=$((ELAPSED + 5))
done

# Get pod name
POD_NAME=$(kubectl -n record-platform get pods -l job-name=${JOB_NAME} -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")

if [[ -z "$POD_NAME" ]]; then
  fail "Could not find pod for job ${JOB_NAME}"
fi

say "Retrieving test results from pod: $POD_NAME"

# Check if pod is still running - if so, wait for it to finish writing
POD_PHASE=$(kubectl -n record-platform get pod "$POD_NAME" -o jsonpath='{.status.phase}' 2>/dev/null || echo "Unknown")
if [[ "$POD_PHASE" == "Running" ]]; then
  say "Pod still running, waiting for completion..."
  kubectl -n record-platform wait --for=condition=Ready=false --timeout=60s pod/"$POD_NAME" 2>/dev/null || true
  sleep 2
fi

# Copy results from pod
say "Copying results from pod..."
# Try multiple methods to copy files
SUCCESS=false

# Method 1: kubectl cp (preferred)
for attempt in {1..3}; do
  if kubectl -n record-platform cp "${POD_NAME}:/results/k6-summary.json" "$OUTPUT_DIR/k6-summary.json" 2>/dev/null; then
    ok "Copied k6-summary.json via kubectl cp (attempt $attempt)"
    SUCCESS=true
    break
  elif [[ $attempt -lt 3 ]]; then
    sleep 2
  fi
done

# Method 2: kubectl exec + cat (fallback if cp fails)
if [[ ! -f "$OUTPUT_DIR/k6-summary.json" ]]; then
  say "Trying alternative copy method (kubectl exec)..."
  kubectl -n record-platform exec "$POD_NAME" -- cat /results/k6-summary.json > "$OUTPUT_DIR/k6-summary.json" 2>/dev/null && {
    ok "Copied k6-summary.json via kubectl exec"
    SUCCESS=true
  } || warn "Could not copy via exec either"
fi

# Also copy results.json as fallback
if ! kubectl -n record-platform cp "${POD_NAME}:/results/k6-results.json" "$OUTPUT_DIR/k6-results.json" 2>/dev/null; then
  kubectl -n record-platform exec "$POD_NAME" -- cat /results/k6-results.json > "$OUTPUT_DIR/k6-results.json" 2>/dev/null || warn "Could not copy results.json"
fi

# If summary.json doesn't exist but results.json does, use results.json as summary
if [[ ! -f "$OUTPUT_DIR/k6-summary.json" ]] && [[ -f "$OUTPUT_DIR/k6-results.json" ]]; then
  cp "$OUTPUT_DIR/k6-results.json" "$OUTPUT_DIR/k6-summary.json"
  ok "Using k6-results.json as summary"
  SUCCESS=true
fi

# Verify we have at least one result file
if [[ ! -f "$OUTPUT_DIR/k6-summary.json" ]]; then
  warn "No summary or results file found. Checking pod contents..."
  # Try to exec into pod if still running, or check previous container logs
  kubectl -n record-platform exec "$POD_NAME" -- ls -la /results/ 2>&1 || \
    kubectl -n record-platform logs "$POD_NAME" --previous 2>&1 | tail -20 || true
fi

# Get logs
say "Retrieving test logs..."
kubectl -n record-platform logs "$POD_NAME" 2>&1 | tee "$OUTPUT_DIR/k6-logs.txt" | tail -100

# Generate latency graphs and markdown report if summary.json exists
if [[ -f "$OUTPUT_DIR/k6-summary.json" ]]; then
  say "Generating latency graphs and markdown report..."
  
  if command -v python3 >/dev/null 2>&1; then
    # Generate HTML report
    if [[ -f "$SCRIPT_DIR/load/generate-latency-graph.py" ]]; then
      python3 "$SCRIPT_DIR/load/generate-latency-graph.py" "$OUTPUT_DIR/k6-summary.json" "$OUTPUT_DIR/latency-report.html" 2>&1 | tee "$OUTPUT_DIR/graph-generation.log"
      if [[ -f "$OUTPUT_DIR/latency-report.html" ]]; then
        ok "Latency graphs generated: $OUTPUT_DIR/latency-report.html"
        say "Open the report in your browser:"
        echo "  open $OUTPUT_DIR/latency-report.html"
        
        # Also copy to project root for easy access
        cp "$OUTPUT_DIR/latency-report.html" "$PROJECT_ROOT/listings-latency-report.html"
        ok "Report also copied to: $PROJECT_ROOT/listings-latency-report.html"
      else
        warn "Failed to generate latency graphs"
      fi
    else
      warn "Graph generation script not found: $SCRIPT_DIR/load/generate-latency-graph.py"
    fi
    
    # Generate Markdown report (try summary.json first, fallback to results.json)
    if [[ -f "$SCRIPT_DIR/load/generate-markdown-report.py" ]]; then
      MARKDOWN_INPUT="$OUTPUT_DIR/k6-summary.json"
      if [[ ! -s "$MARKDOWN_INPUT" ]] && [[ -f "$OUTPUT_DIR/k6-results.json" ]]; then
        MARKDOWN_INPUT="$OUTPUT_DIR/k6-results.json"
        say "Using k6-results.json for markdown report (summary.json is empty)"
      fi
      
      if [[ -s "$MARKDOWN_INPUT" ]]; then
        python3 "$SCRIPT_DIR/load/generate-markdown-report.py" "$MARKDOWN_INPUT" "$OUTPUT_DIR/metrics-report.md" 2>&1 | tee -a "$OUTPUT_DIR/graph-generation.log"
        if [[ -f "$OUTPUT_DIR/metrics-report.md" ]]; then
          ok "Markdown report generated: $OUTPUT_DIR/metrics-report.md"
          
          # Also copy to project root for easy access
          cp "$OUTPUT_DIR/metrics-report.md" "$PROJECT_ROOT/listings-metrics-report.md"
          ok "Markdown report also copied to: $PROJECT_ROOT/listings-metrics-report.md"
        else
          warn "Failed to generate markdown report"
        fi
      else
        warn "No valid input file found for markdown report generation"
      fi
    else
      warn "Markdown report script not found: $SCRIPT_DIR/load/generate-markdown-report.py"
    fi
  else
    warn "python3 not found - skipping report generation"
  fi
else
  warn "Summary JSON not found - cannot generate reports"
fi

# Wait a bit more to ensure files are fully written
sleep 2

# Cleanup pod and job immediately after results are copied
say "Cleaning up pod and job..."
kubectl -n record-platform delete pod "$POD_NAME" --ignore-not-found >/dev/null 2>&1 || true
kubectl -n record-platform delete job "$JOB_NAME" --ignore-not-found >/dev/null 2>&1 || true
ok "Cleanup complete"

say "=== Test Complete ==="
ok "Results in: $OUTPUT_DIR"

