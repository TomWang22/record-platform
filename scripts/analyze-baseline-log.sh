#!/usr/bin/env bash
# Analyze baseline log for pass/fail summary and regression comparison.
# Usage: ./scripts/analyze-baseline-log.sh /tmp/baseline-run-*.log [reference-log]
# With 2 args: compare current vs reference (best run).

set -euo pipefail

LOG="${1:?usage: $0 <baseline-log> [reference-log]}"
REF="${2:-}"

echo "=== Baseline Log Analysis ==="
echo "Log: $LOG"
[[ -n "$REF" ]] && echo "Reference (best run): $REF"
echo ""

echo "--- Suite Results ---"
grep -E "^(✅|⚠️).*: (PASSED|FAILED)" "$LOG" 2>/dev/null || grep -E "(baseline|enhanced|adversarial|rotation|standalone|tls-mtls|social):.*(PASSED|FAILED)" "$LOG" 2>/dev/null || true

echo ""
echo "--- Failures / Warnings ---"
grep -iE "FAILED|failed|error|❌|⚠️.*failed" "$LOG" 2>/dev/null | head -30

echo ""
echo "--- Key Metrics (k6 if present) ---"
grep -E "Total Requests|H2:.*Failures|H3:.*Failures|Real req/s|Combined successful" "$LOG" 2>/dev/null || true

if [[ -n "$REF" ]] && [[ -f "$REF" ]]; then
  echo ""
  echo "=== Regression vs Reference ==="
  echo "Current: $(grep -cE '^✅' "$LOG" 2>/dev/null || echo 0) pass, $(grep -cE '^⚠️.*FAILED' "$LOG" 2>/dev/null || echo 0) fail"
  echo "Reference: $(grep -cE '^✅' "$REF" 2>/dev/null || echo 0) pass, $(grep -cE '^⚠️.*FAILED' "$REF" 2>/dev/null || echo 0) fail"
fi
