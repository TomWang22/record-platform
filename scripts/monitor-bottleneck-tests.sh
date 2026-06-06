#!/usr/bin/env bash
set -euo pipefail

# Monitor both bottleneck and ramp tests

NS_K6="${NS_K6:-k6-load}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

say "Monitoring k6 Tests..."

while true; do
  clear
  echo "=== k6 Test Status ==="
  echo ""
  
  # Show jobs
  echo "Jobs:"
  kubectl -n "$NS_K6" get jobs -l 'app in (k6-bottleneck-test,k6-shopping-ramp)' 2>/dev/null || echo "No jobs found"
  echo ""
  
  # Show pods
  echo "Pods:"
  kubectl -n "$NS_K6" get pods -l 'app in (k6-bottleneck-test,k6-shopping-ramp)' 2>/dev/null || echo "No pods found"
  echo ""
  
  # Show recent logs from each test
  for job in $(kubectl -n "$NS_K6" get jobs -o jsonpath='{.items[*].metadata.name}' 2>/dev/null | grep -E "(bottleneck|ramp)"); do
    echo "=== $job ==="
    kubectl -n "$NS_K6" logs -l job-name=$job --tail=3 2>&1 | grep -E "(running|VUs|BOTTLENECK|complete)" | tail -2 || echo "No logs yet"
    echo ""
  done
  
  # Check if tests are complete
  COMPLETE=$(kubectl -n "$NS_K6" get jobs -l 'app in (k6-bottleneck-test,k6-shopping-ramp)' -o jsonpath='{.items[?(@.status.conditions[?(@.type=="Complete")].status=="True")].metadata.name}' 2>/dev/null || echo "")
  if [[ -n "$COMPLETE" ]]; then
    say "Tests completed! Jobs: $COMPLETE"
    break
  fi
  
  sleep 30
done

say "Test monitoring complete"

