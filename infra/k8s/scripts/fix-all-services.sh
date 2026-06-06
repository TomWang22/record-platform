#!/usr/bin/env bash
# Comprehensive service fix script
# Fixes: memory pressure, ConfigMap/Secret errors, Redis connectivity, Kafka/Zookeeper, Linkerd injection

set -euo pipefail

NS="record-platform"

bold() { echo -e "\033[1m$1\033[0m"; }
ok() { echo -e "\033[32m✅ $1\033[0m"; }
warn() { echo -e "\033[33m⚠️  $1\033[0m"; }
error() { echo -e "\033[31m❌ $1\033[0m"; }
step() { echo; bold ">>> $1"; }

step "=== Comprehensive Service Fix Script ==="

# Step 1: Check memory pressure
step "1. Checking Memory Pressure"
MEMORY_USAGE=$(kubectl top nodes --no-headers 2>/dev/null | awk '{sum+=$5} END {print sum}' || echo "0")
if [[ "$MEMORY_USAGE" -gt 90 ]]; then
  warn "Memory usage is high: ${MEMORY_USAGE}%"
  echo "   Checking for unnecessary pods..."
  
  # Find pods that might be consuming too much memory
  kubectl get pods -n "$NS" --sort-by=.status.containerStatuses[0].restartCount --no-headers | \
    awk '$4 > 5 {print $1}' | while read -r pod; do
    if [[ -n "$pod" ]]; then
      warn "Pod $pod has high restart count, checking if it can be deleted..."
      kubectl delete pod "$pod" -n "$NS" --grace-period=0 --force 2>/dev/null || true
    fi
  done
else
  ok "Memory usage is acceptable: ${MEMORY_USAGE}%"
fi

# Step 2: Ensure ConfigMaps and Secrets exist
step "2. Verifying ConfigMaps and Secrets"
if kubectl get configmap app-config -n "$NS" >/dev/null 2>&1; then
  ok "app-config ConfigMap exists"
else
  error "app-config ConfigMap missing - creating from base..."
  if [[ -f "infra/k8s/base/config/app-config.yaml" ]]; then
    kubectl apply -f infra/k8s/base/config/app-config.yaml -n "$NS"
    ok "app-config ConfigMap created"
  else
    error "Cannot find app-config.yaml template"
  fi
fi

if kubectl get secret app-secrets -n "$NS" >/dev/null 2>&1; then
  ok "app-secrets Secret exists"
else
  error "app-secrets Secret missing - creating from base..."
  if [[ -f "infra/k8s/base/config/app-secrets.yaml" ]]; then
    kubectl apply -f infra/k8s/base/config/app-secrets.yaml -n "$NS"
    ok "app-secrets Secret created"
  else
    error "Cannot find app-secrets.yaml template"
  fi
fi

# Check proto-files ConfigMap
if kubectl get configmap proto-files -n "$NS" >/dev/null 2>&1; then
  ok "proto-files ConfigMap exists"
else
  warn "proto-files ConfigMap missing (some services may fail)"
fi

# Step 3: Fix api-gateway memory issue
step "3. Fixing API Gateway Memory Issue"
if kubectl get deployment api-gateway -n "$NS" >/dev/null 2>&1; then
  # Check if resource patch exists
  if [[ -f "infra/k8s/overlays/dev/patches/api-gateway-resources.yaml" ]]; then
    kubectl apply -f infra/k8s/overlays/dev/patches/api-gateway-resources.yaml
    ok "Applied resource limits to api-gateway"
  else
    # Apply minimal resources directly
    kubectl patch deployment api-gateway -n "$NS" --type='json' -p='[
      {"op": "add", "path": "/spec/template/spec/containers/0/resources", "value": {
        "requests": {"cpu": "50m", "memory": "64Mi"},
        "limits": {"cpu": "200m", "memory": "256Mi"}
      }}
    ]' 2>/dev/null || warn "Could not patch api-gateway resources"
  fi
  
  # Remove PostStartHook if it exists (common cause of PostStartHookError)
  kubectl get deployment api-gateway -n "$NS" -o json | \
    jq 'del(.spec.template.spec.containers[0].lifecycle.postStart)' | \
    kubectl apply -f - 2>/dev/null || warn "Could not remove PostStartHook"
  
  # Restart deployment
  kubectl rollout restart deployment/api-gateway -n "$NS" || warn "Could not restart api-gateway"
  ok "API Gateway fix applied"
else
  warn "api-gateway deployment not found"
fi

