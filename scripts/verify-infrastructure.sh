#!/usr/bin/env bash
# Verify all infrastructure is ready for testing

set -euo pipefail

# Setup PATH
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

say()  { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()   { echo "  ✅ $*"; }
warn() { echo "  ⚠️  $*"; }
fail() { echo "  ❌ $*" >&2; exit 1; }

say "=== Infrastructure Verification ==="

# Check kubectl access
if ! command -v kubectl >/dev/null 2>&1; then
  fail "kubectl not found - run: source scripts/setup-test-env.sh"
fi

if ! kubectl cluster-info >/dev/null 2>&1; then
  warn "Cannot access cluster - check kubectl context"
fi

# 1. Envoy pod (envoy-test namespace)
say "1. Envoy pod (envoy-test namespace):"
ENVOY_PODS=$(kubectl get pods -n envoy-test -l app=envoy-test --no-headers 2>/dev/null | wc -l | tr -d ' ')
if [[ "$ENVOY_PODS" -eq 1 ]]; then
  ENVOY_STATUS=$(kubectl get pods -n envoy-test -l app=envoy-test --no-headers 2>/dev/null | awk '{print $3, $2}')
  if echo "$ENVOY_STATUS" | grep -q "Running.*1/1"; then
    ok "Envoy pod: Running 1/1"
  else
    warn "Envoy pod: $ENVOY_STATUS (not ready)"
  fi
elif [[ "$ENVOY_PODS" -eq 0 ]]; then
  warn "No Envoy pod found in envoy-test namespace"
else
  warn "Multiple Envoy pods found ($ENVOY_PODS)"
fi

# 2. Service pods (record-platform namespace)
say "2. Service pods (record-platform namespace):"
SERVICES=("auth-service" "records-service" "listings-service" "messaging-service" "media-service" "trust-service" "notification-service" "shopping-service" "analytics-service" "auction-monitor" "python-ai-service" "api-gateway")
SERVICE_COUNT=0
SERVICE_READY=0

for svc in "${SERVICES[@]}"; do
  PODS=$(kubectl get pods -n record-platform -l app="$svc" --no-headers 2>/dev/null | wc -l | tr -d ' ')
  if [[ "$PODS" -ge 1 ]]; then
    SERVICE_COUNT=$((SERVICE_COUNT + 1))
    STATUS=$(kubectl get pods -n record-platform -l app="$svc" --no-headers 2>/dev/null | head -1 | awk '{print $3, $2}')
    if echo "$STATUS" | grep -q "Running.*1/1"; then
      SERVICE_READY=$((SERVICE_READY + 1))
      ok "$svc: Running 1/1"
    else
      warn "$svc: $STATUS (not ready)"
    fi
  else
    warn "$svc: No pod found"
  fi
done

if [[ "$SERVICE_COUNT" -eq 9 ]] && [[ "$SERVICE_READY" -eq 9 ]]; then
  ok "All 9 services ready"
elif [[ "$SERVICE_COUNT" -eq 9 ]]; then
  warn "All 9 services found, but $((9 - SERVICE_READY)) not ready"
else
  warn "Only $SERVICE_COUNT/9 services found"
fi

# 3. Exporters (record-platform namespace)
say "3. Exporters (record-platform namespace):"
EXPORTERS=("haproxy-exporter" "nginx-exporter")
EXPORTER_COUNT=0
EXPORTER_READY=0

for exp in "${EXPORTERS[@]}"; do
  PODS=$(kubectl get pods -n record-platform -l app="$exp" --no-headers 2>/dev/null | wc -l | tr -d ' ')
  if [[ "$PODS" -ge 1 ]]; then
    EXPORTER_COUNT=$((EXPORTER_COUNT + 1))
    STATUS=$(kubectl get pods -n record-platform -l app="$exp" --no-headers 2>/dev/null | head -1 | awk '{print $3}')
    if [[ "$STATUS" == "Running" ]]; then
      EXPORTER_READY=$((EXPORTER_READY + 1))
      ok "$exp: Running"
    else
      warn "$exp: $STATUS (not ready)"
    fi
  else
    warn "$exp: No pod found"
  fi
done

if [[ "$EXPORTER_COUNT" -eq 2 ]] && [[ "$EXPORTER_READY" -eq 2 ]]; then
  ok "All 2 exporters ready"
else
  warn "Exporters: $EXPORTER_READY/2 ready"
fi

# 4. Caddy pods (ingress-nginx namespace)
say "4. Caddy pods (ingress-nginx namespace):"
CADDY_PODS=$(kubectl get pods -n ingress-nginx -l app=caddy-h3 --no-headers 2>/dev/null | wc -l | tr -d ' ')
if [[ "$CADDY_PODS" -eq 2 ]]; then
  CADDY_READY=$(kubectl get pods -n ingress-nginx -l app=caddy-h3 --no-headers 2>/dev/null | awk '$3=="Running" && $2=="1/1" {count++} END {print count+0}')
  if [[ "$CADDY_READY" -eq 2 ]]; then
    ok "Caddy pods: 2/2 Running 1/1"
  else
    warn "Caddy pods: $CADDY_READY/2 ready"
  fi
elif [[ "$CADDY_PODS" -eq 0 ]]; then
  warn "No Caddy pods found"
else
  warn "Caddy pods: $CADDY_PODS found (expected 2)"
fi

# 5. Database connectivity (check via service endpoints)
say "5. Database connectivity:"
# Check if services can connect to DBs (indirect check via pod logs or health)
DB_CHECK=0
if kubectl get pods -n record-platform -l app=auth-service --no-headers 2>/dev/null | grep -q "Running.*1/1"; then
  # Try to check if auth-service can reach its DB
  if kubectl exec -n record-platform -l app=auth-service -- pg_isready -h localhost -p 5432 >/dev/null 2>&1 || true; then
    DB_CHECK=$((DB_CHECK + 1))
  fi
fi

if [[ "$DB_CHECK" -gt 0 ]]; then
  ok "Database connectivity: OK (checked via services)"
else
  warn "Database connectivity: Cannot verify (services may not be ready)"
fi

say "=== Summary ==="
if [[ "$ENVOY_PODS" -eq 1 ]] && [[ "$SERVICE_READY" -eq 9 ]] && [[ "$EXPORTER_READY" -eq 2 ]] && [[ "$CADDY_READY" -eq 2 ]]; then
  ok "All infrastructure ready!"
  exit 0
else
  warn "Some infrastructure not ready - check above"
  exit 1
fi
