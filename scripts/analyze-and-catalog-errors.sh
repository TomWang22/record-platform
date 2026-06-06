#!/usr/bin/env bash
# Analyze baseline log and catalog all errors for systematic fixing
# Usage: ./scripts/analyze-and-catalog-errors.sh <baseline-log>

set -euo pipefail

LOG="${1:?Usage: $0 <baseline-log>}"
OUTPUT="/tmp/error-catalog-$(date +%Y%m%d-%H%M%S).md"

echo "📋 Analyzing: $LOG"
echo "📝 Output: $OUTPUT"

cat > "$OUTPUT" <<'HEADER'
# Error Catalog and Fix Plan

**Generated:** $(date -Iseconds)
**Baseline Log:** LOG_PLACEHOLDER

## Summary

HEADER

# Replace placeholder
sed -i.bak "s|LOG_PLACEHOLDER|$LOG|g" "$OUTPUT" 2>/dev/null || sed -i '' "s|LOG_PLACEHOLDER|$LOG|g" "$OUTPUT"

# Count test results
TOTAL_PASS=$(grep -c "^✅" "$LOG" 2>/dev/null || echo 0)
TOTAL_WARN=$(grep -c "^⚠️.*FAILED\|^⚠️.*failed" "$LOG" 2>/dev/null || echo 0)
TOTAL_FAIL=$(grep -c "^❌" "$LOG" 2>/dev/null || echo 0)

cat >> "$OUTPUT" <<EOF

- **Passed:** $TOTAL_PASS
- **Warnings/Failed:** $TOTAL_WARN
- **Critical Failures:** $TOTAL_FAIL

---

## 1. Suite Results

EOF

# Extract suite results
echo "### Test Suite Status" >> "$OUTPUT"
echo "" >> "$OUTPUT"
grep -E "(baseline|enhanced|adversarial|rotation|standalone|tls-mtls|social):.*(PASSED|FAILED)" "$LOG" 2>/dev/null | while read -r line; do
  echo "- $line" >> "$OUTPUT"
done || echo "- (No suite results found yet)" >> "$OUTPUT"

echo "" >> "$OUTPUT"
echo "---" >> "$OUTPUT"
echo "" >> "$OUTPUT"

# Catalog errors by category
echo "## 2. Error Categories" >> "$OUTPUT"
echo "" >> "$OUTPUT"

# gRPC errors
echo "### 2.1 gRPC Health Check Failures (Colima port-forward)" >> "$OUTPUT"
echo "" >> "$OUTPUT"
GRPC_ERRORS=$(grep -c "gRPC.*HealthCheck.*failed\|Port-forward failed" "$LOG" 2>/dev/null || echo 0)
if [[ $GRPC_ERRORS -gt 0 ]]; then
  echo "**Count:** $GRPC_ERRORS" >> "$OUTPUT"
  echo "" >> "$OUTPUT"
  echo "**Root Cause:** Colima VM limitations - direct gRPC port-forward with strict TLS/mTLS times out (25s cap)." >> "$OUTPUT"
  echo "" >> "$OUTPUT"
  echo "**Status:** Expected on Colima. gRPC via Envoy proxy works (HTTP/2). Direct pod access requires NodePort or Kind." >> "$OUTPUT"
  echo "" >> "$OUTPUT"
  echo "**Fix Priority:** LOW (known limitation, Envoy proxy works)" >> "$OUTPUT"
else
  echo "No gRPC errors found." >> "$OUTPUT"
fi
echo "" >> "$OUTPUT"

# HTTP errors
echo "### 2.2 HTTP/REST Failures" >> "$OUTPUT"
echo "" >> "$OUTPUT"
HTTP_ERRORS=$(grep -E "HTTP [45][0-9]{2}|curl.*failed|Connection refused" "$LOG" 2>/dev/null | grep -v "401 on protected endpoint" | head -20)
if [[ -n "$HTTP_ERRORS" ]]; then
  echo '```' >> "$OUTPUT"
  echo "$HTTP_ERRORS" >> "$OUTPUT"
  echo '```' >> "$OUTPUT"
else
  echo "No HTTP errors found." >> "$OUTPUT"
fi
echo "" >> "$OUTPUT"

# DB errors
echo "### 2.3 Database Errors" >> "$OUTPUT"
echo "" >> "$OUTPUT"
DB_ERRORS=$(grep -iE "database.*error|postgres.*error|connection.*database.*failed|ECONNREFUSED.*543[3-9]" "$LOG" 2>/dev/null | head -10)
if [[ -n "$DB_ERRORS" ]]; then
  echo '```' >> "$OUTPUT"
  echo "$DB_ERRORS" >> "$OUTPUT"
  echo '```' >> "$OUTPUT"
