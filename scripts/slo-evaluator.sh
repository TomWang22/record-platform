#!/usr/bin/env bash
# Evaluate platform SLOs from k6 summary JSON (e.g. from run-k6-chaos.sh collect or handleSummary).
# Writes one line to bench_logs/error-budget.txt per run when K6_JSON is provided.
# Usage: ./scripts/slo-evaluator.sh [path/to/k6-summary.json]
#   Or: K6_JSON=bench_logs/latest/k6-summary.json ./scripts/slo-evaluator.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

K6_JSON="${1:-${K6_JSON:-}}"
ERROR_BUDGET_FILE="${ERROR_BUDGET_FILE:-$REPO_ROOT/bench_logs/error-budget.txt}"
# SLO targets (availability = 1 - failure_rate; latency ms)
SLO_AVAILABILITY_MIN="${SLO_AVAILABILITY_MIN:-0.999}"   # 99.9%
SLO_P95_MS="${SLO_P95_MS:-200}"
SLO_P99_MS="${SLO_P99_MS:-350}"

section() { printf "\n\033[1m%s\033[0m\n" "$*"; }
pass() { echo "✅ $*"; }
fail() { echo "❌ $*"; exit 1; }
info() { echo "ℹ️  $*"; }

section "Evaluating SLOs..."

if [[ -z "$K6_JSON" ]] || [[ ! -f "$K6_JSON" ]]; then
  info "No k6 summary JSON (set K6_JSON or pass path). Creating error-budget file and exiting."
  mkdir -p "$(dirname "$ERROR_BUDGET_FILE")" 2>/dev/null || true
  touch "$ERROR_BUDGET_FILE"
  exit 0
fi

if ! command -v jq >/dev/null 2>&1; then
  fail "jq required for SLO evaluation. Install jq or provide pre-parsed metrics."
fi

# Parse k6 output (handleSummary format or standard k6 JSON summary)
AVAILABILITY="1"
P95="0"
P99="0"
if jq -e '.metrics.http_req_failed' "$K6_JSON" >/dev/null 2>&1; then
  FAIL_RATE=$(jq -r '.metrics.http_req_failed.rate // 0' "$K6_JSON")
  AVAILABILITY=$(awk "BEGIN { printf \"%.6f\", 1 - $FAIL_RATE }")
fi
if jq -e '.metrics.http_req_duration' "$K6_JSON" >/dev/null 2>&1; then
  P95=$(jq -r '.metrics.http_req_duration["p(95)"] // .metrics.http_req_duration["p95"] // 0' "$K6_JSON" 2>/dev/null || echo "0")
  P99=$(jq -r '.metrics.http_req_duration["p(99)"] // .metrics.http_req_duration["p99"] // 0' "$K6_JSON" 2>/dev/null || echo "0")
fi
# Convert s to ms if needed
if [[ -n "$P95" ]] && [[ "$P95" != "null" ]]; then
  echo "$P95" | grep -qE '^[0-9]+\.?[0-9]*$' || true
  P95_MS=$(awk "BEGIN { v=$P95; if (v < 1) v=v*1000; printf \"%.0f\", v }")
else
  P95_MS="0"
fi
if [[ -n "$P99" ]] && [[ "$P99" != "null" ]]; then
  P99_MS=$(awk "BEGIN { v=$P99; if (v < 1) v=v*1000; printf \"%.0f\", v }")
else
  P99_MS="0"
fi

echo "Availability (1 - failure_rate): $AVAILABILITY"
echo "p95 latency (ms): $P95_MS"
echo "p99 latency (ms): $P99_MS"

SLO_STATUS="OK"
if awk "BEGIN { exit !($AVAILABILITY < $SLO_AVAILABILITY_MIN) }" 2>/dev/null; then
  echo "❌ Availability SLO breached (target >= $SLO_AVAILABILITY_MIN, got $AVAILABILITY)"
  SLO_STATUS="BREACH"
fi
if [[ "${P95_MS:-0}" -gt "${SLO_P95_MS:-200}" ]] 2>/dev/null; then
  echo "❌ Latency SLO breached (p95 target <= ${SLO_P95_MS}ms, got ${P95_MS}ms)"
  SLO_STATUS="BREACH"
fi
if [[ "${P99_MS:-0}" -gt "${SLO_P99_MS:-350}" ]] 2>/dev/null; then
  echo "❌ Latency SLO breached (p99 target <= ${SLO_P99_MS}ms, got ${P99_MS}ms)"
  SLO_STATUS="BREACH"
fi

# Error budget tracking
mkdir -p "$(dirname "$ERROR_BUDGET_FILE")" 2>/dev/null || true
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ),$AVAILABILITY,$P95_MS,$P99_MS,$SLO_STATUS" >> "$ERROR_BUDGET_FILE"
info "Appended to $ERROR_BUDGET_FILE"

if [[ "$SLO_STATUS" == "OK" ]]; then
  pass "All SLOs satisfied"
  exit 0
else
  fail "One or more SLOs breached"
fi
