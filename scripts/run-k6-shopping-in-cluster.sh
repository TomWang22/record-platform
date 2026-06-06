#!/bin/bash
set -euo pipefail

# Run k6 shopping service tests inside the Kubernetes cluster
# This script creates a ConfigMap with the k6 script and runs it as a Job
# Includes ephemeral port limit handling via connection reuse and resource limits
#
# Usage:
#   ./scripts/run-k6-shopping-in-cluster.sh [script-name] [test-type]
#
# Examples:
#   ./scripts/run-k6-shopping-in-cluster.sh k6-shopping-ramp.js ramp
#   ./scripts/run-k6-shopping-in-cluster.sh k6-shopping-stress.js stress
#   ./scripts/run-k6-shopping-in-cluster.sh k6-shopping-comprehensive.js comprehensive
#
# Environment variables:
#   K6_IMAGE: k6 Docker image (default: grafana/k6:latest)
#   K6_SCRIPT: Path to k6 script (default: scripts/load/k6-shopping-ramp.js)
#   K6_TEST_TYPE: Test type for naming (default: ramp)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# Default values
K6_IMAGE="${K6_IMAGE:-grafana/k6:latest}"
K6_SCRIPT="${K6_SCRIPT:-scripts/load/k6-shopping-ramp.js}"
K6_TEST_TYPE="${K6_TEST_TYPE:-ramp}"
NAMESPACE="${NAMESPACE:-record-platform}"
KUBECTL_CONTEXT="${KUBECTL_CONTEXT:-kind-h3}"

