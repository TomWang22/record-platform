#!/usr/bin/env bash
set -euo pipefail

# Run k6 HTTP/2 vs HTTP/3 comparison test inside the Kubernetes cluster
# This avoids NodePort UDP routing issues by running k6 inside the cluster

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Configuration
NS="${NS:-record-platform}"
NS_K6="${NS_K6:-k6-load}"
HOST="${HOST:-record.local}"
DURATION="${DURATION:-60s}"
VUS="${VUS:-10}"

# k6 images
K6_IMAGE="${K6_IMAGE:-grafana/k6:latest}"
K6_HTTP3_IMAGE="${K6_HTTP3_IMAGE:-record-platform/k6-http3:latest}"

# Check if k6-http3 image exists
if ! docker image inspect "$K6_HTTP3_IMAGE" >/dev/null 2>&1; then
  warn "k6-http3 Docker image not found: $K6_HTTP3_IMAGE"
  warn "Building k6-http3 Docker image..."
  "$SCRIPT_DIR/build-k6-http3-docker.sh" || fail "Failed to build k6-http3 Docker image"
fi

# Ensure namespace exists
kubectl get ns "$NS_K6" >/dev/null 2>&1 || kubectl create ns "$NS_K6" >/dev/null

# Get Caddy service ClusterIP for hostAliases
CADDY_CLUSTER_IP=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.spec.clusterIP}' 2>/dev/null)
if [[ -z "$CADDY_CLUSTER_IP" ]]; then
  fail "Could not get Caddy service ClusterIP"
fi
ok "Using Caddy ClusterIP: $CADDY_CLUSTER_IP"

# Get CA certificate for strict TLS
CA_CONFIGMAP="${CA_CONFIGMAP:-k6-ca-cert}"
CA_SECRET="${CA_SECRET:-dev-root-ca}"
CA_NS="${CA_NS:-ingress-nginx}"

# Check if CA ConfigMap exists, if not try to get from secret
if ! kubectl -n "$NS_K6" get configmap "$CA_CONFIGMAP" >/dev/null 2>&1; then
  say "Creating CA certificate ConfigMap from secret..."
  if kubectl -n "$CA_NS" get secret "$CA_SECRET" >/dev/null 2>&1; then
    # Extract CA cert from secret
    kubectl -n "$CA_NS" get secret "$CA_SECRET" -o jsonpath='{.data.dev-root\.pem}' | base64 -d > /tmp/ca.crt 2>/dev/null || {
      # Try alternative key name
      kubectl -n "$CA_NS" get secret "$CA_SECRET" -o jsonpath='{.data.ca\.crt}' | base64 -d > /tmp/ca.crt 2>/dev/null || {
        fail "Could not extract CA certificate from secret $CA_SECRET"
      }
    }
    kubectl -n "$NS_K6" create configmap "$CA_CONFIGMAP" \
      --from-file=ca.crt=/tmp/ca.crt \
      --dry-run=client -o yaml | kubectl apply -f - >/dev/null 2>&1
    rm -f /tmp/ca.crt
    ok "CA certificate ConfigMap created"
  else
    warn "CA secret not found, k6 will use system CA certificates"
  fi
fi

# Create k6 test script ConfigMaps
say "Creating k6 test script ConfigMaps..."

# HTTP/2 test script
cat > /tmp/k6-http2-test.js <<'EOF'
import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate } from "k6/metrics";

let latency = new Trend("http2_latency_ms");
let success = new Rate("http2_success");
let errors = new Rate("http2_errors");

export const options = {
  vus: parseInt(__ENV.VUS || "10"),
  duration: __ENV.DURATION || "60s",
  insecureSkipTLSVerify: false,
};

const BASE_URL = __ENV.BASE_URL || "https://record.local";
const HOST = __ENV.HOST || "record.local";

