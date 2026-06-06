#!/usr/bin/env bash
set -euo pipefail

# Fix HTTP/2 and HTTP/3 issues by ensuring Caddy is running and configured correctly

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; }

NS_ING="ingress-nginx"
HOST="${HOST:-record.local}"
PORT="${PORT:-8443}"

say "=== Fixing HTTP/2 and HTTP/3 ==="

# Step 1: Check kubectl connectivity
if ! kubectl get nodes >/dev/null 2>&1; then
  fail "kubectl cannot connect to cluster"
  say "Restarting cluster..."
  docker restart h3-control-plane
  sleep 45
  if ! kubectl get nodes >/dev/null 2>&1; then
    fail "Cluster still not accessible"
    exit 1
  fi
  ok "Cluster connection restored"
fi

# Step 2: Ensure node is Ready
say "Step 1: Checking node status..."
NODE_STATUS=$(kubectl get nodes -o jsonpath='{.items[0].status.conditions[?(@.type=="Ready")].status}' 2>&1 || echo "Unknown")
if [[ "$NODE_STATUS" != "True" ]]; then
  warn "Node is not Ready. Waiting..."
  sleep 10
  NODE_STATUS=$(kubectl get nodes -o jsonpath='{.items[0].status.conditions[?(@.type=="Ready")].status}' 2>&1 || echo "Unknown")
  if [[ "$NODE_STATUS" != "True" ]]; then
    fail "Node is still not Ready"
    exit 1
  fi
fi
ok "Node is Ready"

# Step 3: Check Caddy deployment
say "Step 2: Checking Caddy deployment..."
if ! kubectl get deployment caddy-h3 -n "$NS_ING" >/dev/null 2>&1; then
  fail "Caddy deployment not found"
  say "Applying Caddy deployment..."
  kubectl apply -f infra/k8s/caddy-h3-deploy.yaml || fail "Failed to apply Caddy deployment"
fi

# Step 4: Scale Caddy to 1 replica (for single-node cluster)
say "Step 3: Ensuring Caddy replicas..."
CURRENT_REPLICAS=$(kubectl get deployment caddy-h3 -n "$NS_ING" -o jsonpath='{.spec.replicas}' 2>&1 || echo "0")
if [ "$CURRENT_REPLICAS" -gt 1 ]; then
  warn "Caddy has $CURRENT_REPLICAS replicas, scaling to 1 for single-node cluster"
  kubectl scale deployment caddy-h3 -n "$NS_ING" --replicas=1
  ok "Scaled Caddy to 1 replica"
else
  ok "Caddy replicas: $CURRENT_REPLICAS"
fi

# Step 5: Delete any Pending pods
say "Step 4: Cleaning up Pending pods..."
PENDING_PODS=$(kubectl get pods -n "$NS_ING" -l app=caddy-h3 --field-selector=status.phase=Pending -o jsonpath='{.items[*].metadata.name}' 2>&1 || echo "")
if [ -n "$PENDING_PODS" ]; then
  for pod in $PENDING_PODS; do
    warn "Deleting pending pod: $pod"
    kubectl delete pod "$pod" -n "$NS_ING" 2>/dev/null || true
  done
  sleep 5
fi

# Step 6: Wait for Caddy to be ready
say "Step 5: Waiting for Caddy to be ready..."
kubectl wait --for=condition=ready pod -l app=caddy-h3 -n "$NS_ING" --timeout=120s 2>/dev/null || {
  warn "Caddy pod not ready yet, checking status..."
  kubectl get pods -n "$NS_ING" -l app=caddy-h3
  kubectl describe pod -n "$NS_ING" -l app=caddy-h3 | grep -A 10 "Events:" | head -15
}

# Step 7: Check Caddy pod status
CADDY_POD=$(kubectl get pods -n "$NS_ING" -l app=caddy-h3 -o jsonpath='{.items[0].metadata.name}' 2>&1 || echo "")
if [ -z "$CADDY_POD" ] || [ "$CADDY_POD" == "null" ]; then
  fail "No Caddy pod found"
  exit 1
fi

CADDY_STATUS=$(kubectl get pod "$CADDY_POD" -n "$NS_ING" -o jsonpath='{.status.phase}' 2>&1 || echo "Unknown")
if [ "$CADDY_STATUS" == "Running" ]; then
  READY=$(kubectl get pod "$CADDY_POD" -n "$NS_ING" -o jsonpath='{.status.containerStatuses[0].ready}' 2>&1 || echo "false")
  if [ "$READY" == "true" ]; then
    ok "Caddy pod is Running and Ready"
  else
    warn "Caddy pod is Running but not Ready"
    kubectl logs -n "$NS_ING" "$CADDY_POD" --tail=20
  fi
else
  warn "Caddy pod status: $CADDY_STATUS"
  kubectl describe pod "$CADDY_POD" -n "$NS_ING" | grep -A 10 "Events:" | head -15
fi

# Step 8: Check Caddy ConfigMap
say "Step 6: Checking Caddy ConfigMap..."
if ! kubectl get configmap caddy-h3 -n "$NS_ING" >/dev/null 2>&1; then
  warn "Caddy ConfigMap not found, creating from Caddyfile..."
  kubectl create configmap caddy-h3 -n "$NS_ING" --from-file=Caddyfile=Caddyfile 2>/dev/null || {
    fail "Failed to create Caddy ConfigMap"
    exit 1
  }
  # Restart Caddy to pick up new config
  kubectl rollout restart deployment caddy-h3 -n "$NS_ING"
  sleep 10
fi
ok "Caddy ConfigMap exists"

# Step 9: Check TLS secrets
say "Step 7: Checking TLS secrets..."
if ! kubectl get secret record-local-tls -n "$NS_ING" >/dev/null 2>&1; then
  warn "TLS secret 'record-local-tls' not found"
  say "You may need to create TLS certificates. See: scripts/generate-dev-certs.sh"
else
  ok "TLS secret exists"
fi

if ! kubectl get secret dev-root-ca -n "$NS_ING" >/dev/null 2>&1; then
  warn "CA secret 'dev-root-ca' not found"
else
  ok "CA secret exists"
fi

# Step 10: Test HTTP/2 connectivity
say "Step 8: Testing HTTP/2 connectivity..."
sleep 5  # Give Caddy time to start
H2_TEST=$(curl -k -sS -I --http2 --max-time 5 -H "Host: ${HOST}" "https://127.0.0.1:${PORT}/_caddy/healthz" 2>&1 || echo "FAILED")
if echo "$H2_TEST" | head -1 | grep -qE "200|HTTP/2"; then
  ok "HTTP/2 health check works"
else
  warn "HTTP/2 health check failed"
  echo "Response: $(echo "$H2_TEST" | head -3)"
  say "Checking Caddy logs..."
  kubectl logs -n "$NS_ING" -l app=caddy-h3 --tail=30
fi

# Step 11: Summary
say "=== Summary ==="
CADDY_PODS=$(kubectl get pods -n "$NS_ING" -l app=caddy-h3 --no-headers 2>/dev/null | grep -c Running || echo "0")
echo "  Caddy pods running: $CADDY_PODS"
echo "  Caddy pod status: $CADDY_STATUS"
echo
say "Next steps:"
echo "  1. If Caddy is not ready, check logs: kubectl logs -n $NS_ING -l app=caddy-h3"
echo "  2. Test HTTP/2: curl -k -I --http2 -H 'Host: $HOST' https://127.0.0.1:$PORT/_caddy/healthz"
echo "  3. Test HTTP/3: ./scripts/test-http2-http3-strict-tls.sh"

