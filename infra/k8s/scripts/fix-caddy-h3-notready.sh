#!/usr/bin/env bash
# Fix Caddy H3 control plane NotReady issue
# Addresses: ConfigMap/Secret issues, port conflicts, memory pressure, readiness probe failures

set -euo pipefail

NS="ingress-nginx"
APP="caddy-h3"

bold() { echo -e "\033[1m$1\033[0m"; }
ok() { echo -e "\033[32m✅ $1\033[0m"; }
warn() { echo -e "\033[33m⚠️  $1\033[0m"; }
error() { echo -e "\033[31m❌ $1\033[0m"; }
step() { echo; bold ">>> $1"; }

step "=== Fixing Caddy H3 Control Plane NotReady ==="

# Step 1: Check current status
step "1. Checking Current Status"
PODS=$(kubectl get pods -n "$NS" -l app="$APP" --no-headers 2>/dev/null | wc -l | tr -d ' ')
if [[ "$PODS" -eq 0 ]]; then
  error "No Caddy H3 pods found"
  kubectl get events -n "$NS" --sort-by=.lastTimestamp | tail -20
else
  ok "Found $PODS Caddy H3 pod(s)"
  kubectl get pods -n "$NS" -l app="$APP" -o wide
fi

# Step 2: Check ConfigMap
step "2. Verifying ConfigMap"
if kubectl get configmap "$APP" -n "$NS" >/dev/null 2>&1; then
  ok "ConfigMap $APP exists"
  
  # Check if Caddyfile is valid
  CADDYFILE=$(kubectl get configmap "$APP" -n "$NS" -o jsonpath='{.data.Caddyfile}' 2>/dev/null || echo "")
  if [[ -z "$CADDYFILE" ]]; then
    error "ConfigMap $APP exists but Caddyfile is empty or missing"
    
    # Try to create from local Caddyfile
    if [[ -f "./Caddyfile" ]]; then
      warn "Creating ConfigMap from local Caddyfile..."
      kubectl create configmap "$APP" \
        --from-file=Caddyfile=./Caddyfile \
        -n "$NS" --dry-run=client -o yaml | kubectl apply -f -
      ok "ConfigMap updated from local Caddyfile"
    else
      error "No local Caddyfile found. Please create ConfigMap manually."
    fi
  else
    ok "Caddyfile found in ConfigMap"
    
    # Validate Caddyfile syntax (if pod exists)
    POD=$(kubectl get pods -n "$NS" -l app="$APP" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
    if [[ -n "$POD" ]] && kubectl get pod "$POD" -n "$NS" -o jsonpath='{.status.phase}' 2>/dev/null | grep -q Running; then
      if kubectl exec "$POD" -n "$NS" -- caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>/dev/null; then
        ok "Caddyfile syntax is valid"
      else
        warn "Caddyfile validation failed (pod may not be ready yet)"
      fi
    fi
  fi
else
  error "ConfigMap $APP missing"
  
  # Try to create from local Caddyfile
  if [[ -f "./Caddyfile" ]]; then
    warn "Creating ConfigMap from local Caddyfile..."
    kubectl create configmap "$APP" \
      --from-file=Caddyfile=./Caddyfile \
      -n "$NS"
    ok "ConfigMap created"
  else
    error "No local Caddyfile found. Creating minimal ConfigMap..."
    cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: $APP
  namespace: $NS
data:
  Caddyfile: |
    {
      admin localhost:2019
    }
    https://record.local {
      tls /etc/caddy/certs/tls.crt /etc/caddy/certs/tls.key {
        protocols tls1.2 tls1.3
      }
      handle_path /_caddy/healthz {
        respond "ok" 200
      }
      reverse_proxy http://ingress-nginx-controller.ingress-nginx.svc.cluster.local:80 {
        header_up Host {http.request.host}
      }
    }
EOF
    ok "Minimal ConfigMap created"
  fi
fi

# Step 3: Check Secrets
step "3. Verifying Secrets"
MISSING_SECRETS=0

# Check record-local-tls secret
if kubectl get secret record-local-tls -n "$NS" >/dev/null 2>&1; then
  TLS_CRT=$(kubectl get secret record-local-tls -n "$NS" -o jsonpath='{.data.tls\.crt}' 2>/dev/null || echo "")
  TLS_KEY=$(kubectl get secret record-local-tls -n "$NS" -o jsonpath='{.data.tls\.key}' 2>/dev/null || echo "")
  
  if [[ -z "$TLS_CRT" ]] || [[ -z "$TLS_KEY" ]]; then
    error "Secret record-local-tls exists but missing tls.crt or tls.key"
    MISSING_SECRETS=1
  else
    ok "Secret record-local-tls has tls.crt and tls.key"
  fi
