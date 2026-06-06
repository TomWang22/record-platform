#!/usr/bin/env bash
set -euo pipefail

# Fix Analytics Service Database Connection
# This script helps diagnose and fix the database connection issue

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
info() { echo "ℹ️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

NS="record-platform"
HOST_IP="10.0.0.8"  # Update this to your actual host IP if different

say "🔧 Analytics Service Database Connection Fix"

# Step 1: Check if databases exist in Docker Compose
say "Step 1: Verifying databases exist in Docker Compose..."

info "Checking postgres-analytics (port 5439)..."
if docker exec -it record-platform-postgres-analytics-1 psql -U postgres -c "\l" 2>/dev/null | grep -q "analytics"; then
  ok "analytics database exists in postgres-analytics"
else
  warn "analytics database NOT found in postgres-analytics"
  info "Creating analytics database..."
  docker exec -it record-platform-postgres-analytics-1 psql -U postgres -c "CREATE DATABASE analytics;" 2>/dev/null || true
fi

info "Checking postgres-listings (port 5435)..."
if docker exec -it record-platform-postgres-listings-1 psql -U postgres -c "\l" 2>/dev/null | grep -q "records"; then
  ok "records database exists in postgres-listings"
else
  warn "records database NOT found in postgres-listings"
  info "Creating records database..."
  docker exec -it record-platform-postgres-listings-1 psql -U postgres -c "CREATE DATABASE records;" 2>/dev/null || true
fi

# Step 2: Test connection from host
say "Step 2: Testing connection from host machine..."

info "Testing connection to postgres-analytics:5439..."
if psql -h localhost -p 5439 -U postgres -d analytics -c "SELECT 1;" >/dev/null 2>&1; then
  ok "Connection to postgres-analytics:5439 works from host"
else
  warn "Connection to postgres-analytics:5439 failed from host"
  info "Make sure Docker Compose postgres-analytics is running"
fi

info "Testing connection to postgres-listings:5435..."
if psql -h localhost -p 5435 -U postgres -d records -c "SELECT 1;" >/dev/null 2>&1; then
  ok "Connection to postgres-listings:5435 works from host"
else
  warn "Connection to postgres-listings:5435 failed from host"
  info "Make sure Docker Compose postgres-listings is running"
fi

# Step 3: Get host IP for Kind cluster
say "Step 3: Determining host IP for Kind cluster..."

# Try multiple methods to get host IP
HOST_IP=$(ipconfig getifaddr en0 2>/dev/null || \
          ifconfig | grep -A 1 "inet " | grep -v "127.0.0.1" | head -1 | awk '{print $2}' || \
          echo "10.0.0.8")

info "Detected host IP: $HOST_IP"
info "If this is incorrect, update HOST_IP in this script"

# Step 4: Test connection from Kind cluster
say "Step 4: Testing connection from Kind cluster..."

info "Testing host.docker.internal:5439 from Kind cluster..."
if kubectl run -n "$NS" --rm -i --restart=Never test-analytics-db --image=postgres:16-alpine -- \
  psql -h host.docker.internal -p 5439 -U postgres -d analytics -c "SELECT 1;" >/dev/null 2>&1; then
  ok "host.docker.internal:5439 works from Kind cluster"
  USE_HOST_DOCKER_INTERNAL=true
else
  warn "host.docker.internal:5439 failed from Kind cluster"
  USE_HOST_DOCKER_INTERNAL=false
fi

if [[ "$USE_HOST_DOCKER_INTERNAL" == "false" ]]; then
  info "Testing with host IP ($HOST_IP):5439..."
  if kubectl run -n "$NS" --rm -i --restart=Never test-analytics-db-ip --image=postgres:16-alpine -- \
    psql -h "$HOST_IP" -p 5439 -U postgres -d analytics -c "SELECT 1;" >/dev/null 2>&1; then
    ok "Host IP ($HOST_IP):5439 works from Kind cluster"
    USE_HOST_IP=true
  else
    warn "Host IP ($HOST_IP):5439 also failed"
    USE_HOST_IP=false
  fi
fi

# Step 5: Update ConfigMap if needed
say "Step 5: Updating Kubernetes ConfigMap..."

if [[ "$USE_HOST_DOCKER_INTERNAL" == "true" ]]; then
  info "host.docker.internal works - no changes needed"
  info "Current config should work:"
  info "  POSTGRES_URL_ANALYTICS: postgresql://postgres:postgres@host.docker.internal:5439/analytics"
  info "  POSTGRES_URL_LISTINGS: postgresql://postgres:postgres@host.docker.internal:5435/records"
elif [[ "$USE_HOST_IP" == "true" ]]; then
  warn "host.docker.internal doesn't work, but host IP does"
  info "Updating ConfigMap to use host IP: $HOST_IP"
  
  kubectl patch configmap app-config -n "$NS" --type merge -p "{
    \"data\": {
      \"POSTGRES_URL_ANALYTICS\": \"postgresql://postgres:postgres@${HOST_IP}:5439/analytics?connect_timeout=5\",
      \"POSTGRES_URL_LISTINGS\": \"postgresql://postgres:postgres@${HOST_IP}:5435/records?connect_timeout=5\"
    }
  }"
  
  ok "ConfigMap updated to use host IP"
  info "Restarting analytics-service to pick up new config..."
  kubectl rollout restart deployment/analytics-service -n "$NS"
else
  fail "Neither host.docker.internal nor host IP works"
  info "Possible solutions:"
  info "  1. Check if Docker Compose postgres containers are running"
  info "  2. Check firewall settings"
  info "  3. Use Kubernetes Services to expose Postgres (better for production)"
fi

# Step 6: Wait for analytics-service to be ready
if [[ "$USE_HOST_IP" == "true" ]] || [[ "$USE_HOST_DOCKER_INTERNAL" == "true" ]]; then
  say "Step 6: Waiting for analytics-service to be ready..."
  kubectl rollout status deployment/analytics-service -n "$NS" --timeout=120s || warn "Analytics service may still be starting"
  
  # Check health
  sleep 5
  if kubectl get pods -n "$NS" -l app=analytics-service | grep -q "Running"; then
    ok "Analytics service is running"
    
    # Check logs for connection errors
    info "Checking analytics-service logs for connection errors..."
    if kubectl logs -n "$NS" -l app=analytics-service --tail=20 2>&1 | grep -qi "error.*database\|connection.*refused\|ECONNREFUSED"; then
      warn "Still seeing connection errors in logs"
      kubectl logs -n "$NS" -l app=analytics-service --tail=10
    else
      ok "No connection errors in recent logs"
    fi
  else
    warn "Analytics service is not running yet"
    info "Check logs: kubectl logs -n $NS -l app=analytics-service"
  fi
fi

say "✅ Database connection fix complete!"
info "If issues persist, check:"
info "  1. kubectl logs -n $NS -l app=analytics-service"
info "  2. kubectl describe pod -n $NS -l app=analytics-service"
info "  3. Ensure Docker Compose postgres containers are healthy"

