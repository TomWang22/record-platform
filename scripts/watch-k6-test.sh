#!/usr/bin/env bash
# ======================================================================
# File: scripts/watch-k6-test.sh
# Purpose: Watch k6 test progress with 15-second updates and timestamps
# Usage: ./scripts/watch-k6-test.sh [auth|listings|social|shopping]
# ======================================================================
set -euo pipefail

SERVICE="${1:-listings}"
NAMESPACE="record-platform"

case "${SERVICE}" in
  auth)
    JOBS=("k6-auth-load-1" "k6-auth-load-2" "k6-auth-load-3" "k6-auth-load-4")
    JOB_SELECTOR='job-name in (k6-auth-load-1,k6-auth-load-2,k6-auth-load-3,k6-auth-load-4)'
    ;;
  listings)
    JOBS=("k6-listings-load-1" "k6-listings-load-2" "k6-listings-load-3" "k6-listings-load-4")
    JOB_SELECTOR='job-name in (k6-listings-load-1,k6-listings-load-2,k6-listings-load-3,k6-listings-load-4)'
    ;;
  *)
    echo "Usage: $0 [auth|listings|social|shopping]"
    exit 1
    ;;
esac

echo "=== Watching ${SERVICE} k6 test (15-second updates) ==="
echo "Press Ctrl+C to stop"
echo ""

while true; do
  clear
  TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
  
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "[${TIMESTAMP}] ${SERVICE} Service k6 Test Status"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  
  # Job status
  echo "📋 Job Status:"
  kubectl -n "${NAMESPACE}" get jobs "${JOBS[@]}" 2>/dev/null || echo "  (jobs not found yet)"
  echo ""
  
  # Pod status with timestamps
  echo "📦 Pod Status (with creation timestamps):"
  kubectl -n "${NAMESPACE}" get pods -l "${JOB_SELECTOR}" \
    -o custom-columns='NAME:.metadata.name,STATUS:.status.phase,READY:.status.containerStatuses[0].ready,RESTARTS:.status.containerStatuses[0].restartCount,AGE:.metadata.creationTimestamp' 2>/dev/null || echo "  (pods not found yet)"
  echo ""
  
  # k6 progress from logs
  echo "📊 k6 Progress (last line per pod):"
  for job in "${JOBS[@]}"; do
    pod=$(kubectl -n "${NAMESPACE}" get pods -l "job-name=${job}" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
    if [[ -n "${pod}" ]]; then
      progress=$(kubectl -n "${NAMESPACE}" logs "${pod}" --tail=1 2>/dev/null | grep -E "running|default|VUs|iterations|complete" | tail -1 || echo "  (no progress yet)")
      if [[ -n "${progress}" ]]; then
        echo "  ${job}: ${progress}"
      else
        echo "  ${job}: (starting...)"
      fi
    else
      echo "  ${job}: (pod not found)"
    fi
  done
  echo ""
  
  # Check if all jobs are complete
  COMPLETED=0
  TOTAL=0
  for job in "${JOBS[@]}"; do
    if kubectl -n "${NAMESPACE}" get job "${job}" >/dev/null 2>&1; then
      TOTAL=$((TOTAL + 1))
      succeeded=$(kubectl -n "${NAMESPACE}" get job "${job}" -o jsonpath='{.status.succeeded}' 2>/dev/null || echo "0")
      if [[ "${succeeded}" -gt 0 ]]; then
        COMPLETED=$((COMPLETED + 1))
      fi
    fi
  done
  
  if [[ "${TOTAL}" -gt 0 ]] && [[ "${COMPLETED}" -eq "${TOTAL}" ]]; then
    echo "✅ All jobs completed!"
    break
  fi
  
  echo "⏱️  Next update in 15 seconds... (Press Ctrl+C to stop)"
  sleep 15
done

echo ""
echo "=== Test Complete ==="

