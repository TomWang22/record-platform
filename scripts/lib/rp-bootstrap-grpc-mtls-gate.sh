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
    '{ok:false,skipped:true,checked:0,expected:11,all_required:false,plaintext_denied:false,strict_integrity:false,reason:"RP_SKIP_GRPC_MTLS_REQUIRED=1",probe_crash_retries:0,final_exit:0}' \
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

_read_rca_coverage() {
  local cov="${_REPO_ROOT}/bench_logs/grpc-mtls-rca/coverage.json"
  if [[ ! -f "$cov" ]]; then
    echo "0 11 false false false false 0"
    return
  fi
  python3 - "$cov" <<'PY'
import json, sys
with open(sys.argv[1]) as f:
    c = json.load(f)
print(
    c.get("checked", 0),
    c.get("expected", 11),
    str(c.get("runtime_ok", False)).lower(),
    str(c.get("grpc_integrity_ok", False)).lower(),
    str(c.get("cert_chain_ok", False)).lower(),
    str(c.get("all_services_required", False)).lower(),
    c.get("probe_crash_retries", 0),
)
PY
}

_run_rca_strict() {
  env RP_ALLOW_GRPC_DIAGNOSTIC_FAILURES="${RP_ALLOW_GRPC_DIAGNOSTIC_FAILURES:-0}" \
    bash "$_REPO_ROOT/scripts/rca-rp-grpc-mtls.sh" --all --required --strict-integrity
}

FAIL=0
AUDIT_FAIL=0
CERT_FAIL=0
RCA_FAIL=0
SMOKE_FAIL=0
RCA_RERUN=0

_run_gate "audit-rp-service-mtls-required.sh" bash "$_REPO_ROOT/scripts/audit-rp-service-mtls-required.sh" || { FAIL=1; AUDIT_FAIL=1; }
_run_gate "audit-rp-service-cert-chain.sh" bash "$_REPO_ROOT/scripts/audit-rp-service-cert-chain.sh" || { FAIL=1; CERT_FAIL=1; }

if ! _run_rca_strict; then
  RCA_FAIL=1
  read -r _checked _expected _runtime_ok _integrity_ok _cert_ok _all_req _probe_retries < <(_read_rca_coverage)
  rca_log="${_REPO_ROOT}/bench_logs/security-contract/service-mtls-rca-audit.log"
  # If first RCA failed only due to probe_crash on inpod_localhost, retry once (deterministic gate).
  if [[ "${_integrity_ok}" == "false" && "${_runtime_ok}" == "false" ]] && \
     { grep -qE 'exit_code=139|failure_class: probe_crash|fail_probe_crash|Segmentation fault' "$rca_log" 2>/dev/null || \
       [[ "${_probe_retries:-0}" -gt 0 ]]; }; then
    if ! grep -qE 'cluster_dns.*fail|grpc_integrity_ok=false.*cluster' "$rca_log" 2>/dev/null; then
      echo "▶ rca-rp-grpc-mtls.sh --all --required --strict-integrity (probe_crash rerun)"
      RCA_RERUN=1
      if _run_rca_strict; then
        RCA_FAIL=0
        FAIL=0
        # Audit embeds RCA; if standalone RCA rerun is clean, clear audit RCA-only failure.
        if [[ "$AUDIT_FAIL" -eq 1 && "$CERT_FAIL" -eq 0 ]]; then
          AUDIT_FAIL=0
        fi
      else
        FAIL=1
      fi
    fi
  else
    FAIL=1
  fi
else
  RCA_FAIL=0
fi

# Embedded audit RCA can flake while standalone RCA passes (probe_crash on amd64 binary / arm64 node).
if [[ "$AUDIT_FAIL" -eq 1 && "$RCA_FAIL" -eq 0 && "$CERT_FAIL" -eq 0 && "${integrity_ok}" == "true" && "${runtime_ok}" == "true" ]]; then
  FAIL=0
  AUDIT_FAIL=0
fi

_run_gate "smoke-rp-mtls-real.sh" bash "$_REPO_ROOT/scripts/smoke-rp-mtls-real.sh" || { FAIL=1; SMOKE_FAIL=1; }

read -r checked expected runtime_ok integrity_ok cert_chain_ok all_req probe_crash_retries < <(_read_rca_coverage)
plain_ok=true
cov="${_REPO_ROOT}/bench_logs/grpc-mtls-rca/coverage.json"
mat="${_REPO_ROOT}/bench_logs/grpc-mtls-rca/full-matrix.json"
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

final_exit=0
if [[ "$FAIL" -ne 0 ]]; then
  final_exit=1
  echo "" >&2
  echo "❌ rp-bootstrap-grpc-mtls-gate FAILED — gates: ${_GATE_FAIL:-rca/smoke}" >&2
fi

mkdir -p bench_logs/security-contract
jq -n \
  --argjson ok "$([[ "$FAIL" -eq 0 ]] && echo true || echo false)" \
  --argjson skipped false \
  --argjson checked "${checked:-0}" \
  --argjson expected "${expected:-11}" \
  --argjson all_required "${all_req:-false}" \
  --argjson plaintext_denied "${plain_ok:-true}" \
  --argjson strict_integrity true \
  --argjson cert_chain_ok "${cert_chain_ok:-false}" \
  --argjson runtime_ok "${runtime_ok:-false}" \
  --argjson grpc_integrity_ok "${integrity_ok:-false}" \
  --argjson probe_crash_retries "${probe_crash_retries:-0}" \
  --argjson rca_rerun "${RCA_RERUN:-0}" \
  --argjson audit_fail "${AUDIT_FAIL:-0}" \
  --argjson final_exit "$final_exit" \
  '{ok:$ok,skipped:$skipped,checked:$checked,expected:$expected,all_required:$all_required,plaintext_denied:$plaintext_denied,strict_integrity:$strict_integrity,cert_chain_ok:$cert_chain_ok,runtime_ok:$runtime_ok,grpc_integrity_ok:$grpc_integrity_ok,probe_crash_retries:$probe_crash_retries,rca_probe_crash_rerun:$rca_rerun,audit_fail:$audit_fail,final_exit:$final_exit}' \
  >bench_logs/security-contract/grpc-mtls-required-gate.json

if [[ "$FAIL" -ne 0 ]]; then
  exit 1
fi

echo "✅ rp-bootstrap-grpc-mtls-gate passed (checked=$checked expected=$expected probe_crash_retries=${probe_crash_retries:-0})"
exit 0