export default function () {
  const params = {
    headers: {
      'Host': HOST,
      'X-Loadtest': '1',
    },
    timeout: '30s',
    httpVersion: 'HTTP/2',
    tags: { name: 'http2_healthz', protocol: 'HTTP/2' },
  };

  const startTime = Date.now();
  const res = http.get(`${BASE_URL}/_caddy/healthz`, params);
  const latency_ms = Date.now() - startTime;

  latency.add(latency_ms);
  const isSuccess = res.status >= 200 && res.status < 300;
  success.add(isSuccess);
  errors.add(!isSuccess);

  check(res, {
    'HTTP/2 status 200': (r) => r.status === 200,
    'HTTP/2 protocol': (r) => r.proto === 'HTTP/2.0',
  });

  sleep(1);
}

export function handleSummary(data) {
  return {
    'stdout': `
=== HTTP/2 Test Results ===
Success Rate: ${(data.metrics.http2_success.values.rate * 100).toFixed(2)}%
Error Rate: ${(data.metrics.http2_errors.values.rate * 100).toFixed(2)}%
Latency (p50): ${data.metrics.http2_latency_ms.values['p(50)'].toFixed(2)}ms
Latency (p95): ${data.metrics.http2_latency_ms.values['p(95)'].toFixed(2)}ms
Latency (p99): ${data.metrics.http2_latency_ms.values['p(99)'].toFixed(2)}ms
Total Requests: ${data.metrics.http_reqs.values.count}
    `,
  };
}
EOF

# HTTP/3 test script (uses custom extension)
cat > /tmp/k6-http3-test.js <<'EOF'
// Try to import HTTP/3 extension (only works with custom k6-http3 binary)
let http3;
try {
  http3 = require('k6/x/http3');
  console.log('[HTTP/3] Extension loaded successfully!');
} catch (e) {
  console.log('[HTTP/3] Extension not available, will use standard k6 httpVersion: "HTTP/3"');
}

import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate } from "k6/metrics";

let latency = new Trend("http3_latency_ms");
let success = new Rate("http3_success");
let errors = new Rate("http3_errors");

export const options = {
  vus: parseInt(__ENV.VUS || "10"),
  duration: __ENV.DURATION || "60s",
  insecureSkipTLSVerify: false,
};

const BASE_URL = __ENV.BASE_URL || "https://record.local";
const HOST = __ENV.HOST || "record.local";

export default function () {
  let res, latency_ms, isSuccess;
  const startTime = Date.now();

  if (http3) {
    // Use custom HTTP/3 extension
    try {
      const result = http3.get(`${BASE_URL}/_caddy/healthz`, {
        headers: { Host: HOST, 'X-Loadtest': '1' },
        timeout: '30s',
        insecureSkipTLSVerify: false,
        serverName: HOST,
      });
      latency_ms = Date.now() - startTime;
      
      if (result.error) {
        throw new Error(result.error);
      }
      
      res = {
        status: result.status || 0,
        status_text: result.status ? 'OK' : 'Error',
        body: result.body || '',
        proto: result.proto || 'HTTP/3',
      };
      isSuccess = res.status >= 200 && res.status < 300;
    } catch (e) {
      res = { status: 0, status_text: 'Request Failed', body: '', error: e.message };
      latency_ms = Date.now() - startTime;
      isSuccess = false;
    }
  } else {
    // Fallback to standard k6 (may use HTTP/2)
    const params = {
      headers: {
        'Host': HOST,
        'X-Loadtest': '1',
      },
      timeout: '30s',
      httpVersion: 'HTTP/3',
      tags: { name: 'http3_healthz', protocol: 'HTTP/3' },
    };
    res = http.get(`${BASE_URL}/_caddy/healthz`, params);
    latency_ms = Date.now() - startTime;
    isSuccess = res.status >= 200 && res.status < 300;
  }

  latency.add(latency_ms);
  success.add(isSuccess);
  errors.add(!isSuccess);

  if (res.status > 0) {
    check(res, {
      'HTTP/3 status 200': (r) => r.status === 200,
    });
  }

  sleep(1);
}

