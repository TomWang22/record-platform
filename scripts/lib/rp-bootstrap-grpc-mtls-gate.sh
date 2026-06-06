#!/usr/bin/env bash
# BOOT-MTLS-1: strict gRPC mTLS RCA gate (audit + rca + smoke). Skip only RP_SKIP_GRPC_MTLS_REQUIRED=1.
set -euo pipefail

_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_REPO_ROOT="$(cd "$_SCRIPT_DIR/../.." && pwd)"
cd "$_REPO_ROOT"

if [[ "${RP_SKIP_GRPC_MTLS_REQUIRED:-0}" == "1" ]]; then
  echo "⚠️  RP_SKIP_GRPC_MTLS_REQUIRED=1 — skipping gRPC mTLS required gate (local dev only)" >&2
  mkdir -p bench_logs/security-contract
  jq -n \
    --argjson skipped true \
    '{ok:false,skipped:true,checked:0,expected:11,all_required:false,plaintext_denied:false,strict_integrity:false,reason:"RP_SKIP_GRPC_MTLS_REQUIRED=1"}' \
    >bench_logs/security-contract/grpc-mtls-required-gate.json
  exit 0
fi

chmod +x \
  "$_REPO_ROOT/scripts/audit-rp-service-mtls-required.sh" \
  "$_REPO_ROOT/scripts/audit-rp-service-cert-chain.sh" \
  "$_REPO_ROOT/scripts/rca-rp-grpc-mtls.sh" \
  "$_REPO_ROOT/scripts/smoke-rp-mtls-real.sh" 2>/dev/null || true

_GATE_FAIL=""
_run_gate() {
  local label="$1"
  shift
  echo "▶ $label"
  if ! "$@"; then
    _GATE_FAIL="${_GATE_FAIL}${_GATE_FAIL:+, }$label"
    return 1
  fi
  return 0
}

FAIL=0
_run_gate "audit-rp-service-mtls-required.sh" bash "$_REPO_ROOT/scripts/audit-rp-service-mtls-required.sh" || FAIL=1
_run_gate "audit-rp-service-cert-chain.sh" bash "$_REPO_ROOT/scripts/audit-rp-service-cert-chain.sh" || FAIL=1

_run_gate "rca-rp-grpc-mtls.sh --all --required --strict-integrity" \
  env RP_ALLOW_GRPC_DIAGNOSTIC_FAILURES="${RP_ALLOW_GRPC_DIAGNOSTIC_FAILURES:-0}" \
  bash "$_REPO_ROOT/scripts/rca-rp-grpc-mtls.sh" --all --required --strict-integrity || FAIL=1

_run_gate "smoke-rp-mtls-real.sh" bash "$_REPO_ROOT/scripts/smoke-rp-mtls-real.sh" || FAIL=1

if [[ "$FAIL" -ne 0 ]]; then
  echo "" >&2
  echo "❌ rp-bootstrap-grpc-mtls-gate FAILED — gates: ${_GATE_FAIL:-unknown}" >&2
  exit 1
fi

cov="${_REPO_ROOT}/bench_logs/grpc-mtls-rca/coverage.json"
mat="${_REPO_ROOT}/bench_logs/grpc-mtls-rca/full-matrix.json"
checked=0 expected=11 all_req=true plain_ok=true
if [[ -f "$cov" ]]; then
  read -r checked expected all_req plain_ok < <(python3 - "$cov" "$mat" <<'PY'
import json, sys
cov_path, mat_path = sys.argv[1], sys.argv[2]
with open(cov_path) as f:
    cov = json.load(f)
checked = cov.get("checked", 0)
expected = cov.get("expected", 11)
all_req = cov.get("all_services_required", False)
plain_ok = cov.get("plaintext_denied_all", False)
if not all_req and mat_path:
    try:
        with open(mat_path) as f:
            mat = json.load(f)
        svcs = mat.get("services") or []
        all_req = all(s.get("required") is True for s in svcs if not s.get("skip_reason"))
        plain_ok = all(s.get("plaintext_denied") is not False for s in svcs if not s.get("skip_reason"))
    except Exception:
        pass
print(checked, expected, str(all_req).lower(), str(plain_ok).lower())
PY
)
fi

mkdir -p bench_logs/security-contract
jq -n \
  --argjson ok true \
  --argjson skipped false \
  --argjson checked "${checked:-0}" \
  --argjson expected "${expected:-11}" \
  --argjson all_required "${all_req:-false}" \
  --argjson plaintext_denied "${plain_ok:-true}" \
  --argjson strict_integrity true \
  --argjson cert_chain_ok true \
  '{ok:$ok,skipped:$skipped,checked:$checked,expected:$expected,all_required:$all_required,plaintext_denied:$plaintext_denied,strict_integrity:$strict_integrity,cert_chain_ok:$cert_chain_ok}' \
  >bench_logs/security-contract/grpc-mtls-required-gate.json

echo "✅ rp-bootstrap-grpc-mtls-gate passed (checked=$checked expected=$expected)"
exit 0
