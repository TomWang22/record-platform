#!/usr/bin/env bash
# Ensure Full Platform Ready: Colima/k3s + Strict TLS + mTLS + Kafka SSL
# 
# This script ensures:
# 1. Colima and k3s are ready
# 2. Proper scaling (1 service/exporter pod, 2 Caddy, 1 Envoy)
# 3. Strict TLS + mTLS enabled (GRPC_REQUIRE_CLIENT_CERT=true)
# 4. CA and Caddy certs match (reissue if needed)
# 5. Kafka SSL/TLS configured (no PLAINTEXT fallback)
# 6. All services ready for test suite
#
# Usage:
#   ./scripts/ensure-full-platform-ready.sh
#   SKIP_REISSUE=1 ./scripts/ensure-full-platform-ready.sh  # Skip certificate reissuance

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
cd "$REPO_ROOT"

[[ -f "$SCRIPT_DIR/lib/kubectl-helper.sh" ]] && . "$SCRIPT_DIR/lib/kubectl-helper.sh"

_kubectl() { kctl "$@" 2>/dev/null || kubectl --request-timeout=15s "$@"; }

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
fail(){ echo "❌ $*" >&2; exit 1; }

NS="record-platform"
INGRESS_NS="ingress-nginx"
ENVOY_NS="envoy-test"

# Configuration
SKIP_REISSUE="${SKIP_REISSUE:-0}"
SKIP_KAFKA_SSL="${SKIP_KAFKA_SSL:-0}"

# Step 1: Ensure Colima and k3s are ready
say "=== Step 1: Ensuring Colima and k3s are Ready ==="

if [[ -f "$SCRIPT_DIR/ensure-colima-k3s-ready.sh" ]]; then
  MAX_WAIT=300 "$SCRIPT_DIR/ensure-colima-k3s-ready.sh" 2>&1 || fail "Colima/k3s not ready. Fix issues and re-run."
  ok "Colima and k3s are ready"
else
  warn "ensure-colima-k3s-ready.sh not found, skipping..."
fi

# Verify context
ctx=$(kubectl config current-context 2>/dev/null || echo "")
if [[ "$ctx" != *"colima"* ]]; then
  colima_ctx=$(kubectl config get-contexts -o name 2>/dev/null | grep -i colima | head -1 || echo "")
  if [[ -n "$colima_ctx" ]]; then
    kubectl config use-context "$colima_ctx" 2>/dev/null && ctx="$colima_ctx" || true
  fi
fi

if [[ "$ctx" == *"colima"* ]]; then
  ok "Using Colima context: $ctx"
else
  warn "Not using Colima context (current: $ctx). Some operations may fail."
fi

# Step 2: Reissue CA and leaf certificates (ensure CA/Caddy match)
say "=== Step 2: Ensuring CA and Caddy Certificates Match ==="

if [[ "$SKIP_REISSUE" != "1" ]] && [[ -f "$SCRIPT_DIR/reissue-ca-and-leaf-load-all-services.sh" ]]; then
  say "Reissuing CA and leaf certificates (KAFKA_SSL=1 for Kafka strict TLS)..."
  if REISSUE_CAP="${REISSUE_CAP:-360}" KAFKA_SSL=1 "$SCRIPT_DIR/reissue-ca-and-leaf-load-all-services.sh" 2>&1; then
    ok "CA and leaf certificates reissued (CA/Caddy aligned)"
  else
    warn "Certificate reissuance failed. Continuing, but tests may fail with curl 60."
  fi
else
  [[ "$SKIP_REISSUE" == "1" ]] && say "Skipping certificate reissuance (SKIP_REISSUE=1)" || warn "reissue script not found"
fi

# Step 3: Ensure Kafka SSL/TLS is configured (no PLAINTEXT fallback)
say "=== Step 3: Ensuring Kafka SSL/TLS Configuration ==="