# Step 4: Fix listings-service and social-service ConfigMap errors
step "4. Fixing ConfigMap Errors (listings-service, social-service)"
for SERVICE in listings-service social-service; do
  if kubectl get deployment "$SERVICE" -n "$NS" >/dev/null 2>&1; then
    # Check if ConfigMap/Secret references are correct
    if kubectl get deployment "$SERVICE" -n "$NS" -o jsonpath='{.spec.template.spec.containers[0].envFrom}' | grep -q app-config; then
      ok "$SERVICE: ConfigMap/Secret references look correct"
    else
      warn "$SERVICE: Missing envFrom references, checking deployment..."
      # Try to add envFrom if missing
      kubectl patch deployment "$SERVICE" -n "$NS" --type='json' -p='[
        {"op": "add", "path": "/spec/template/spec/containers/0/envFrom", "value": [
          {"configMapRef": {"name": "app-config"}},
          {"secretRef": {"name": "app-secrets"}}
        ]}
      ]' 2>/dev/null || warn "Could not patch $SERVICE"
    fi
    
    # Restart to pick up changes
    kubectl rollout restart deployment/"$SERVICE" -n "$NS" || warn "Could not restart $SERVICE"
  fi
done

# Step 5: Fix shopping-service Redis connectivity
step "5. Fixing Shopping-Service Redis Connectivity"
if kubectl get deployment shopping-service -n "$NS" >/dev/null 2>&1; then
  # Check if Redis service exists
  if kubectl get svc redis -n "$NS" >/dev/null 2>&1; then
    REDIS_HOST=$(kubectl get svc redis -n "$NS" -o jsonpath='{.spec.clusterIP}')
    ok "Redis service found at $REDIS_HOST"
    
    # Ensure shopping-service has REDIS_HOST env var
    kubectl patch deployment shopping-service -n "$NS" --type='json' -p='[
      {"op": "add", "path": "/spec/template/spec/containers/0/env/-", "value": {
        "name": "REDIS_HOST",
        "value": "redis.record-platform.svc.cluster.local"
      }},
      {"op": "add", "path": "/spec/template/spec/containers/0/env/-", "value": {
        "name": "REDIS_PORT",
        "value": "6379"
      }}
    ]' 2>/dev/null || warn "Could not add Redis env vars to shopping-service"
    
    # Restart shopping-service
    kubectl rollout restart deployment/shopping-service -n "$NS" || warn "Could not restart shopping-service"
    ok "Shopping-service Redis configuration updated"
  else
    error "Redis service not found - shopping-service will fail"
  fi
else
  warn "shopping-service deployment not found"
fi

