#!/usr/bin/env bash
set -euo pipefail

# Run distributed k6 load test for CA rotation
# This runs k6 inside the cluster to avoid NodePort/port-forward bottlenecks
# Supports both single-instance and distributed (multiple pods) testing

# FIX: Use separate namespace for k6 jobs to prevent them from being killed during CA rotation
K6_NS="${K6_NS:-k6-load}"
NS="${NS:-ingress-nginx}"  # Keep NS for caddy service reference
BASE_URL="${BASE_URL:-https://caddy-h3.${NS}.svc.cluster.local:443}"

# Create k6-load namespace if it doesn't exist
if [[ "${BACKGROUND_MODE:-false}" != "true" ]]; then
  kubectl create namespace "$K6_NS" --dry-run=client -o yaml | kubectl apply -f - >/dev/null 2>&1
fi
HOST="${HOST:-record.local}"
ENDPOINT="${ENDPOINT:-/_caddy/healthz}"
DURATION="${DURATION:-180s}"  # 3 minutes to cover rotation
VUS="${VUS:-30}"  # Virtual users (concurrent requests)
RATE="${RATE:-0}"  # Target rate (0 = use VUS, >0 = constant rate)
INSTANCES="${INSTANCES:-1}"  # Number of k6 instances (for distributed testing)
TIMEOUT="${TIMEOUT:-3s}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
error() { echo "❌ $*"; }

if [[ "${BACKGROUND_MODE:-false}" != "true" ]]; then
  say "=== Running Distributed k6 CA Rotation Load Test ==="
  echo "Namespace: $NS"
  echo "Base URL: $BASE_URL"
  echo "Host: $HOST"
  echo "Endpoint: $ENDPOINT"
  echo "Duration: $DURATION"
  echo "Virtual Users: $VUS"
  echo "Rate: ${RATE:-unlimited (using VUS)}"
  echo "Instances: $INSTANCES"
  echo ""
fi

# Check if k6 script exists
SCRIPT_PATH="scripts/load/k6-ca-rotation.js"
if [[ ! -f "$SCRIPT_PATH" ]]; then
  error "k6 test script not found: $SCRIPT_PATH"
  exit 1
fi

# Create ConfigMap with the test script
if [[ "${BACKGROUND_MODE:-false}" != "true" ]]; then
  say "Creating ConfigMap with k6 test script..."
fi
kubectl -n "$K6_NS" create configmap k6-ca-rotation-script \
  --from-file="$SCRIPT_PATH" \
  --dry-run=client -o yaml | kubectl apply -f - >/dev/null 2>&1
if [[ "${BACKGROUND_MODE:-false}" != "true" ]]; then
  ok "ConfigMap created"
fi

# Create multiple k6 jobs for distributed testing
if [[ "${BACKGROUND_MODE:-false}" != "true" ]]; then
  say "Creating ${INSTANCES} k6 job instance(s)..."
fi
JOB_NAMES=()
BASE_NAME="k6-ca-rotation-$(date +%s)"
for i in $(seq 1 "$INSTANCES"); do
  JOB_NAME="${BASE_NAME}-${i}"
  # Create job directly (simpler, cleaner)
  kubectl -n "$NS" apply -f - <<EOF >/dev/null 2>&1
apiVersion: batch/v1
kind: Job
metadata:
  name: ${JOB_NAME}
  namespace: ${K6_NS}
  labels:
    app: k6-ca-rotation
    instance: "${i}"
spec:
  ttlSecondsAfterFinished: 600
  template:
    metadata:
      labels:
        app: k6-ca-rotation
        instance: "${i}"
    spec:
      containers:
      - name: k6
        image: grafana/k6:latest
        command: ["sh", "-c"]
        args:
          - |
            k6 run \
              --out json=/tmp/k6-results.json \
              /test-script/k6-ca-rotation.js
        env:
        - name: BASE_URL
          value: "${BASE_URL}"
        - name: HOST
          value: "${HOST}"
        - name: ENDPOINT
          value: "${ENDPOINT}"
        - name: DURATION
          value: "${DURATION}"
        - name: VUS
          value: "${VUS}"
        - name: RATE
          value: "${RATE}"
        - name: TIMEOUT
          value: "${TIMEOUT}"
        volumeMounts:
        - name: test-script
          mountPath: /test-script
          readOnly: true
        resources:
          requests:
            cpu: "500m"
            memory: "512Mi"
          limits:
            cpu: "2"
            memory: "1Gi"
      volumes:
      - name: test-script
        configMap:
          name: k6-ca-rotation-script
      restartPolicy: Never
EOF
  JOB_NAMES+=("$JOB_NAME")
  if [[ "${BACKGROUND_MODE:-false}" != "true" ]]; then
    ok "Job created: $JOB_NAME"
  fi
done

# Wait for jobs to start (silently in background mode)
if [[ "${BACKGROUND_MODE:-false}" != "true" ]]; then
  say "Waiting for jobs to start..."
fi
for job_name in "${JOB_NAMES[@]}"; do
  kubectl -n "$K6_NS" wait --for=condition=Ready pod -l job-name="$job_name" --timeout=60s >/dev/null 2>&1 || true
done

# If running in background mode (for integration with test script), just print job names and exit
if [[ "${BACKGROUND_MODE:-false}" == "true" ]]; then
  # Print ONLY job names (one per line) for the calling script to capture
  for job_name in "${JOB_NAMES[@]}"; do
    echo "$job_name"
  done
  exit 0
fi

# Otherwise, wait for completion and show results
say "k6 jobs are running (waiting for completion)..." >&2

# Wait for all jobs to complete
say "Waiting for all jobs to complete..." >&2
for job_name in "${JOB_NAMES[@]}"; do
  kubectl -n "$K6_NS" wait --for=condition=complete job/"$job_name" --timeout=600s 2>/dev/null || warn "Job $job_name may still be running" >&2
done

# Collect results from all jobs
say "Collecting results from all instances..." >&2
TOTAL_REQUESTS=0
TOTAL_FAILED=0
declare -a SUMMARIES=()

for job_name in "${JOB_NAMES[@]}"; do
  say "Results from $job_name:" >&2
  kubectl -n "$K6_NS" logs job/"$job_name" 2>/dev/null | grep -A 100 "=== CA Rotation Load Test Summary ===" || warn "No summary found in $job_name logs" >&2
  echo "" >&2
done

say "All jobs completed!" >&2
echo "" >&2
echo "To view logs: kubectl -n $K6_NS logs job/<job-name>" >&2
echo "To delete jobs: kubectl -n $K6_NS delete job -l app=k6-ca-rotation" >&2
echo "" >&2
echo "Job names:" >&2
for job_name in "${JOB_NAMES[@]}"; do
  echo "  - $job_name" >&2
done