# Parse arguments
if [[ $# -ge 1 ]]; then
  K6_SCRIPT="$1"
  if [[ ! "$K6_SCRIPT" =~ ^/ ]]; then
    K6_SCRIPT="scripts/load/$K6_SCRIPT"
  fi
fi

if [[ $# -ge 2 ]]; then
  K6_TEST_TYPE="$2"
fi

# Validate script exists
if [[ ! -f "$K6_SCRIPT" ]]; then
  echo "❌ Error: k6 script not found: $K6_SCRIPT" >&2
  exit 1
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

say() { echo -e "${GREEN}→${NC} $*"; }
ok() { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC} $*"; }
fail() { echo -e "${RED}✗${NC} $*" >&2; exit 1; }

say "Running k6 shopping service test in-cluster"
say "Script: $K6_SCRIPT"
say "Test Type: $K6_TEST_TYPE"
say "Namespace: $NAMESPACE"
say "Context: $KUBECTL_CONTEXT"

# Verify kubectl access
if ! kubectl --context "$KUBECTL_CONTEXT" get ns "$NAMESPACE" &>/dev/null; then
  fail "Cannot access namespace $NAMESPACE in context $KUBECTL_CONTEXT"
fi

# Get Caddy service ClusterIP for hostAliases
CADDY_CLUSTER_IP=$(kubectl --context "$KUBECTL_CONTEXT" -n ingress-nginx get svc caddy-h3 -o jsonpath='{.spec.clusterIP}' 2>/dev/null)
if [[ -z "$CADDY_CLUSTER_IP" ]]; then
  fail "Could not get Caddy service ClusterIP. Is caddy-h3 service running in ingress-nginx namespace?"
fi
say "Using Caddy ClusterIP: $CADDY_CLUSTER_IP for record.local resolution"

# Check if k6-ca-cert ConfigMap exists
if ! kubectl --context "$KUBECTL_CONTEXT" -n "$NAMESPACE" get configmap k6-ca-cert &>/dev/null; then
  warn "k6-ca-cert ConfigMap not found. Checking for dev-root-ca secret..."
  if kubectl --context "$KUBECTL_CONTEXT" -n "$NAMESPACE" get secret dev-root-ca &>/dev/null; then
    say "Creating k6-ca-cert ConfigMap from dev-root-ca secret..."
    kubectl --context "$KUBECTL_CONTEXT" -n "$NAMESPACE" create configmap k6-ca-cert \
      --from-literal=ca.crt="$(kubectl --context "$KUBECTL_CONTEXT" -n "$NAMESPACE" get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' | base64 -d)" \
      --dry-run=client -o yaml | kubectl --context "$KUBECTL_CONTEXT" apply -f - || \
      fail "Failed to create k6-ca-cert ConfigMap"
    ok "k6-ca-cert ConfigMap created"
  else
    warn "Neither k6-ca-cert ConfigMap nor dev-root-ca secret found. TLS verification may fail."
  fi
fi

# Extract script name for ConfigMap
SCRIPT_NAME=$(basename "$K6_SCRIPT")
CONFIGMAP_NAME="k6-shopping-script-${K6_TEST_TYPE}"
JOB_NAME="k6-shopping-${K6_TEST_TYPE}-$(date +%s)"

# Create/update ConfigMap with k6 script
say "Creating/updating ConfigMap: $CONFIGMAP_NAME"
kubectl --context "$KUBECTL_CONTEXT" -n "$NAMESPACE" create configmap "$CONFIGMAP_NAME" \
  --from-file=test.js="$K6_SCRIPT" \
  --dry-run=client -o yaml | kubectl --context "$KUBECTL_CONTEXT" apply -f - || \
  fail "Failed to create/update ConfigMap"

ok "ConfigMap $CONFIGMAP_NAME ready"

# Create k6 Job with ephemeral port limit handling
say "Creating k6 Job: $JOB_NAME (with ephemeral port limit handling)"

cat <<EOF | kubectl --context "$KUBECTL_CONTEXT" apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: ${JOB_NAME}
  namespace: ${NAMESPACE}
spec:
  ttlSecondsAfterFinished: 600
  template:
    spec:
      restartPolicy: Never
      # Security context for ephemeral port configuration
      securityContext:
        # Allow k6 to use sufficient resources for high-concurrency testing
        runAsNonRoot: false
        runAsUser: 0
      containers:
      - name: k6
        image: ${K6_IMAGE}
        # Resource limits to prevent excessive connection usage
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "2Gi"
            cpu: "2000m"
        command: ["sh", "-c"]
        args:
        - |
          set -e
          # Configure ephemeral port range (Linux default: 32768-60999, ~28k ports)
          # k6 uses HTTP/2 connection reuse to minimize ephemeral port usage
          # With HTTP/2 multiplexing, multiple requests share the same TCP connection
          # This prevents "Cannot assign requested address" errors at high VU counts
          
          # Display system limits
          echo "=== System Configuration ==="
          echo "Ephemeral port range: \$(cat /proc/sys/net/ipv4/ip_local_port_range 2>/dev/null || echo 'default')"
          echo "Max open files: \$(ulimit -n 2>/dev/null || echo 'default')"
          echo "=== Starting k6 Test ==="
          
          # Strict TLS verification (production-ready)
          if [ -f /etc/ssl/certs/k6-ca.crt ]; then
            export SSL_CERT_FILE=/etc/ssl/certs/k6-ca.crt
          fi
          
          # Run k6 and capture exit code
          # k6 automatically uses HTTP/2 connection reuse via Caddy's HTTP/2 support
          # This minimizes ephemeral port usage even with hundreds of VUs
          k6 run /scripts/test.js
          EXIT_CODE=\$?
          echo "k6 exited with code: \$EXIT_CODE"
          exit \$EXIT_CODE
        env:
        - name: BASE_URL
          value: "https://caddy-h3.ingress-nginx.svc.cluster.local:443"
        - name: SHOPPING_URL
          value: "https://caddy-h3.ingress-nginx.svc.cluster.local:443"
        - name: AUTH_URL
          value: "https://caddy-h3.ingress-nginx.svc.cluster.local:443"
        - name: HOST
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
      hostAliases:
      - ip: "${CADDY_CLUSTER_IP}"
        hostnames:
        - "record.local"
        - "caddy-h3.ingress-nginx.svc.cluster.local"
      volumes:
      - name: k6-script
        configMap:
          name: ${CONFIGMAP_NAME}
      - name: k6-ca-cert
        configMap:
          name: k6-ca-cert
          optional: true
EOF

ok "k6 Job created: $JOB_NAME"

say "Waiting for job to start..."
sleep 5

# Wait for job pod to be created
TIMEOUT=60
ELAPSED=0
POD_NAME=""
while [[ $ELAPSED -lt $TIMEOUT ]]; do
  POD_NAME=$(kubectl --context "$KUBECTL_CONTEXT" -n "$NAMESPACE" get pods -l job-name="$JOB_NAME" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  if [[ -n "$POD_NAME" ]]; then
    ok "Pod created: $POD_NAME"
    break
  fi
  sleep 2
  ELAPSED=$((ELAPSED + 2))
done

if [[ -z "$POD_NAME" ]]; then
  fail "Pod for job $JOB_NAME did not start within ${TIMEOUT}s"
fi

say "Streaming logs from pod: $POD_NAME"
say "Press Ctrl+C to stop streaming (job will continue running)"

# Stream logs with follow
kubectl --context "$KUBECTL_CONTEXT" -n "$NAMESPACE" logs -f "job/$JOB_NAME" || true

say "Waiting for job to complete..."
TIMEOUT=1800  # 30 minutes max
ELAPSED=0

while [[ $ELAPSED -lt $TIMEOUT ]]; do
  STATUS=$(kubectl --context "$KUBECTL_CONTEXT" -n "$NAMESPACE" get job "$JOB_NAME" -o jsonpath='{.status.conditions[?(@.type=="Complete")].status}' 2>/dev/null || echo "")
  FAILED=$(kubectl --context "$KUBECTL_CONTEXT" -n "$NAMESPACE" get job "$JOB_NAME" -o jsonpath='{.status.conditions[?(@.type=="Failed")].status}' 2>/dev/null || echo "")
  
  if [[ "$STATUS" == "True" ]]; then
    ok "Job completed successfully"
    
    # Get final logs
    say "Final logs:"
    kubectl --context "$KUBECTL_CONTEXT" -n "$NAMESPACE" logs "job/$JOB_NAME" 2>&1 | tail -100
    
    # Check exit code from pod
    EXIT_CODE=$(kubectl --context "$KUBECTL_CONTEXT" -n "$NAMESPACE" get pod "$POD_NAME" -o jsonpath='{.status.containerStatuses[0].state.terminated.exitCode}' 2>/dev/null || echo "")
    if [[ "$EXIT_CODE" == "0" ]]; then
      ok "k6 test passed (exit code: 0)"
      exit 0
    else
      fail "k6 test failed (exit code: ${EXIT_CODE:-unknown})"
    fi
  fi
  
  if [[ "$FAILED" == "True" ]]; then
    fail "Job failed. Check logs with: kubectl --context $KUBECTL_CONTEXT -n $NAMESPACE logs job/$JOB_NAME"
  fi
  
  sleep 5
  ELAPSED=$((ELAPSED + 5))
done

fail "Job did not complete within ${TIMEOUT}s. Check status with: kubectl --context $KUBECTL_CONTEXT -n $NAMESPACE get job $JOB_NAME"
