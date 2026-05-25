#!/usr/bin/env bash
# Static parity: RP make preflight-lab vs OCH toolkit preflight-strict recipe (ordering + env exports).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
_fail=0
_bump() { echo "❌ $*" >&2; _fail=1; }

MK="$ROOT/Makefile"
PKG="$ROOT/package.json"
CB="$ROOT/scripts/run-housing-k6-edge-smoke.sh"
PF="$ROOT/scripts/run-preflight-scale-and-all-suites.sh"
VI2="$ROOT/scripts/coverage/run-phase-vi2-matrix-verify.sh"

for token in \
  cluster-stability-guard.sh \
  transport-quic-v6-v7-prove \
  PREFLIGHT_LAB=1 \
  PREFLIGHT_SKIP_KAFKA_ALIGNMENT_SUITE=0 \
  KAFKA_ALIGNMENT_TEST_MODE=1 \
  PREFLIGHT_RUN_REPO_VITEST_STACK=1 \
  PREFLIGHT_RUN_CLUSTER_STABILITY_GUARD=1 \
  PREFLIGHT_ENSURE_METRICS_SERVER=1 \
  PREFLIGHT_STEP7_OBSERVABILITY_GATES=1 \
  preflight-and-suites; do
  grep -q "$token" "$MK" || _bump "Makefile preflight-strict missing: $token"
done

grep -q 'preflight-lab: preflight-strict' "$MK" || _bump 'preflight-lab must alias preflight-strict'
grep -q 'ensure-node20' "$MK" || _bump 'Makefile missing ensure-node20'
grep -q 'kafka-alignment-suite' "$PF" || _bump 'run-preflight missing kafka-alignment-suite step'
grep -q 'PREFLIGHT_LAB' "$PF" || _bump 'run-preflight lab profile must set PREFLIGHT_LAB'
grep -q 'k6-preflight-lab-randomized-all-endpoints' "$CB" || _bump 'run-housing-k6 missing preflight-lab randomized k6'
grep -q 'transport-quic-v6-v7-prove' "$MK" || _bump 'Makefile must run transport-quic-v6-v7-prove before preflight-and-suites'
grep -q 'coverage:phase-vi2-verify' "$PKG" || _bump 'package.json missing coverage:phase-vi2-verify'
grep -q 'coverage:report' "$PKG" || _bump 'package.json missing coverage:report'
grep -q 'preflight:lab-report' "$PKG" || _bump 'package.json missing preflight:lab-report'
grep -q 'test:vitest-stack' "$PKG" || _bump 'package.json missing test:vitest-stack'
grep -qE '^observe:' "$MK" || _bump 'Makefile missing observe target'
grep -q 'fetch-gateway-route-hits' "$MK" || _bump 'Makefile missing fetch-gateway-route-hits'
grep -q 'RP_PUBLIC_ORIGIN' "$VI2" || _bump 'run-phase-vi2-matrix-verify must use RP_PUBLIC_ORIGIN'
grep -q 'record\.test' "$VI2" && _bump 'run-phase-vi2-matrix-verify must not use legacy record.test hostname'
grep -q 'record-platform\.test' "$VI2" || _bump 'run-phase-vi2-matrix-verify should reference record-platform.test via RP contract'

# Ordering: cluster-stability before transport-quic before preflight-and-suites
_cs="$(grep -n 'cluster-stability-guard' "$MK" | head -1 | cut -d: -f1)"
_tq="$(grep -n 'transport-quic-v6-v7-prove' "$MK" | head -1 | cut -d: -f1)"
_ps="$(grep -n 'preflight-and-suites' "$MK" | head -1 | cut -d: -f1)"
if [[ -n "$_cs" && -n "$_tq" && -n "$_ps" ]]; then
  if [[ "$_cs" -ge "$_tq" ]] || [[ "$_tq" -ge "$_ps" ]]; then
    _bump "Makefile order wrong: stability@$_cs quic@$_tq suites@$_ps (want stability < quic < suites)"
  fi
fi

if [[ $_fail -ne 0 ]]; then
  exit 1
fi
echo "✅ preflight-lab Makefile/script parity checks passed"
