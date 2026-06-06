#!/usr/bin/env bash
set -euo pipefail

# Fix all service issues after cluster restart
# This script:
# 1. Creates missing secrets
# 2. Rebuilds python-ai-service with fixed imports
# 3. Restarts affected services
# 4. Waits for services to be ready

NS="${1:-record-platform}"
CLUSTER="${2:-h3}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

say "Fixing all service issues..."

# Step 1: Create missing secrets
say "Step 1: Creating missing secrets..."
./scripts/fix-missing-secrets.sh "$NS"

# Step 2: Rebuild python-ai-service with fixed imports
say "Step 2: Rebuilding python-ai-service..."
docker build --platform linux/amd64 \
  -f services/python-ai-service/Dockerfile \
  -t python-ai-service:dev . >/dev/null 2>&1 || {
  warn "Python AI build had issues, continuing..."
}

kind load docker-image python-ai-service:dev --name "$CLUSTER" 2>/dev/null || true

# Step 3: Restart services
say "Step 3: Restarting services..."
kubectl -n "$NS" rollout restart deploy/python-ai-service 2>/dev/null || true
kubectl -n "$NS" rollout restart deploy/social-service 2>/dev/null || true

# Step 4: Wait for services
say "Step 4: Waiting for services to be ready..."
sleep 5

# Wait for Redis
if kubectl -n "$NS" get deploy redis >/dev/null 2>&1; then
  kubectl -n "$NS" rollout status deploy/redis --timeout=60s || warn "Redis not ready"
fi

# Wait for Postgres
if kubectl -n "$NS" get deploy postgres >/dev/null 2>&1; then
  kubectl -n "$NS" rollout status deploy/postgres --timeout=120s || warn "Postgres not ready"
fi

# Wait for Python AI
if kubectl -n "$NS" get deploy python-ai-service >/dev/null 2>&1; then
  kubectl -n "$NS" rollout status deploy/python-ai-service --timeout=60s || warn "Python AI not ready"
fi

# Step 5: Show status
say "Step 5: Service Status"
kubectl -n "$NS" get pods | grep -E "NAME|redis|cron-jobs|python-ai|social|postgres" || true

ok "Done! Check pod status above."

