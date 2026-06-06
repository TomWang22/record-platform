#!/usr/bin/env bash
# Analyze test results and generate summary
# Usage: ./scripts/analyze-test-results.sh [suite-log-dir]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUITE_LOG_DIR="${1:-/tmp/suite-logs-$(ls -td /tmp/suite-logs-* 2>/dev/null | head -1 | xargs basename 2>/dev/null || echo "")}"

if [[ ! -d "$SUITE_LOG_DIR" ]]; then
  echo "❌ Suite log directory not found: $SUITE_LOG_DIR"
  echo "Usage: $0 [suite-log-dir]"
  exit 1
fi

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*"; }

say "=== Test Results Analysis ==="
echo "Analyzing: $SUITE_LOG_DIR"
echo ""

# Count successes and failures
TOTAL_SUITES=0
PASSED_SUITES=0
FAILED_SUITES=0

for suite_log in "$SUITE_LOG_DIR"/*.log; do
  [[ ! -f "$suite_log" ]] && continue
  suite_name=$(basename "$suite_log" .log)
  TOTAL_SUITES=$((TOTAL_SUITES + 1))
  
  if grep -qiE "PASSED|passed|✅.*complete" "$suite_log" 2>/dev/null && ! grep -qiE "FAILED|failed|exit [1-9]" "$suite_log" 2>/dev/null; then
    PASSED_SUITES=$((PASSED_SUITES + 1))
    ok "$suite_name: PASSED"
  else
    FAILED_SUITES=$((FAILED_SUITES + 1))
    fail "$suite_name: FAILED"
    
    # Show key errors
    echo "  Key issues:"
    grep -iE "error|failed|exit [1-9]|502|upstream error|social.*error|curl exit" "$suite_log" 2>/dev/null | head -3 | sed 's/^/    - /' || echo "    (see full log)"
  fi
done

echo ""
say "=== Summary ==="
echo "Total suites: $TOTAL_SUITES"
echo "Passed: $PASSED_SUITES"
echo "Failed: $FAILED_SUITES"

# Social service specific analysis
say "=== Social Service Analysis ==="
SOCIAL_ERRORS=$(grep -iE "social.*502|social upstream error|social.*failed" "$SUITE_LOG_DIR"/*.log 2>/dev/null | wc -l || echo "0")
if [[ "$SOCIAL_ERRORS" -gt 0 ]]; then
  warn "Social service errors found: $SOCIAL_ERRORS"
  echo "  Error details:"
  grep -iE "social.*502|social upstream error" "$SUITE_LOG_DIR"/*.log 2>/dev/null | head -5 | sed 's/^/    - /'
else
  ok "No social service errors found"
fi

# HTTP/3 packet capture analysis
say "=== HTTP/3 Packet Capture Analysis ==="
HTTP3_CAPTURES=$(grep -iE "http3.*pcap|quic.*pcap|udp.*443" "$SUITE_LOG_DIR"/*.log 2>/dev/null | wc -l || echo "0")
if [[ "$HTTP3_CAPTURES" -gt 0 ]]; then
  ok "HTTP/3 packet captures found: $HTTP3_CAPTURES references"
else
  warn "No HTTP/3 packet capture references found"
fi

# Cache verification analysis
say "=== Cache Verification Analysis ==="
CACHE_HITS=$(grep -iE "cache.*hit|hit rate" "$SUITE_LOG_DIR"/*.log 2>/dev/null | wc -l || echo "0")
if [[ "$CACHE_HITS" -gt 0 ]]; then
  ok "Cache hit/miss data found: $CACHE_HITS references"
  grep -iE "cache.*hit|hit rate" "$SUITE_LOG_DIR"/*.log 2>/dev/null | head -3 | sed 's/^/    /'
else
  warn "No cache hit/miss data found"
fi

# Database verification analysis
say "=== Database Verification Analysis ==="
DB_VERIFICATION=$(grep -iE "database.*verification|shopping.*cart|forum.*posts|messages" "$SUITE_LOG_DIR"/*.log 2>/dev/null | wc -l || echo "0")
if [[ "$DB_VERIFICATION" -gt 0 ]]; then
  ok "Database verification data found: $DB_VERIFICATION references"
else
  warn "No database verification data found"
fi

echo ""
say "=== Full Log Files ==="
ls -lh "$SUITE_LOG_DIR"/*.log 2>/dev/null | awk '{print "  " $9 " (" $5 ")"}'

echo ""
say "=== Analysis Complete ==="
echo "To view specific suite results:"
echo "  cat $SUITE_LOG_DIR/<suite-name>.log"
echo ""
echo "To view comprehensive verification:"
echo "  cat $SUITE_LOG_DIR/comprehensive-verification.log"
