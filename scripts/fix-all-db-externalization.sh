#!/usr/bin/env bash
# Fix all 8 database externalization configurations
# Ensure all databases use correct ports (5433-5440) and host.docker.internal

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; }
info() { echo "ℹ️  $*"; }

# Database configuration: service_name:external_port:internal_port:db_name
declare -A DB_CONFIG=(
  ["postgres-external"]="5433:5432:records"
  ["postgres-social-external"]="5434:5432:records"
  ["postgres-listings-external"]="5435:5432:records"
  ["postgres-shopping-external"]="5436:5432:shopping"
  ["postgres-auth-external"]="5437:5432:records"
  ["postgres-auction-monitor-external"]="5438:5432:records"
  ["postgres-analytics-external"]="5439:5432:records"
  ["postgres-python-ai-external"]="5440:5432:records"
)

# Detect Docker host IP (for macOS/Colima)
DOCKER_HOST_IP="host.docker.internal"
if [[ "$(uname)" == "Darwin" ]]; then
  # macOS - use host.docker.internal
  DOCKER_HOST_IP="host.docker.internal"
elif command -v colima >/dev/null 2>&1; then
  # Colima - try to get the IP
  COLIMA_IP=$(colima ls --json 2>/dev/null | jq -r '.[0].vmnet' 2>/dev/null || echo "")
  if [[ -n "$COLIMA_IP" ]]; then
    DOCKER_HOST_IP="$COLIMA_IP"
  fi
fi

say "=== Fixing All 8 Database Externalization Configurations ==="
info "Using Docker host: $DOCKER_HOST_IP"

for svc_name in "${!DB_CONFIG[@]}"; do
  IFS=':' read -r external_port internal_port db_name <<< "${DB_CONFIG[$svc_name]}"
  
  say "Fixing $svc_name (external port: $external_port, internal: $internal_port)..."
  
  # Check if service exists
  if ! kubectl get svc -n record-platform "$svc_name" >/dev/null 2>&1; then
    warn "$svc_name: Service not found, creating..."
    
    # Create service
    kubectl create service clusterip "$svc_name" -n record-platform \
      --tcp="$external_port:$internal_port" \
      --dry-run=client -o yaml | \
      kubectl apply -f - 2>&1 | grep -v "unchanged" || true
    
    # Update service port to match external port
    kubectl patch svc -n record-platform "$svc_name" --type='json' \
      -p="[{\"op\": \"replace\", \"path\": \"/spec/ports/0/port\", \"value\": $external_port}]" 2>&1 | grep -v "unchanged" || true
  else
    ok "$svc_name: Service exists"
    
    # Update service port
    CURRENT_PORT=$(kubectl get svc -n record-platform "$svc_name" -o jsonpath='{.spec.ports[0].port}' 2>/dev/null || echo "")
    if [[ "$CURRENT_PORT" != "$external_port" ]]; then
      info "  Updating service port from $CURRENT_PORT to $external_port"
      kubectl patch svc -n record-platform "$svc_name" --type='json' \
        -p="[{\"op\": \"replace\", \"path\": \"/spec/ports/0/port\", \"value\": $external_port}]" 2>&1 | grep -v "unchanged" || true
    else
      ok "  Service port is correct ($external_port)"
    fi
  fi
  
  # Fix endpoints
  if ! kubectl get endpoints -n record-platform "$svc_name" >/dev/null 2>&1; then
    warn "$svc_name: Endpoints not found, creating..."
    
    # Create endpoints pointing to host.docker.internal
    cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Endpoints
metadata:
  name: $svc_name
  namespace: record-platform
subsets:
  - addresses:
      - ip: $DOCKER_HOST_IP
    ports:
      - name: postgres
        port: $external_port
EOF
  else
    ok "$svc_name: Endpoints exist"
    
    # Update endpoint IP and port
    CURRENT_IP=$(kubectl get endpoints -n record-platform "$svc_name" -o jsonpath='{.subsets[0].addresses[0].ip}' 2>/dev/null || echo "")
    CURRENT_ENDPOINT_PORT=$(kubectl get endpoints -n record-platform "$svc_name" -o jsonpath='{.subsets[0].ports[0].port}' 2>/dev/null || echo "")
    
    if [[ "$CURRENT_IP" != "$DOCKER_HOST_IP" ]] || [[ "$CURRENT_ENDPOINT_PORT" != "$external_port" ]]; then
      info "  Updating endpoint: IP $CURRENT_IP -> $DOCKER_HOST_IP, port $CURRENT_ENDPOINT_PORT -> $external_port"
      
      # Patch endpoint
      kubectl patch endpoints -n record-platform "$svc_name" --type='json' \
        -p="[
          {\"op\": \"replace\", \"path\": \"/subsets/0/addresses/0/ip\", \"value\": \"$DOCKER_HOST_IP\"},
          {\"op\": \"replace\", \"path\": \"/subsets/0/ports/0/port\", \"value\": $external_port}
        ]" 2>&1 | grep -v "unchanged" || true
    else
      ok "  Endpoint is correct (IP: $DOCKER_HOST_IP, port: $external_port)"
    fi
  fi
done

say "=== Verifying All Database Services ==="
for svc_name in "${!DB_CONFIG[@]}"; do
  IFS=':' read -r external_port internal_port db_name <<< "${DB_CONFIG[$svc_name]}"
  
  SVC_PORT=$(kubectl get svc -n record-platform "$svc_name" -o jsonpath='{.spec.ports[0].port}' 2>/dev/null || echo "")
  ENDPOINT_IP=$(kubectl get endpoints -n record-platform "$svc_name" -o jsonpath='{.subsets[0].addresses[0].ip}' 2>/dev/null || echo "")
  ENDPOINT_PORT=$(kubectl get endpoints -n record-platform "$svc_name" -o jsonpath='{.subsets[0].ports[0].port}' 2>/dev/null || echo "")
  
  if [[ "$SVC_PORT" == "$external_port" ]] && [[ "$ENDPOINT_IP" == "$DOCKER_HOST_IP" ]] && [[ "$ENDPOINT_PORT" == "$external_port" ]]; then
    ok "$svc_name: ✅ Correct (port: $external_port, endpoint: $DOCKER_HOST_IP:$external_port)"
  else
    warn "$svc_name: ⚠️  Mismatch (svc port: $SVC_PORT, endpoint: $ENDPOINT_IP:$ENDPOINT_PORT, expected: $external_port)"
  fi
done

say "=== Summary ==="
ok "All 8 database externalization configurations updated"
info "Run './scripts/test-all-services-db-connections.sh' to verify connections"