# Step 6: Fix auth-service Linkerd injection (1/2 containers)
step "6. Fixing Auth-Service Linkerd Injection"
if kubectl get deployment auth-service -n "$NS" >/dev/null 2>&1; then
  AUTH_POD=$(kubectl get pods -n "$NS" -l app=auth-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  if [[ -n "$AUTH_POD" ]]; then
    CONTAINER_COUNT=$(kubectl get pod "$AUTH_POD" -n "$NS" -o jsonpath='{.spec.containers[*].name}' 2>/dev/null | wc -w)
    if [[ "$CONTAINER_COUNT" -lt 2 ]]; then
      warn "Auth-service has only $CONTAINER_COUNT container(s) (expected 2 with Linkerd)"
      
      # Check if Linkerd is installed
      if command -v linkerd >/dev/null 2>&1 && linkerd check --quiet 2>/dev/null; then
        # Re-inject Linkerd
        kubectl get deployment auth-service -n "$NS" -o yaml | \
          linkerd inject - | kubectl apply -f -
        ok "Linkerd re-injected into auth-service"
        
        # Wait for rollout
        kubectl rollout status deployment/auth-service -n "$NS" --timeout=60s || warn "Auth-service rollout taking longer"
      else
        warn "Linkerd not installed - skipping injection"
      fi
    else
      ok "Auth-service has $CONTAINER_COUNT containers (Linkerd injected)"
    fi
  fi
fi

# Step 7: Fix analytics-service and python-ai-service restarts
step "7. Fixing Analytics and Python-AI Services"
for SERVICE in analytics-service python-ai-service; do
  if kubectl get deployment "$SERVICE" -n "$NS" >/dev/null 2>&1; then
    # Check logs for common errors
    POD=$(kubectl get pods -n "$NS" -l app="$SERVICE" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
    if [[ -n "$POD" ]]; then
      if kubectl logs "$POD" -n "$NS" --tail=20 2>&1 | grep -qi "error\|crash\|failed"; then
        warn "$SERVICE: Errors found in logs, checking configuration..."
        kubectl logs "$POD" -n "$NS" --tail=50 | tail -10
      fi
    fi
    
    # Ensure envFrom is set
    if ! kubectl get deployment "$SERVICE" -n "$NS" -o jsonpath='{.spec.template.spec.containers[0].envFrom}' | grep -q app-config; then
      warn "$SERVICE: Missing envFrom, adding..."
      kubectl patch deployment "$SERVICE" -n "$NS" --type='json' -p='[
        {"op": "add", "path": "/spec/template/spec/containers/0/envFrom", "value": [
          {"configMapRef": {"name": "app-config"}},
          {"secretRef": {"name": "app-secrets"}}
        ]}
      ]' 2>/dev/null || warn "Could not patch $SERVICE"
    fi
    
    # Restart
    kubectl rollout restart deployment/"$SERVICE" -n "$NS" || warn "Could not restart $SERVICE"
  fi
done

# Step 8: Fix Kafka and Zookeeper
step "8. Fixing Kafka and Zookeeper"
# Check for multiple Kafka replicasets
KAFKA_RS_COUNT=$(kubectl get replicasets -n "$NS" -l app=kafka --no-headers 2>/dev/null | wc -l | tr -d ' ')
if [[ "$KAFKA_RS_COUNT" -gt 1 ]]; then
  warn "Found $KAFKA_RS_COUNT Kafka replicasets, cleaning up old ones..."
  kubectl get replicasets -n "$NS" -l app=kafka --no-headers | \
    awk 'NR>1 {print $1}' | xargs -r kubectl delete replicaset -n "$NS" 2>/dev/null || true
  ok "Cleaned up old Kafka replicasets"
fi

# Check Zookeeper
if kubectl get deployment zookeeper -n "$NS" >/dev/null 2>&1; then
  ZK_POD=$(kubectl get pods -n "$NS" -l app=zookeeper -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  if [[ -n "$ZK_POD" ]]; then
    ZK_STATUS=$(kubectl get pod "$ZK_POD" -n "$NS" -o jsonpath='{.status.phase}' 2>/dev/null || echo "")
    if [[ "$ZK_STATUS" != "Running" ]]; then
      warn "Zookeeper is in $ZK_STATUS state, checking logs..."
      kubectl logs "$ZK_POD" -n "$NS" --tail=20 2>/dev/null | tail -5
      
      # Try to restart
      kubectl delete pod "$ZK_POD" -n "$NS" --grace-period=0 2>/dev/null || true
    else
      ok "Zookeeper is running"
    fi
  fi
fi

# Check Kafka
if kubectl get deployment kafka -n "$NS" >/dev/null 2>&1; then
  KAFKA_POD=$(kubectl get pods -n "$NS" -l app=kafka -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  if [[ -n "$KAFKA_POD" ]]; then
    KAFKA_STATUS=$(kubectl get pod "$KAFKA_POD" -n "$NS" -o jsonpath='{.status.phase}' 2>/dev/null || echo "")
    if [[ "$KAFKA_STATUS" == "Pending" ]]; then
      warn "Kafka is pending, checking events..."
      kubectl describe pod "$KAFKA_POD" -n "$NS" | grep -A 5 "Events:" || true
    elif [[ "$KAFKA_STATUS" == "Running" ]]; then
      ok "Kafka is running"
    else
      warn "Kafka is in $KAFKA_STATUS state"
    fi
  fi
fi

# Step 9: Wait for memory to stabilize
step "9. Waiting for Memory to Stabilize"
echo "Waiting 10 seconds for memory to stabilize after cleanup..."
sleep 10

# Step 10: Summary and status
step "10. Service Status Summary"
echo ""
bold "📊 Current Service Status:"
kubectl get deployments -n "$NS" -o custom-columns=NAME:.metadata.name,READY:.status.readyReplicas,DESIRED:.spec.replicas,STATUS:.status.conditions[0].type 2>/dev/null || true

echo ""
bold "🔍 Pod Status:"
kubectl get pods -n "$NS" -o custom-columns=NAME:.metadata.name,STATUS:.status.phase,RESTARTS:.status.containerStatuses[0].restartCount,READY:.status.containerStatuses[*].ready 2>/dev/null | head -20

echo ""
bold "💡 Next Steps:"
echo "  1. Monitor service recovery: kubectl get pods -n $NS -w"
echo "  2. Check specific service logs: kubectl logs -n $NS deployment/<service-name>"
echo "  3. Verify ConfigMaps: kubectl get configmap,secret -n $NS"
echo "  4. Check memory: kubectl top nodes"
echo ""
bold "✅ Fix script complete!"