export function handleSummary(data) {
  const http3Success = data.metrics && data.metrics.http3_success ? data.metrics.http3_success.values.rate * 100 : 0;
  const http3Errors = data.metrics && data.metrics.http3_errors ? data.metrics.http3_errors.values.rate * 100 : 0;
  const http3Latency = data.metrics && data.metrics.http3_latency_ms && data.metrics.http3_latency_ms.values ? data.metrics.http3_latency_ms.values : {};
  
  return {
    'stdout': `
=== HTTP/3 Test Results ===
Success Rate: ${http3Success.toFixed(2)}%
Error Rate: ${http3Errors.toFixed(2)}%
Latency (p50): ${http3Latency['p(50)'] ? http3Latency['p(50)'].toFixed(2) : 'N/A'}ms
Latency (p95): ${http3Latency['p(95)'] ? http3Latency['p(95)'].toFixed(2) : 'N/A'}ms
Latency (p99): ${http3Latency['p(99)'] ? http3Latency['p(99)'].toFixed(2) : 'N/A'}ms
Total Requests: ${data.metrics.http_reqs.values.count}
    `,
  };
}
EOF

# Create ConfigMaps
kubectl -n "$NS_K6" create configmap k6-http2-script \
  --from-file=test.js=/tmp/k6-http2-test.js \
  --dry-run=client -o yaml | kubectl apply -f - >/dev/null 2>&1

kubectl -n "$NS_K6" create configmap k6-http3-script \
  --from-file=test.js=/tmp/k6-http3-test.js \
  --dry-run=client -o yaml | kubectl apply -f - >/dev/null 2>&1

ok "k6 test scripts created"

# Load k6-http3 image into Kind (if using Kind)
if command -v kind >/dev/null 2>&1; then
  CLUSTER_NAME="${KIND_CLUSTER:-h3}"
  if kind get clusters 2>/dev/null | grep -q "^${CLUSTER_NAME}$"; then
    say "Loading k6-http3 image into Kind cluster..."
    kind load docker-image "$K6_HTTP3_IMAGE" --name "$CLUSTER_NAME" >/dev/null 2>&1 || warn "Failed to load image into Kind (may need to build locally)"
  fi
fi

