#!/usr/bin/env bash
# Canonical T14.4 production readiness smoke bundle (excludes Playwright + screenshot strict).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPORT_DIR="${REPORT_DIR:-$REPO_ROOT/bench_logs/release-contract}"
REPORT="${REPORT:-$REPORT_DIR/t14-production-readiness-smoke.md}"
FAIL=0

mkdir -p "$REPORT_DIR"
cd "$REPO_ROOT"

run_gate() {
  local name="$1"
  shift
  echo "=== $name ==="
  local log="/tmp/t14-bundle-${name}.log"
  if "$@" >"$log" 2>&1; then
    echo "PASS $name" | tee -a "$REPORT.tmp"
    return 0
  fi
  echo "FAIL $name" | tee -a "$REPORT.tmp" >&2
  tail -20 "$log" >>"$REPORT.tmp" 2>/dev/null || true
  FAIL=1
  return 1
}

{
  echo "# T14.4 production readiness smoke"
  echo ""
  echo "Started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Release SHA: \`$(git rev-parse HEAD)\`"
  echo ""
  echo "## Gate results"
  echo ""
} >"$REPORT.tmp"

run_gate pnpm pnpm install --frozen-lockfile || true
run_gate hygiene bash scripts/rp-repo-hygiene-contract.sh || true
run_gate image-freshness bash scripts/rp-release-image-freshness.sh || true
run_gate runtime bash scripts/rp-runtime-domain-comb.sh || true
run_gate db bash scripts/rp-db-domain-comb.sh || true
run_gate messaging bash scripts/rp-messaging-domain-comb.sh || true
run_gate och bash scripts/rp-och-decontaminate-scan.sh || true
run_gate grpc bash scripts/rp-bootstrap-grpc-mtls-gate.sh || true
run_gate edge bash scripts/smoke-rp-edge-h2-h3-strict-tls.sh || true
run_gate mtls bash scripts/smoke-rp-mtls-real.sh || true
run_gate redis bash scripts/audit-rp-redis-lua-runtime-contract.sh || true
run_gate outbox bash scripts/audit-rp-event-outbox-contract.sh || true
run_gate kafka bash scripts/verify-kafka-ready.sh || true
run_gate kafka-cert bash scripts/rp-verify-kafka-cert-chain.sh || true
run_gate cluster-doctor env CLUSTER_DOCTOR_STRICT=1 make cluster-doctor || true

{
  echo ""
  echo "Finished: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo ""
  if [[ "$FAIL" -eq 0 ]]; then
    echo "**Bundle status: PASS** (pre-Playwright gates)"
  else
    echo "**Bundle status: FAIL** (see gate lines above)"
  fi
} >>"$REPORT.tmp"

mv "$REPORT.tmp" "$REPORT"
if [[ "$FAIL" -eq 0 ]]; then
  echo "rp-release-prod-readiness-bundle PASS — $REPORT"
  exit 0
fi
echo "rp-release-prod-readiness-bundle FAIL — $REPORT" >&2
exit 1