else
  echo "No database errors found." >> "$OUTPUT"
fi
echo "" >> "$OUTPUT"

# TLS/cert errors
echo "### 2.4 TLS/Certificate Errors" >> "$OUTPUT"
echo "" >> "$OUTPUT"
TLS_ERRORS=$(grep -iE "certificate.*error|TLS.*failed|SSL.*error|curl.*60" "$LOG" 2>/dev/null | head -10)
if [[ -n "$TLS_ERRORS" ]]; then
  echo '```' >> "$OUTPUT"
  echo "$TLS_ERRORS" >> "$OUTPUT"
  echo '```' >> "$OUTPUT"
else
  echo "No TLS errors found." >> "$OUTPUT"
fi
echo "" >> "$OUTPUT"

# Timeout errors
echo "### 2.5 Timeout Errors" >> "$OUTPUT"
echo "" >> "$OUTPUT"
TIMEOUT_ERRORS=$(grep -iE "timeout|timed out|deadline exceeded" "$LOG" 2>/dev/null | head -10)
if [[ -n "$TIMEOUT_ERRORS" ]]; then
  echo '```' >> "$OUTPUT"
  echo "$TIMEOUT_ERRORS" >> "$OUTPUT"
  echo '```' >> "$OUTPUT"
else
  echo "No timeout errors found." >> "$OUTPUT"
fi
echo "" >> "$OUTPUT"

# k6 chaos/load test issues
echo "### 2.6 Load Test Issues (k6 Chaos)" >> "$OUTPUT"
echo "" >> "$OUTPUT"
K6_ISSUES=$(grep -E "dropped.*threshold|chaos.*FAILED|req/s.*below" "$LOG" 2>/dev/null | head -10)
if [[ -n "$K6_ISSUES" ]]; then
  echo '```' >> "$OUTPUT"
  echo "$K6_ISSUES" >> "$OUTPUT"
  echo '```' >> "$OUTPUT"
else
  echo "No k6 load test issues found." >> "$OUTPUT"
fi
echo "" >> "$OUTPUT"

echo "---" >> "$OUTPUT"
echo "" >> "$OUTPUT"

# Action plan
cat >> "$OUTPUT" <<'PLAN'
## 3. Fix Plan (Priority Order)

### Phase 1: Critical Fixes
1. **HTTP/REST failures** - Fix any 4xx/5xx errors that aren't expected (401 on protected endpoints is OK)
2. **Database connectivity** - Ensure all 8 DBs (5433-5440) are accessible
3. **TLS/Certificate issues** - Fix any cert mismatches or CA problems

### Phase 2: Performance & Load
1. **k6 chaos test thresholds** - Analyze dropped iterations, adjust capacity or thresholds
2. **Timeout issues** - Increase timeouts or optimize slow endpoints

### Phase 3: Known Limitations (Document, Don't Fix)
1. **gRPC direct health checks on Colima** - Document as expected (Envoy proxy works)
2. **Port-forward timeouts** - Colima VM limitation, use NodePort or Kind for direct access

---

## 4. Next Steps

1. **Review this catalog** - Identify which errors are critical vs. expected
2. **Fix critical issues** - Address Phase 1 items first
3. **Re-run baseline** - After fixes, run `./scripts/run-baseline-and-log.sh` again
4. **Compare logs** - Use `./scripts/analyze-baseline-log.sh NEW.log OLD.log` for regression
5. **Platform AI integration** - Once baseline is clean, add analytics-service → Python AI pipeline

---

## 5. Analytics Service → Python AI Pipeline (Next Task)

Once baseline errors are resolved:

1. **Update analytics-service** - Add gRPC client for Python AI RPCs (AuctionHeat, SellerBuyerInsight, etc.)
2. **Implement data pipeline** - Stream analytics events to Python AI for intelligence
3. **Test integration** - Comprehensive test suite for analytics → AI flow
4. **Document** - Update ENGINEERING.md and Runbook.md

PLAN

echo ""
echo "✅ Error catalog saved: $OUTPUT"
echo ""
echo "📊 Quick Summary:"
echo "  - Passed: $TOTAL_PASS"
echo "  - Warnings: $TOTAL_WARN"
echo "  - Failures: $TOTAL_FAIL"
echo "  - gRPC issues: $GRPC_ERRORS (expected on Colima)"
echo ""
echo "📖 Review: cat $OUTPUT"