# Function to run k6 job and collect results
run_k6_job() {
  local protocol=$1
  local image=$2
  local script_cm=$3
  local job_name="k6-${protocol}-$(date +%s)"
  
  say "Running k6 ${protocol} test: $job_name"
  
  # Create job manifest
  cat <<EOF | kubectl apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: ${job_name}
  namespace: ${NS_K6}
spec:
  ttlSecondsAfterFinished: 300
  template:
    spec:
      restartPolicy: Never
      containers:
      - name: k6
        image: ${image}
        imagePullPolicy: Never
        command: ["sh", "-c"]
        args:
        - |
          export SSL_CERT_FILE=/etc/ssl/certs/k6-ca.crt
          export BASE_URL=https://record.local
          export HOST=${HOST}
          export VUS=${VUS}
          export DURATION=${DURATION}
          k6 run /scripts/test.js
        volumeMounts:
        - name: k6-script
          mountPath: /scripts
          readOnly: true
        - name: k6-ca-cert
          mountPath: /etc/ssl/certs/k6-ca.crt
          subPath: ca.crt
          readOnly: true
      hostAliases:
      - ip: ${CADDY_CLUSTER_IP}
        hostnames:
        - record.local
      volumes:
      - name: k6-script
        configMap:
          name: ${script_cm}
      - name: k6-ca-cert
        configMap:
          name: ${CA_CONFIGMAP}
          optional: true
EOF

  ok "Job created: $job_name"
  
  # Wait for job to start (pod created)
  say "Waiting for job to start..."
  sleep 5
  POD_NAME=""
  for i in {1..30}; do
    POD_NAME=$(kubectl -n "$NS_K6" get pods -l job-name="$job_name" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
    if [[ -n "$POD_NAME" ]]; then
      break
    fi
    sleep 2
  done
  
  if [[ -z "$POD_NAME" ]]; then
    warn "Pod not found for job $job_name"
    kubectl -n "$NS_K6" get job "$job_name" 2>&1
    kubectl -n "$NS_K6" get pods -l job-name="$job_name" 2>&1
    return 1
  fi
  
  # Wait for pod to be running (not ImagePullBackOff)
  say "Waiting for pod to be ready..."
  for i in {1..60}; do
    POD_STATUS=$(kubectl -n "$NS_K6" get pod "$POD_NAME" -o jsonpath='{.status.phase}' 2>/dev/null || echo "")
    if [[ "$POD_STATUS" == "Running" ]] || [[ "$POD_STATUS" == "Succeeded" ]]; then
      break
    fi
    CONTAINER_STATUS=$(kubectl -n "$NS_K6" get pod "$POD_NAME" -o jsonpath='{.status.containerStatuses[0].state.waiting.reason}' 2>/dev/null || echo "")
    if [[ "$CONTAINER_STATUS" == "ImagePullBackOff" ]] || [[ "$CONTAINER_STATUS" == "ErrImagePull" ]]; then
      warn "Image pull failed for pod $POD_NAME"
      kubectl -n "$NS_K6" describe pod "$POD_NAME" 2>&1 | grep -A 10 "Events:" | head -15
      return 1
    fi
    sleep 2
  done
  
  # Wait for job to complete
  say "Waiting for job to complete..."
  kubectl -n "$NS_K6" wait --for=condition=complete --timeout=300s job/"$job_name" >/dev/null 2>&1 || {
    warn "Job did not complete within timeout, checking status..."
    kubectl -n "$NS_K6" get job "$job_name"
    # Try to get logs anyway
  }
  
  if [[ -n "$POD_NAME" ]]; then
    # Get logs (which contain the summary)
    say "Collecting results..."
    kubectl -n "$NS_K6" logs "$POD_NAME" 2>&1 | tee "/tmp/k6-${protocol}-results.txt"
    ok "Results saved to /tmp/k6-${protocol}-results.txt"
  else
    warn "Could not find pod for job $job_name"
    return 1
  fi
  
  # Cleanup
  kubectl -n "$NS_K6" delete job "$job_name" --ignore-not-found=true >/dev/null 2>&1
  
  echo "$job_name"
}

# Run HTTP/2 test
say "=== Running HTTP/2 Test ==="
HTTP2_JOB=$(run_k6_job "http2" "$K6_IMAGE" "k6-http2-script")

# Wait a bit between tests
sleep 5

# Run HTTP/3 test
say "=== Running HTTP/3 Test ==="
HTTP3_JOB=$(run_k6_job "http3" "$K6_HTTP3_IMAGE" "k6-http3-script")

# Compare results
say "=== Comparison Summary ==="
if [[ -f /tmp/k6-http2-results.txt ]] && [[ -f /tmp/k6-http3-results.txt ]]; then
  echo ""
  echo "HTTP/2 Results:"
  grep -A 10 "=== HTTP/2 Test Results ===" /tmp/k6-http2-results.txt || echo "Results not found"
  echo ""
  echo "HTTP/3 Results:"
  grep -A 10 "=== HTTP/3 Test Results ===" /tmp/k6-http3-results.txt || echo "Results not found"
else
  warn "Result files not found"
fi

# Cleanup temp files
rm -f /tmp/k6-http2-test.js /tmp/k6-http3-test.js

say "=== Comparison Test Complete ==="
ok "HTTP/2 results: /tmp/k6-http2-results.txt"
ok "HTTP/3 results: /tmp/k6-http3-results.txt"