if [[ "$SKIP_KAFKA_SSL" != "1" ]] && [[ -f "$SCRIPT_DIR/kafka-ssl-from-dev-root.sh" ]]; then
  say "Creating Kafka SSL secret from dev-root-ca..."
  chmod +x "$SCRIPT_DIR/kafka-ssl-from-dev-root.sh" 2>/dev/null || true
  if "$SCRIPT_DIR/kafka-ssl-from-dev-root.sh" 2>&1; then
    ok "Kafka SSL secret created (kafka-ssl-secret)"
  else
    warn "Kafka SSL secret creation failed. Check certs/dev-root.pem and certs/dev-root.key exist."
    warn "Run: pnpm run reissue (with KAFKA_SSL=1) or ./scripts/reissue-ca-and-leaf-load-all-services.sh"
  fi
else
  [[ "$SKIP_KAFKA_SSL" == "1" ]] && say "Skipping Kafka SSL setup (SKIP_KAFKA_SSL=1)" || warn "kafka-ssl-from-dev-root.sh not found"
fi

# Step 4: Ensure external Kafka is running (strict TLS on port 29093)
say "=== Step 4: Ensuring External Kafka is Running (Strict TLS) ==="

if command -v docker >/dev/null 2>&1 && [[ -f "$REPO_ROOT/docker-compose.yml" ]]; then
  # Check if Kafka is running
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "kafka"; then
    ok "Kafka container is running"
  else
    say "Starting Kafka and Zookeeper (strict TLS)..."
    (cd "$REPO_ROOT" && docker compose up -d zookeeper kafka 2>&1) && ok "Kafka started" || warn "Kafka start failed"
  fi
  
  # Wait for Kafka to be ready
  say "Waiting for Kafka to be ready (port 29093 SSL)..."
  for i in {1..30}; do
    if nc -z 127.0.0.1 29093 2>/dev/null; then
      ok "Kafka SSL port (29093) is accessible"
      break
    fi
    if [[ $i -eq 30 ]]; then
      warn "Kafka SSL port (29093) not accessible after 30 attempts"
    else
      echo "  Attempt $i/30: waiting..."
      sleep 2
    fi
  done
else
  warn "Docker or docker-compose.yml not found. Skipping Kafka check."
fi

# Step 5: Apply Kubernetes configurations
say "=== Step 5: Applying Kubernetes Configurations ==="

# Apply config, kafka-external, and services
for k in "$REPO_ROOT/infra/k8s/base/config" "$REPO_ROOT/infra/k8s/base/kafka-external"; do
  if [[ -d "$k" ]]; then
    if _kubectl apply -k "$k" --request-timeout=20s 2>&1; then
      ok "Applied $(basename "$k")"
    else
      warn "Failed to apply $(basename "$k")"
    fi
  fi
done

# Step 6: Scale services to 1 replica (record-platform namespace)
say "=== Step 6: Scaling Services to 1 Replica ==="

SERVICES=("auth-service" "records-service" "listings-service" "messaging-service" "shopping-service" "analytics-service" "auction-monitor" "python-ai-service" "api-gateway")

for service in "${SERVICES[@]}"; do
  if _kubectl scale deployment "$service" -n "$NS" --replicas=1 --request-timeout=15s 2>&1; then
    ok "$service: scaled to 1"
  else
    warn "$service: scale failed (may not exist yet)"
  fi
  sleep 1  # Small delay to avoid API overload
done

# Step 7: Scale exporters to 1 replica (record-platform namespace)
say "=== Step 7: Scaling Exporters to 1 Replica ==="

EXPORTERS=("nginx-exporter" "haproxy-exporter")

for exporter in "${EXPORTERS[@]}"; do
  if _kubectl scale deployment "$exporter" -n "$NS" --replicas=1 --request-timeout=15s 2>&1; then
    ok "$exporter: scaled to 1"
  else
    warn "$exporter: scale failed"
  fi
  sleep 1
done

# Step 8: Scale Caddy to 2 replicas (ingress-nginx namespace)
say "=== Step 8: Scaling Caddy to 2 Replicas ==="

if _kubectl scale deployment caddy-h3 -n "$INGRESS_NS" --replicas=2 --request-timeout=15s 2>&1; then
  ok "caddy-h3: scaled to 2"
else
  warn "caddy-h3: scale failed"
fi

# Step 9: Scale Envoy to 1 replica (envoy-test namespace)
say "=== Step 9: Scaling Envoy to 1 Replica ==="

