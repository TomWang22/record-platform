#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p bench_logs/ai-platform bench_logs/observability
LOG=bench_logs/ai-platform/phase-16-soak-gates-run.log
echo "=== Phase 16 soak gates $(date -u +%Y-%m-%dT%H:%M:%SZ) ===" > "$LOG"

FAIL=0
run_gate() {
  local name="$1"
  shift
  echo "" >> "$LOG"
  echo ">>> $name: $*" >> "$LOG"
  if "$@" >> "$LOG" 2>&1; then
    echo "$name=0" >> "$LOG"
    return 0
  else
    echo "$name=$?" >> "$LOG"
    return 1
  fi
}

run_gate pnpm_install pnpm install --frozen-lockfile || FAIL=1
run_gate ai_soak bash scripts/rp-ai-soak-monitor.sh || FAIL=1
run_gate event_lag bash scripts/rp-event-lag-monitor.sh || FAIL=1
run_gate event_matrix bash scripts/rp-platform-event-e2e-matrix.sh || FAIL=1
run_gate kafka bash scripts/audit-rp-kafka-producer-consumer-contract.sh || FAIL=1
run_gate grpc bash scripts/rp-bootstrap-grpc-mtls-gate.sh || FAIL=1
run_gate h2h3 bash scripts/smoke-rp-edge-h2-h3-strict-tls.sh || FAIL=1
run_gate mtls_smoke bash scripts/smoke-rp-mtls-real.sh || FAIL=1
run_gate redis bash scripts/audit-rp-redis-lua-runtime-contract.sh || FAIL=1
run_gate outbox bash scripts/audit-rp-event-outbox-contract.sh || FAIL=1
run_gate runtime_comb bash scripts/rp-runtime-domain-comb.sh || FAIL=1
run_gate db_comb bash scripts/rp-db-domain-comb.sh || FAIL=1
run_gate och bash scripts/rp-och-decontaminate-scan.sh || FAIL=1
run_gate cluster_doctor env CLUSTER_DOCTOR_STRICT=1 make cluster-doctor || FAIL=1

echo "" >> "$LOG"
echo ">>> playwright: full suite" >> "$LOG"
if (cd webapp && CONTRACT_SCREENSHOT_DATE="$(date -u +%F)" \
  E2E_API_BASE=https://record-platform.test \
  NODE_EXTRA_CA_CERTS=../certs/dev-root.pem \
  pnpm exec playwright test --workers=1 --retries=0 --timeout=180000) >> "$LOG" 2>&1; then
  echo "playwright=0" >> "$LOG"
else
  echo "playwright=$?" >> "$LOG"
  FAIL=1
fi

run_gate screenshot_strict env CONTRACT_ONLY=1 make rp-frontend-screenshot-strict-contract || FAIL=1

echo "FAIL_TOTAL=$FAIL" >> "$LOG"
exit "$FAIL"
