#!/usr/bin/env bash
set -euo pipefail

# Fix missing secrets for Redis and Postgres
# This script creates the required secrets that are missing

NS="${1:-record-platform}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

say "Creating missing secrets..."

# Create redis-auth secret (Redis expects this name)
if ! kubectl -n "$NS" get secret redis-auth >/dev/null 2>&1; then
  # Get REDIS_PASSWORD from app-secrets if it exists, otherwise use default
  REDIS_PASSWORD="postgres"
  if kubectl -n "$NS" get secret app-secrets >/dev/null 2>&1; then
    REDIS_PASSWORD=$(kubectl -n "$NS" get secret app-secrets -o jsonpath='{.data.REDIS_PASSWORD}' 2>/dev/null | base64 -d 2>/dev/null || echo "postgres")
  fi
  
  kubectl -n "$NS" create secret generic redis-auth \
    --from-literal=REDIS_PASSWORD="$REDIS_PASSWORD" \
    --dry-run=client -o yaml | kubectl apply -f -
  ok "Created redis-auth secret"
else
  ok "redis-auth secret already exists"
fi

# Create postgres-secret (cron-jobs expects this name)
if ! kubectl -n "$NS" get secret postgres-secret >/dev/null 2>&1; then
  # Get POSTGRES_PASSWORD from postgres-superuser if it exists, otherwise use default
  POSTGRES_PASSWORD="postgres"
  if kubectl -n "$NS" get secret postgres-superuser >/dev/null 2>&1; then
    POSTGRES_PASSWORD=$(kubectl -n "$NS" get secret postgres-superuser -o jsonpath='{.data.POSTGRES_PASSWORD}' 2>/dev/null | base64 -d 2>/dev/null || echo "postgres")
  fi
  
  kubectl -n "$NS" create secret generic postgres-secret \
    --from-literal=POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
    --dry-run=client -o yaml | kubectl apply -f -
  ok "Created postgres-secret"
else
  ok "postgres-secret already exists"
fi

say "Secrets created. Restarting affected pods..."

# Restart Redis to pick up the secret
kubectl -n "$NS" rollout restart deploy/redis 2>/dev/null || warn "Redis deployment not found"
kubectl -n "$NS" rollout restart deploy/cron-jobs 2>/dev/null || warn "Cron-jobs deployment not found"

ok "Done! Pods will restart automatically."

