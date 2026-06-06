#!/usr/bin/env bash
# Background script to run rotation test requests from inside cluster
# This avoids macOS NodePort TLS limitations for reliable rotation testing
set -euo pipefail

HOST="${HOST:-record.local}"
NUM_REQUESTS="${1:-15000}"
CONCURRENT_REQUESTS="${2:-20}"
LOG_FILE="${3:-/tmp/rotation-test.log}"

NS_ING="ingress-nginx"

# Get Caddy service ClusterIP
CLUSTER_IP=$(kubectl -n "$NS_ING" get svc caddy-h3 -o jsonpath='{.spec.clusterIP}' 2>/dev/null || echo "")
if [[ -z "$CLUSTER_IP" ]]; then
  echo "ERROR: Could not get Caddy service ClusterIP" >&2
  exit 1
fi

# Create a long-running pod that will execute all requests
# Use a deployment or job that stays alive long enough to complete all requests
kubectl -n "$NS_ING" run rotation-test-runner --restart=Never --image=curlimages/curl -- \
  sh -c "
    REQUEST_COUNT=0
    CONCURRENT=${CONCURRENT_REQUESTS}
    TOTAL=${NUM_REQUESTS}
    
    # Launch initial pool
    PIDS=()
    while [[ \$REQUEST_COUNT -lt \$CONCURRENT ]] && [[ \$REQUEST_COUNT -lt \$TOTAL ]]; do
      (
        RESPONSE=\$(curl -k -sS -w \"\\n%{http_code}\" --http2 --max-time 3.0 \\
          --resolve \"${HOST}:443:${CLUSTER_IP}\" \\
          -H \"Host: ${HOST}\" \\
          \"https://${HOST}:443/_caddy/healthz\" 2>&1 | tail -1 || echo \"timeout\")
        echo \"\$RESPONSE\"
      ) &
      PIDS+=(\$!)
      REQUEST_COUNT=\$((REQUEST_COUNT + 1))
    done
    
    # Maintain pool
    while [[ \$REQUEST_COUNT -lt \$TOTAL ]]; do
      # Wait for any job to complete
      for i in \${!PIDS[@]}; do
        if ! kill -0 \${PIDS[\$i]} 2>/dev/null; then
          wait \${PIDS[\$i]}
          # Launch next request
          (
            RESPONSE=\$(curl -k -sS -w \"\\n%{http_code}\" --http2 --max-time 3.0 \\
              --resolve \"${HOST}:443:${CLUSTER_IP}\" \\
              -H \"Host: ${HOST}\" \\
              \"https://${HOST}:443/_caddy/healthz\" 2>&1 | tail -1 || echo \"timeout\")
            echo \"\$RESPONSE\"
          ) &
          PIDS[\$i]=\$!
          REQUEST_COUNT=\$((REQUEST_COUNT + 1))
          break
        fi
      done
      sleep 0.01
    done
    
    # Wait for all remaining
    for pid in \${PIDS[@]}; do
      wait \$pid 2>/dev/null || true
    done
  " 2>&1 | tee "$LOG_FILE"


