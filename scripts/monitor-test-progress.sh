#!/usr/bin/env bash
# Monitor test suite progress and document findings
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/bin:/bin:$PATH"
docker context use colima >/dev/null 2>&1 || true
# Use Kind cluster 'h3' only if it exists (e.g. kind-h3); on Colima skip to avoid "could not locate control plane for cluster named 'h3'"
if kind get clusters 2>/dev/null | grep -qx 'h3'; then
  kind get kubeconfig --name h3 > /tmp/kind-h3-kubeconfig.yaml 2>/dev/null && export KUBECONFIG=/tmp/kind-h3-kubeconfig.yaml
elif [[ -s /tmp/kind-h3-kubeconfig.yaml ]]; then
  export KUBECONFIG=/tmp/kind-h3-kubeconfig.yaml
fi
# Otherwise leave KUBECONFIG as-is (e.g. Colima)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

say "=== TEST SUITE MONITORING ==="
echo ""

# Find latest test log
TEST_LOG=$(ls -t /tmp/pipeline-test-*.log 2>/dev/null | head -1 || echo "")
if [[ -z "$TEST_LOG" ]]; then
  warn "No test log found - test suite may not have started"
  exit 1
fi

echo "Monitoring: $TEST_LOG"
echo ""

# Check if test suite is still running
if ps aux | grep -E "run-preflight-scale-and-all-suites|test-microservices" | grep -v grep >/dev/null 2>&1; then
  ok "Test suite is running"
else
  warn "Test suite is not running"
fi
echo ""

# Show recent test output
say "Recent Test Output (last 30 lines):"
tail -30 "$TEST_LOG" 2>/dev/null | sed 's/^/  /' || echo "  (log file empty or not readable)"
echo ""

# Check for errors
say "Errors Found:"
if grep -iE "error|failed|fail|❌|⚠️" "$TEST_LOG" 2>/dev/null | tail -10; then
  echo ""
else
  ok "No errors found in recent output"
fi
echo ""

# Check service status
say "Service Pod Status:"
kubectl get pods -n record-platform -l 'app in (auth-service,records-service,listings-service,messaging-service,shopping-service,analytics-service,auction-monitor,python-ai-service)' \
  -o custom-columns=NAME:.metadata.name,READY:.status.containerStatuses[0].ready,STATUS:.status.phase,AGE:.metadata.creationTimestamp \
  --sort-by=.metadata.creationTimestamp 2>/dev/null | tail -10 || echo "  (could not get pod status)"
echo ""

# Check for test completion
if grep -qE "All suites|PASSED|FAILED|Test.*Complete" "$TEST_LOG" 2>/dev/null; then
  say "Test Suite Status:"
  grep -E "All suites|PASSED|FAILED|Test.*Complete" "$TEST_LOG" 2>/dev/null | tail -5
else
  warn "Test suite still running - no completion message found"
fi

echo ""
say "To continue monitoring:"
echo "  tail -f $TEST_LOG"