if _kubectl scale deployment envoy-test -n "$ENVOY_NS" --replicas=1 --request-timeout=15s 2>&1; then
  ok "envoy-test: scaled to 1"
else
  # Try ingress-nginx namespace as fallback
  if _kubectl scale deployment envoy-test -n "$INGRESS_NS" --replicas=1 --request-timeout=15s 2>&1; then
    ok "envoy-test (ingress-nginx): scaled to 1"
  else
    warn "envoy-test: scale failed"
  fi
fi

# Step 10: Verify strict TLS + mTLS configuration
say "=== Step 10: Verifying Strict TLS + mTLS Configuration ==="

STRICT_TLS_SERVICES=("auth-service" "records-service" "listings-service" "messaging-service" "shopping-service" "analytics-service" "auction-monitor" "python-ai-service")

for service in "${STRICT_TLS_SERVICES[@]}"; do
  pod=$(_kubectl get pods -n "$NS" -l app="$service" --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1].metadata.name}' 2>/dev/null || echo "")
  if [[ -n "$pod" ]] && _kubectl get pod "$pod" -n "$NS" -o jsonpath='{.status.phase}' 2>/dev/null | grep -q Running; then
    # Check GRPC_REQUIRE_CLIENT_CERT
    env_val=$(_kubectl exec -n "$NS" "$pod" -- env 2>/dev/null | grep "GRPC_REQUIRE_CLIENT_CERT" || echo "")
    if echo "$env_val" | grep -q "true"; then
      ok "$service: GRPC_REQUIRE_CLIENT_CERT=true (mTLS enabled)"
    else
      warn "$service: GRPC_REQUIRE_CLIENT_CERT not set to true"
    fi
    
    # Check TLS certificates are mounted
    if _kubectl get pod "$pod" -n "$NS" -o jsonpath='{.spec.containers[0].volumeMounts[*].mountPath}' 2>/dev/null | grep -q "/etc/certs"; then
      ok "$service: TLS certificates mounted"
    else
      warn "$service: TLS certificates not mounted"
    fi
  else
    warn "$service: Pod not found or not running"
  fi
done

# Step 11: Verify Kafka SSL configuration (no PLAINTEXT fallback)
say "=== Step 11: Verifying Kafka SSL Configuration ==="

KAFKA_CONSUMING_SERVICES=("messaging-service" "analytics-service" "auction-monitor")

for service in "${KAFKA_CONSUMING_SERVICES[@]}"; do
  pod=$(_kubectl get pods -n "$NS" -l app="$service" --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1].metadata.name}' 2>/dev/null || echo "")
  if [[ -n "$pod" ]] && _kubectl get pod "$pod" -n "$NS" -o jsonpath='{.status.phase}' 2>/dev/null | grep -q Running; then
    # Check KAFKA_SSL_ENABLED
    kafka_ssl=$(_kubectl exec -n "$NS" "$pod" -- env 2>/dev/null | grep "KAFKA_SSL_ENABLED" || echo "")
    if echo "$kafka_ssl" | grep -q "true"; then
      ok "$service: KAFKA_SSL_ENABLED=true"
      
      # Check if Kafka SSL certificates are mounted
      if _kubectl get pod "$pod" -n "$NS" -o jsonpath='{.spec.containers[0].volumeMounts[*].mountPath}' 2>/dev/null | grep -q "kafka-ssl"; then
        ok "$service: Kafka SSL certificates mounted"
      else
        warn "$service: Kafka SSL certificates not mounted (may fall back to PLAINTEXT)"
      fi
    else
      warn "$service: KAFKA_SSL_ENABLED not set to true (will use PLAINTEXT)"
    fi
  fi
done

# Step 12: Wait for pods to be ready
say "=== Step 12: Waiting for Pods to be Ready ==="

MAX_WAIT=300
ELAPSED=0
ALL_READY=false

