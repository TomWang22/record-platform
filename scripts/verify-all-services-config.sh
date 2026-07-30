#!/usr/bin/env bash
# Verify all services have proper TLS/mTLS and Kafka SSL configuration
# This ensures strict TLS and mTLS are properly configured across all services

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "  ✅ $*"; }
warn(){ echo "  ⚠️  $*"; }
fail(){ echo "  ❌ $*"; }

say "=== Verifying All Services Configuration ==="

# Services that should have GRPC_REQUIRE_CLIENT_CERT=true
GRPC_SERVICES=(
  "auth-service"
  "records-service"
  "listings-service"
  "messaging-service"
  "shopping-service"
  "analytics-service"
  "auction-monitor"
  "python-ai-service"
)

# Services that need Kafka SSL
KAFKA_SERVICES=(
  "analytics-service"
  "auction-monitor"
  "python-ai-service"
  "messaging-service"
)

ERRORS=0

say "1. Checking GRPC_REQUIRE_CLIENT_CERT for mTLS..."
for svc in "${GRPC_SERVICES[@]}"; do
  DEPLOY="infra/k8s/base/$svc/deploy.yaml"
  if [[ ! -f "$DEPLOY" ]]; then
    warn "$svc: deploy.yaml not found"
    continue
  fi
  
  # Check if GRPC_REQUIRE_CLIENT_CERT exists and value is true (can be on same or next line)
  if grep -A1 "GRPC_REQUIRE_CLIENT_CERT" "$DEPLOY" 2>/dev/null | grep -q "true"; then
    ok "$svc: Has GRPC_REQUIRE_CLIENT_CERT=true"
  else
    fail "$svc: Missing GRPC_REQUIRE_CLIENT_CERT=true"
    ((ERRORS++)) || true
  fi
done

say "2. Checking TLS mounts (dev-root-ca, service-tls)..."
for svc in "${GRPC_SERVICES[@]}"; do
  DEPLOY="infra/k8s/base/$svc/deploy.yaml"
  if [[ ! -f "$DEPLOY" ]]; then
    warn "$svc: deploy.yaml not found"
    continue
  fi
  
  HAS_DEV_ROOT_CA=$(grep -c "dev-root-ca" "$DEPLOY" 2>/dev/null || echo "0")
  HAS_SERVICE_TLS=$(grep -cE "service-tls|tls-certs" "$DEPLOY" 2>/dev/null || echo "0")
  
  if [[ "$HAS_DEV_ROOT_CA" -gt 0 ]] && [[ "$HAS_SERVICE_TLS" -gt 0 ]]; then
    ok "$svc: Has both dev-root-ca and service-tls mounts"
  else
    fail "$svc: Missing TLS mounts (dev-root-ca: $HAS_DEV_ROOT_CA, service-tls: $HAS_SERVICE_TLS)"
    ((ERRORS++)) || true
  fi
done

say "3. Checking Kafka SSL configuration for services that need it..."
for svc in "${KAFKA_SERVICES[@]}"; do
  DEPLOY="infra/k8s/base/$svc/deploy.yaml"
  if [[ ! -f "$DEPLOY" ]]; then
    warn "$svc: deploy.yaml not found"
    continue
  fi
  
  HAS_KAFKA_MOUNT=$(grep -c "kafka-ssl-certs" "$DEPLOY" 2>/dev/null || echo "0")
  HAS_KAFKA_ENV=$(grep -cE "KAFKA_BROKER|KAFKA_USE_SSL|KAFKA_CA_CERT" "$DEPLOY" 2>/dev/null || echo "0")
  
  if [[ "$HAS_KAFKA_MOUNT" -gt 0 ]] && [[ "$HAS_KAFKA_ENV" -gt 0 ]]; then
    ok "$svc: Has Kafka SSL mount and env vars"
  else
    fail "$svc: Missing Kafka SSL config (mount: $HAS_KAFKA_MOUNT, env: $HAS_KAFKA_ENV)"
    ((ERRORS++)) || true
  fi
done

say "4. Checking health probe TLS configuration..."
for svc in "${GRPC_SERVICES[@]}"; do
  DEPLOY="infra/k8s/base/$svc/deploy.yaml"
  if [[ ! -f "$DEPLOY" ]]; then
    continue
  fi
  
  # Check for conflicting flags
  if grep -q "tls-no-verify=true.*tls-ca-cert" "$DEPLOY" 2>/dev/null || \
     grep -q "tls-ca-cert.*tls-no-verify=true" "$DEPLOY" 2>/dev/null; then
    fail "$svc: Health probe has conflicting TLS flags (-tls-no-verify=true with -tls-ca-cert)"
    ((ERRORS++)) || true
  elif grep -q "tls-no-verify=false" "$DEPLOY" 2>/dev/null && \
       grep -q "tls-ca-cert" "$DEPLOY" 2>/dev/null; then
    ok "$svc: Health probes have correct TLS configuration"
  else
    warn "$svc: Health probe TLS config may be incomplete (check manually)"
  fi
done

say "5. Summary"
if [[ $ERRORS -eq 0 ]]; then
  ok "All services properly configured for strict TLS and mTLS!"
  exit 0
else
  fail "Found $ERRORS configuration issue(s). Please fix them."
  exit 1
fi
