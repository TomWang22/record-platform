#!/usr/bin/env bash
# Fix Colima k3s API server and run tests
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/bin:/bin:$PATH"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

say "=== Fixing Colima k3s and Running Tests ==="
echo ""

# Step 1: Check Colima status
say "Step 1: Checking Colima status..."
if colima status >/dev/null 2>&1; then
  ok "Colima is running"
else
  warn "Colima is not running - starting..."
  colima start --with-kubernetes
  sleep 10
fi

# Step 2: Check k3s status
say "Step 2: Checking k3s status..."
if colima ssh -- sudo systemctl is-active k3s >/dev/null 2>&1; then
  ok "k3s is active"
else
  warn "k3s is not active - restarting..."
  colima ssh -- sudo systemctl restart k3s
  echo "Waiting 30s for k3s to start..."
  sleep 30
fi

# Step 3: Fix kubeconfig
say "Step 3: Setting up kubeconfig..."
kubectl config use-context colima >/dev/null 2>&1 || true

# Step 4: Test API server
say "Step 4: Testing API server connectivity..."
for i in {1..10}; do
  if kubectl get nodes --request-timeout=5s >/dev/null 2>&1; then
    ok "API server is reachable"
    break
  fi
  if [ $i -eq 10 ]; then
    warn "API server not reachable after 10 attempts"
    echo "Trying to restart k3s again..."
    colima ssh -- sudo systemctl restart k3s
    sleep 30
  else
    echo "  Attempt $i/10 failed, retrying..."
    sleep 5
  fi
done

# Step 5: Check service status
say "Step 5: Checking service pod status..."
kubectl get pods -n record-platform -l 'app in (auth-service,records-service,listings-service,social-service,shopping-service,analytics-service,auction-monitor,python-ai-service)' \
  -o custom-columns=NAME:.metadata.name,READY:.status.containerStatuses[0].ready,STATUS:.status.phase \
  --no-headers 2>/dev/null | head -10 || warn "Could not get pod status"

echo ""

# Step 6: Run test suite
say "Step 6: Running test suite..."
echo "This will run the full test suite with Colima k3s"
echo ""

RUN_REISSUE=0 REQUIRE_COLIMA=1 ./scripts/run-preflight-scale-and-all-suites.sh 2>&1 | tee /tmp/pipeline-colima-final-$(date +%Y%m%d-%H%M%S).log

say "=== Test Suite Complete ==="
