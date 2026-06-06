#!/usr/bin/env bash
# Fix pod readiness issues - root cause fixes
# 1. Ensures service-tls secret exists
# 2. Waits for pods after restarts (they need time to start)
# 3. Checks for actual application startup issues

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

[[ -f "$SCRIPT_DIR/lib/kubectl-helper.sh" ]] && . "$SCRIPT_DIR/lib/kubectl-helper.sh" || true
_kubectl() { kctl "$@" 2>/dev/null || kubectl --request-timeout=15s "$@"; }

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
fail(){ echo "❌ $*" >&2; }

NS="record-platform"
SERVICES=("auth-service" "records-service" "listings-service" "social-service" "shopping-service" "analytics-service" "auction-monitor" "python-ai-service" "api-gateway")

say "=== Fixing Pod Readiness Issues ==="

# Step 1: Ensure service-tls secret exists
say "1. Ensuring service-tls secret exists..."
if ! _kubectl get secret service-tls -n "$NS" --request-timeout=5s >/dev/null 2>&1; then
  warn "service-tls secret missing - this will cause volume mount failures"
  warn "Run: ./scripts/reissue-ca-and-leaf-load-all-services.sh (with KAFKA_SSL=1)"
  # Try to create a minimal secret to prevent mount failures
  if [[ -f "$SCRIPT_DIR/../certs/record.local.crt" ]] && [[ -f "$SCRIPT_DIR/../certs/record.local.key" ]]; then
    say "Creating service-tls secret from certs/..."
    _kubectl create secret generic service-tls -n "$NS" \
      --from-file=tls.crt="$SCRIPT_DIR/../certs/record.local.crt" \
      --from-file=tls.key="$SCRIPT_DIR/../certs/record.local.key" \
      --from-file=ca.crt="$SCRIPT_DIR/../certs/dev-root.pem" \
      --dry-run=client -o yaml | _kubectl apply -f - 2>&1 && ok "service-tls secret created" || warn "Failed to create service-tls secret"
  else
    fail "Cannot create service-tls secret - certs not found. Run reissue script."
    exit 1
  fi
else
  ok "service-tls secret exists"
fi

# Step 2: Wait for pods to actually start (after restarts, they need time)
say "2. Waiting for pods to start (after certificate reissue restarts)..."
MAX_WAIT=300
ELAPSED=0
CHECK_INTERVAL=10

while [[ $ELAPSED -lt $MAX_WAIT ]]; do
  READY_COUNT=0
  NOT_READY=()
  
  for service in "${SERVICES[@]}"; do
    ready=$(_kubectl get deployment "$service" -n "$NS" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
    desired=$(_kubectl get deployment "$service" -n "$NS" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "0")
    
    if [[ "$desired" == "1" ]] && [[ "$ready" == "1" ]]; then
      ((READY_COUNT++))
    else
      NOT_READY+=("$service:$ready/$desired")
    fi
  done
  
  if [[ $READY_COUNT -eq ${#SERVICES[@]} ]]; then
    ok "All ${#SERVICES[@]} services are ready!"
    exit 0
  fi
  
  if [[ $((ELAPSED % 30)) -eq 0 ]] && [[ $ELAPSED -gt 0 ]]; then
    say "Progress: $READY_COUNT/${#SERVICES[@]} ready (${ELAPSED}s elapsed)"
    if [[ ${#NOT_READY[@]} -gt 0 ]]; then
      echo "  Not ready: ${NOT_READY[*]}"
    fi
  fi
  
  sleep $CHECK_INTERVAL
  ELAPSED=$((ELAPSED + CHECK_INTERVAL))
done

# Step 3: Deep dive into not-ready services
warn "Only $READY_COUNT/${#SERVICES[@]} services ready after ${MAX_WAIT}s"
say "3. Investigating not-ready services..."

for service in "${SERVICES[@]}"; do
  ready=$(_kubectl get deployment "$service" -n "$NS" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
  desired=$(_kubectl get deployment "$service" -n "$NS" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "0")
  
  if [[ "$ready" != "$desired" ]] || [[ "$ready" != "1" ]]; then
    echo ""
    echo "  --- $service: $ready/$desired ---"
    
    pod=$(_kubectl get pods -n "$NS" -l app="$service" --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1].metadata.name}' 2>/dev/null || echo "")
    if [[ -n "$pod" ]]; then
      phase=$(_kubectl get pod "$pod" -n "$NS" -o jsonpath='{.status.phase}' 2>/dev/null || echo "Unknown")
      echo "    Pod: $pod ($phase)"
      
      # Check for volume mount issues
      mount_errors=$(_kubectl get events -n "$NS" --field-selector involvedObject.name="$pod",reason=FailedMount --sort-by='.lastTimestamp' --request-timeout=10s 2>/dev/null | tail -3 || echo "")
      if [[ -n "$mount_errors" ]]; then
        echo "    ⚠️  Volume mount errors:"
        echo "$mount_errors" | sed 's/^/      /'
      fi
      
      # Check if it's a Node.js service
      container_image=$(_kubectl get pod "$pod" -n "$NS" -o jsonpath='{.spec.containers[0].image}' 2>/dev/null || echo "")
      if echo "$container_image" | grep -qE "(auth-service|records-service|listings-service|social-service|shopping-service|analytics-service|auction-monitor)"; then
        # Check for dist/server.js or dist/start.js
        if echo "$container_image" | grep -q "auction-monitor"; then
          entrypoint="dist/start.js"
        else
          entrypoint="dist/server.js"
        fi
        
        # Check working directory (social-service uses different path)
        if echo "$container_image" | grep -q "social-service"; then
          check_path="/app/services/social-service/$entrypoint"
        else
          check_path="/app/$entrypoint"
        fi
        
        echo "    Checking for $check_path..."
        if _kubectl exec "$pod" -n "$NS" -- ls -la "$check_path" 2>/dev/null >/dev/null; then
          echo "      ✅ Entrypoint exists"
        else
          echo "      ❌ Entrypoint NOT FOUND"
          echo "      Listing directory contents:"
          dir_path=$(dirname "$check_path")
          _kubectl exec "$pod" -n "$NS" -- ls -la "$dir_path" 2>/dev/null | head -10 | sed 's/^/        /' || echo "        (cannot list)"
        fi
        
        # Check if process is running
        echo "    Checking for Node.js process..."
        node_proc=$(_kubectl exec "$pod" -n "$NS" -- ps aux 2>/dev/null | grep -E "node|npm" | head -2 || echo "")
        if [[ -n "$node_proc" ]]; then
          echo "      ✅ Node.js process found"
        else
          echo "      ❌ No Node.js process - app not started"
          echo "      Recent logs:"
          _kubectl logs "$pod" -n "$NS" --tail=20 --request-timeout=10s 2>&1 | tail -10 | sed 's/^/        /' || echo "        (logs unavailable)"
        fi
      fi
      
      # Check health probe status
      echo "    Health probe status:"
      ready_condition=$(_kubectl get pod "$pod" -n "$NS" -o jsonpath='{.status.conditions[?(@.type=="Ready")]}' 2>/dev/null || echo "")
      if echo "$ready_condition" | grep -q "False"; then
        reason=$(echo "$ready_condition" | grep -o '"reason":"[^"]*"' | cut -d'"' -f4 || echo "Unknown")
        message=$(echo "$ready_condition" | grep -o '"message":"[^"]*"' | cut -d'"' -f4 || echo "")
        echo "      Reason: $reason"
        [[ -n "$message" ]] && echo "      Message: $message"
      fi
    fi
  fi
done

fail "Not all services are ready. See diagnostics above."
exit 1