while [[ $ELAPSED -lt $MAX_WAIT ]]; do
  READY_COUNT=0
  TOTAL_COUNT=0
  
  # Check service pods
  for service in "${SERVICES[@]}"; do
    ready=$(_kubectl get deployment "$service" -n "$NS" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
    desired=$(_kubectl get deployment "$service" -n "$NS" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "0")
    if [[ "$desired" == "1" ]] && [[ "$ready" == "1" ]]; then
      ((READY_COUNT++))
    fi
    ((TOTAL_COUNT++))
  done
  
  # Check exporters
  for exporter in "${EXPORTERS[@]}"; do
    ready=$(_kubectl get deployment "$exporter" -n "$NS" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
    desired=$(_kubectl get deployment "$exporter" -n "$NS" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "0")
    if [[ "$desired" == "1" ]] && [[ "$ready" == "1" ]]; then
      ((READY_COUNT++))
    fi
    ((TOTAL_COUNT++))
  done
  
  # Check Caddy
  caddy_ready=$(_kubectl get deployment caddy-h3 -n "$INGRESS_NS" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
  caddy_desired=$(_kubectl get deployment caddy-h3 -n "$INGRESS_NS" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "0")
  if [[ "$caddy_desired" == "2" ]] && [[ "$caddy_ready" == "2" ]]; then
    ((READY_COUNT++))
  fi
  ((TOTAL_COUNT++))
  
  # Check Envoy
  envoy_ready=$(_kubectl get deployment envoy-test -n "$ENVOY_NS" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
  envoy_desired=$(_kubectl get deployment envoy-test -n "$ENVOY_NS" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "0")
  if [[ -z "$envoy_desired" ]] || [[ "$envoy_desired" == "0" ]]; then
    # Try ingress-nginx namespace
    envoy_ready=$(_kubectl get deployment envoy-test -n "$INGRESS_NS" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
    envoy_desired=$(_kubectl get deployment envoy-test -n "$INGRESS_NS" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "0")
  fi
  if [[ "$envoy_desired" == "1" ]] && [[ "$envoy_ready" == "1" ]]; then
    ((READY_COUNT++))
  fi
  ((TOTAL_COUNT++))
  
  if [[ $READY_COUNT -eq $TOTAL_COUNT ]] && [[ $TOTAL_COUNT -gt 0 ]]; then
    ALL_READY=true
    break
  fi
  
  if [[ $((ELAPSED % 30)) -eq 0 ]] && [[ $ELAPSED -gt 0 ]]; then
    say "  Progress: $READY_COUNT/$TOTAL_COUNT ready (${ELAPSED}s elapsed)"
  fi
  
  sleep 5
  ELAPSED=$((ELAPSED + 5))
done

if [[ "$ALL_READY" == "true" ]]; then
  ok "All pods are ready ($READY_COUNT/$TOTAL_COUNT)"
else
  warn "Not all pods are ready ($READY_COUNT/$TOTAL_COUNT) after ${MAX_WAIT}s"
  say "Current pod status:"
  _kubectl get pods -n "$NS" -l 'app in (auth-service,records-service,listings-service,messaging-service,shopping-service,analytics-service,auction-monitor,python-ai-service,api-gateway,nginx-exporter,haproxy-exporter)' \
    -o custom-columns=NAME:.metadata.name,READY:.status.containerStatuses[0].ready,STATUS:.status.phase --request-timeout=15s 2>&1 | head -15
fi

# Step 13: Verify external dependencies
say "=== Step 13: Verifying External Dependencies ==="

# Check databases (8 PostgreSQL instances)
DB_COUNT=0
for port in 5432 5433 5434 5435 5436 5437 5438 5439; do
  if nc -z 127.0.0.1 $port 2>/dev/null; then
    ((DB_COUNT++))
  fi
done

if [[ $DB_COUNT -eq 8 ]]; then
  ok "All 8 databases UP"
else
  warn "Only $DB_COUNT/8 databases UP"
fi

# Check Redis
if nc -z 127.0.0.1 6379 2>/dev/null; then
  ok "Redis (6379): UP"
else
  warn "Redis (6379): DOWN"
fi

# Check Kafka
if nc -z 127.0.0.1 29093 2>/dev/null; then
  ok "Kafka SSL (29093): UP"
elif nc -z 127.0.0.1 9092 2>/dev/null; then
  warn "Kafka PLAINTEXT (9092): UP (should use SSL 29093)"
else
  warn "Kafka: DOWN"
fi

# Check Zookeeper
if nc -z 127.0.0.1 2181 2>/dev/null; then
  ok "Zookeeper (2181): UP"
else
  warn "Zookeeper (2181): DOWN"
fi

# Step 14: Verify CA and Caddy certs match (prevent curl 60)
say "=== Step 14: Verifying CA and Caddy Certificates Match ==="

if [[ -f "$SCRIPT_DIR/verify-caddy-strict-tls.sh" ]]; then
  chmod +x "$SCRIPT_DIR/verify-caddy-strict-tls.sh" 2>/dev/null || true
  if "$SCRIPT_DIR/verify-caddy-strict-tls.sh" 2>&1; then
    ok "CA and Caddy certificates match (no curl 60 expected)"
  else
    warn "CA and Caddy certificate verification failed"
    warn "Run: pnpm run reissue  (or ./scripts/reissue-ca-and-leaf-load-all-services.sh)"
  fi
else
  warn "verify-caddy-strict-tls.sh not found, skipping verification"
fi

# Step 15: Final status summary
say "=== Step 15: Final Status Summary ==="

say "Service Pods (record-platform, should be 1/1 Ready):"
for service in "${SERVICES[@]}"; do
  ready=$(_kubectl get deployment "$service" -n "$NS" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
  desired=$(_kubectl get deployment "$service" -n "$NS" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "0")
  if [[ "$ready" == "$desired" ]] && [[ "$desired" == "1" ]]; then
    ok "  $service: $ready/$desired Ready"
  else
    warn "  $service: $ready/$desired Ready"
  fi
done

say "Exporters (record-platform, should be 1/1 Ready):"
for exporter in "${EXPORTERS[@]}"; do
  ready=$(_kubectl get deployment "$exporter" -n "$NS" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
  desired=$(_kubectl get deployment "$exporter" -n "$NS" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "0")
  if [[ "$ready" == "$desired" ]] && [[ "$desired" == "1" ]]; then
    ok "  $exporter: $ready/$desired Ready"
  else
    warn "  $exporter: $ready/$desired Ready"
  fi
done

say "Caddy (ingress-nginx, should be 2/2 Ready):"
caddy_ready=$(_kubectl get deployment caddy-h3 -n "$INGRESS_NS" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
caddy_desired=$(_kubectl get deployment caddy-h3 -n "$INGRESS_NS" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "0")
if [[ "$caddy_ready" == "$caddy_desired" ]] && [[ "$caddy_desired" == "2" ]]; then
  ok "  caddy-h3: $caddy_ready/$caddy_desired Ready"
else
  warn "  caddy-h3: $caddy_ready/$caddy_desired Ready"
fi

say "Envoy (envoy-test, should be 1/1 Ready):"
envoy_ready=$(_kubectl get deployment envoy-test -n "$ENVOY_NS" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
envoy_desired=$(_kubectl get deployment envoy-test -n "$ENVOY_NS" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "0")
if [[ -z "$envoy_desired" ]] || [[ "$envoy_desired" == "0" ]]; then
  envoy_ready=$(_kubectl get deployment envoy-test -n "$INGRESS_NS" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
  envoy_desired=$(_kubectl get deployment envoy-test -n "$INGRESS_NS" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "0")
fi
if [[ "$envoy_ready" == "$envoy_desired" ]] && [[ "$envoy_desired" == "1" ]]; then
  ok "  envoy-test: $envoy_ready/$envoy_desired Ready"
else
  warn "  envoy-test: $envoy_ready/$envoy_desired Ready"
fi

say ""
say "=== Platform Ready Check Complete ==="

if [[ "$ALL_READY" == "true" ]]; then
  ok "Platform is ready for test suite!"
  say ""
  say "Next: Run test suite"
  say "  RUN_REISSUE=0 ./scripts/run-preflight-scale-and-all-suites.sh 2>&1 | tee /tmp/pipeline-$(date +%Y%m%d-%H%M%S).log"
  exit 0
else
  warn "Platform not fully ready. Check pod status above."
  exit 1
fi