else
  error "Secret record-local-tls missing"
  MISSING_SECRETS=1
fi

# Check dev-root-ca secret
if kubectl get secret dev-root-ca -n "$NS" >/dev/null 2>&1; then
  CA_PEM=$(kubectl get secret dev-root-ca -n "$NS" -o jsonpath='{.data.dev-root\.pem}' 2>/dev/null || echo "")
  if [[ -z "$CA_PEM" ]]; then
    warn "Secret dev-root-ca exists but missing dev-root.pem (may be optional)"
  else
    ok "Secret dev-root-ca has dev-root.pem"
  fi
else
  warn "Secret dev-root-ca missing (may be optional for some setups)"
fi

if [[ "$MISSING_SECRETS" -eq 1 ]]; then
  error "Critical secrets missing. Please create them:"
  echo "  kubectl create secret tls record-local-tls \\"
  echo "    --cert=/path/to/tls.crt --key=/path/to/tls.key -n $NS"
fi

# Step 4: Check for port conflicts (hostNetwork issue)
step "4. Checking Port Conflicts"
NODE_COUNT=$(kubectl get nodes --no-headers 2>/dev/null | wc -l | tr -d ' ')
REPLICAS=$(kubectl get deployment "$APP" -n "$NS" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "2")

USES_HOST_PORT=$(
  kubectl get deployment "$APP" -n "$NS" -o json 2>/dev/null \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); c=d["spec"]["template"]["spec"]["containers"][0]; ports=c.get("ports",[]); print(1 if any(p.get("hostPort") for p in ports) else 0)' 2>/dev/null || echo 0
)
if [[ "$NODE_COUNT" -lt "$REPLICAS" ]]; then
  if [[ "$USES_HOST_PORT" == "1" ]]; then
    warn "Only $NODE_COUNT node(s) but deployment requests $REPLICAS replicas"
    warn "hostPort 443: only one pod per node can bind — consider replicas=1 on single-node"
    READY_PODS=$(kubectl get pods -n "$NS" -l app="$APP" --field-selector=status.phase=Running --no-headers 2>/dev/null | wc -l | tr -d ' ')
    if [[ "$READY_PODS" -eq 0 ]] && [[ "$NODE_COUNT" -eq 1 ]]; then
      warn "Reducing replicas to 1 for single-node + hostPort..."
      kubectl scale deployment "$APP" -n "$NS" --replicas=1
      ok "Scaled down to 1 replica"
    fi
  else
    ok "Single-node cluster with LoadBalancer Caddy (no hostPort) — $REPLICAS replicas OK"
  fi
fi

