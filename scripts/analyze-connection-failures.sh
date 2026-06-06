#!/usr/bin/env bash
# Analyze connection failures and error types from service logs

set -euo pipefail

NS="record-platform"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
OUTPUT_FILE="test-results/connection-failure-analysis-${TIMESTAMP}.md"

say() { printf "\n=== %s ===\n" "$*"; }
ok() { printf "✅ %s\n" "$*"; }
warn() { printf "⚠️  %s\n" "$*"; }
fail() { printf "❌ %s\n" "$*"; }

say "Analyzing Connection Failures and Error Types"

{
  echo "# Connection Failure Analysis - $(date)"
  echo ""
  echo "## Service Logs Analysis"
  echo ""
  
  for service in auth-service records-service social-service listings-service shopping-service analytics-service python-ai-service api-gateway; do
    say "Analyzing $service logs..."
    echo "### $service"
    echo ""
    
    # Get recent logs
    echo "#### Recent Errors:"
    kubectl -n "$NS" logs -l app="$service" --tail=100 2>/dev/null | \
      grep -iE "(error|failed|refused|reset|timeout|connection)" | \
      head -20 || echo "No errors found"
    echo ""
    
    # Count error types
    echo "#### Error Type Counts:"
    kubectl -n "$NS" logs -l app="$service" --tail=1000 2>/dev/null | \
      grep -iE "(ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|connection refused|connection reset|timeout)" | \
      sed -E 's/.*(ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|connection refused|connection reset|timeout).*/\1/i' | \
      sort | uniq -c | sort -rn || echo "No connection errors found"
    echo ""
    
    # Check for gRPC errors
    echo "#### gRPC Errors:"
    kubectl -n "$NS" logs -l app="$service" --tail=1000 2>/dev/null | \
      grep -iE "(grpc|rpc)" | \
      grep -iE "(error|failed|refused)" | \
      head -10 || echo "No gRPC errors found"
    echo ""
    
    echo "---"
    echo ""
  done
  
  echo "## API Gateway Proxy Errors"
  echo ""
  kubectl -n "$NS" logs -l app=api-gateway --tail=500 2>/dev/null | \
    grep -E "(proxy error|upstream error|ECONNREFUSED|ECONNRESET)" | \
    sort | uniq -c | sort -rn | head -30 || echo "No proxy errors found"
  echo ""
  
  echo "## Summary"
  echo ""
  echo "### Total Error Counts by Type:"
  kubectl -n "$NS" logs -l app=api-gateway --tail=5000 2>/dev/null | \
    grep -oE "(ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|connection refused|connection reset|timeout)" | \
    sort | uniq -c | sort -rn || echo "No errors found"
  
} > "$OUTPUT_FILE"

ok "Analysis complete: $OUTPUT_FILE"
cat "$OUTPUT_FILE"

