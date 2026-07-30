#!/usr/bin/env bash
# GATE-FINAL-2: run runtime/security bundle and record exit codes.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p bench_logs/frontend-contract
LOG="$ROOT/bench_logs/frontend-contract/gate-final-2-run.log"
REPORT="$ROOT/bench_logs/frontend-contract/pre-phase-9-runtime-security-bundle.md"
: >"$LOG"

scripts=(
  scripts/rp-bootstrap-grpc-mtls-gate.sh
  scripts/smoke-rp-edge-h2-h3-strict-tls.sh
  scripts/smoke-rp-mtls-real.sh
  scripts/audit-rp-redis-lua-runtime-contract.sh
  scripts/audit-rp-event-outbox-contract.sh
  scripts/verify-kafka-ready.sh
  scripts/rp-verify-kafka-cert-chain.sh
  scripts/rp-runtime-domain-comb.sh
  scripts/rp-db-domain-comb.sh
  scripts/rp-rp-decontaminate-scan.sh
)

declare -a codes=()
all_ok=1
{
  echo "# Pre-Phase 9 runtime/security bundle"
  echo ""
  echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo ""
  echo "| script | exit |"
  echo "|--------|------|"
} >"$REPORT"

for s in "${scripts[@]}"; do
  echo "=== $s ===" | tee -a "$LOG"
  set +e
  bash "$s" >>"$LOG" 2>&1
  ec=$?
  set -e
  codes+=("$ec")
  echo "EXIT:$ec $s" | tee -a "$LOG"
  echo "| \`$s\` | $ec |" >>"$REPORT"
  if [[ "$ec" -ne 0 ]]; then all_ok=0; fi
done

{
  echo ""
  if [[ "$all_ok" -eq 1 ]]; then
    echo "**GATE-FINAL-2: PASS** (all exit 0)"
  else
    echo "**GATE-FINAL-2: FAIL** — see \`bench_logs/frontend-contract/gate-final-2-run.log\`"
  fi
} >>"$REPORT"

echo "SUMMARY all_ok=$all_ok codes=${codes[*]}"
exit "$((all_ok ? 0 : 1))"