# Check for port 443 conflicts on nodes
POD=$(kubectl get pods -n "$NS" -l app="$APP" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [[ -n "$POD" ]]; then
  NODE=$(kubectl get pod "$POD" -n "$NS" -o jsonpath='{.spec.nodeName}' 2>/dev/null || echo "")
  if [[ -n "$NODE" ]]; then
    warn "Checking port 443 usage on node $NODE (requires node debug access)..."
    # This requires kubectl debug which may not work in all environments
    # Just warn for now
  fi
fi

# Step 5: Check memory pressure
step "5. Checking Memory Pressure"
MEMORY_USAGE=$(kubectl top nodes --no-headers 2>/dev/null | awk '{sum+=$5} END {print sum/NR}' || echo "0")
if [[ $(echo "$MEMORY_USAGE > 90" | bc 2>/dev/null || echo "0") -eq 1 ]]; then
  warn "Memory usage is high: ${MEMORY_USAGE}%"
  warn "This may prevent Caddy H3 pods from scheduling"
  
  # Check if pods are pending due to memory
  PENDING_PODS=$(kubectl get pods -n "$NS" -l app="$APP" --field-selector=status.phase=Pending --no-headers 2>/dev/null | wc -l | tr -d ' ')
  if [[ "$PENDING_PODS" -gt 0 ]]; then
    warn "$PENDING_PODS pod(s) are pending - likely due to memory pressure"
    kubectl get pods -n "$NS" -l app="$APP" -o jsonpath='{range .items[*]}{.metadata.name}{": "}{.status.phase}{" - "}{.status.conditions[?(@.type=="PodScheduled")].message}{"\n"}{end}' 2>/dev/null || true
  fi
else
  ok "Memory usage is acceptable: ${MEMORY_USAGE}%"
fi

# Step 6: Check pod status and events
step "6. Checking Pod Status and Events"
if [[ -n "$POD" ]]; then
  PHASE=$(kubectl get pod "$POD" -n "$NS" -o jsonpath='{.status.phase}' 2>/dev/null || echo "Unknown")
  READY=$(kubectl get pod "$POD" -n "$NS" -o jsonpath='{.status.containerStatuses[0].ready}' 2>/dev/null || echo "false")
  
  echo "Pod: $POD"
  echo "Phase: $PHASE"
  echo "Ready: $READY"
  
  if [[ "$READY" != "true" ]]; then
    warn "Pod is not ready. Checking conditions..."
    kubectl get pod "$POD" -n "$NS" -o jsonpath='{.status.conditions[*].type}{"\n"}{.status.conditions[*].status}{"\n"}{.status.conditions[*].message}{"\n"}' 2>/dev/null || true
    
    # Check container state
    CONTAINER_STATE=$(kubectl get pod "$POD" -n "$NS" -o jsonpath='{.status.containerStatuses[0].state}' 2>/dev/null || echo "")
    if echo "$CONTAINER_STATE" | grep -q "waiting"; then
      REASON=$(kubectl get pod "$POD" -n "$NS" -o jsonpath='{.status.containerStatuses[0].state.waiting.reason}' 2>/dev/null || echo "")
      MESSAGE=$(kubectl get pod "$POD" -n "$NS" -o jsonpath='{.status.containerStatuses[0].state.waiting.message}' 2>/dev/null || echo "")
      warn "Container is waiting. Reason: $REASON"
      [[ -n "$MESSAGE" ]] && echo "  Message: $MESSAGE"
    fi
    
    # Check recent events
    echo ""
    warn "Recent events for pod:"
    kubectl describe pod "$POD" -n "$NS" | sed -n '/Events:/,$p' | head -20
  fi
  
  # Check logs if pod is running
  if [[ "$PHASE" == "Running" ]]; then
    echo ""
    warn "Recent logs:"
    kubectl logs "$POD" -n "$NS" --tail=30 2>&1 | tail -20 || true
  fi
fi

# Step 7: Fix readiness probe if needed
step "7. Checking Readiness Probe"
if [[ -n "$POD" ]] && [[ "$PHASE" == "Running" ]]; then
  # Test health endpoint
  if kubectl exec "$POD" -n "$NS" -- curl -k -s https://localhost:443/_caddy/healthz 2>/dev/null | grep -q "ok"; then
    ok "Health endpoint is responding"
  else
    warn "Health endpoint not responding - readiness probe may be failing"
    warn "This could be due to:"
    echo "  - Caddyfile misconfiguration"
    echo "  - Certificate issues"
    echo "  - Caddy not fully started"
  fi
fi

# Step 8: Restart deployment if needed
step "8. Restarting Deployment (if needed)"
if [[ "$MISSING_SECRETS" -eq 0 ]]; then
  # Only restart if secrets are present
  warn "Restarting deployment to pick up changes..."
  kubectl rollout restart deployment/"$APP" -n "$NS"
  
  echo "Waiting for rollout..."
  if kubectl rollout status deployment/"$APP" -n "$NS" --timeout=120s; then
    ok "Deployment rolled out successfully"
  else
    warn "Deployment rollout timed out or failed"
  fi
else
  warn "Skipping restart - secrets are missing"
fi

# Step 9: Final status check
step "9. Final Status Check"
sleep 5
kubectl get pods -n "$NS" -l app="$APP" -o wide

READY_COUNT=$(kubectl get pods -n "$NS" -l app="$APP" --field-selector=status.phase=Running --no-headers 2>/dev/null | \
  awk '$2 == "1/1" || $2 == "2/2" {count++} END {print count+0}' || echo "0")

if [[ "$READY_COUNT" -gt 0 ]]; then
  ok "$READY_COUNT pod(s) are ready"
else
  error "No pods are ready"
  echo ""
  bold "Troubleshooting steps:"
  echo "  1. Check pod logs: kubectl logs -n $NS -l app=$APP"
  echo "  2. Check events: kubectl get events -n $NS --sort-by=.lastTimestamp"
  echo "  3. Verify ConfigMap: kubectl get configmap $APP -n $NS -o yaml"
  echo "  4. Verify Secrets: kubectl get secret record-local-tls,dev-root-ca -n $NS"
  echo "  5. Check memory: kubectl top nodes"
  echo "  6. Run diagnostics: bash scripts/diag-caddy-h3-extended.sh"
fi

step "=== Fix Complete ==="

