#!/usr/bin/env bash
# CERT-CHAIN-1: verify 3-stage (leaf + intermediate + CA trust) mounted mTLS certs for all gRPC services.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib/rp-runtime-health-contract.sh
source "$SCRIPT_DIR/lib/rp-runtime-health-contract.sh"
# shellcheck source=lib/rp-service-cert-contract.sh
source "$SCRIPT_DIR/lib/rp-service-cert-contract.sh"
# shellcheck source=lib/rp-cert-chain-verify.sh
source "$SCRIPT_DIR/lib/rp-cert-chain-verify.sh"

NS="${HOUSING_NS:-record-platform}"
OUT="${REPORT_DIR:-$REPO_ROOT/bench_logs/security-contract}"
REPORT="$OUT/service-cert-chain-contract.md"
FAIL=0
PASS=0
EXPECTED=11

GRPC_SERVICES=(
  auth-service records-service shopping-service auction-monitor listings-service
  messaging-service notification-service trust-service analytics-service media-service python-ai-service
)

mkdir -p "$OUT"
: >"$REPORT"

_log() { echo "$*" | tee -a "$REPORT"; }
_fail() { FAIL=1; _log "❌ $*"; }
_pass() { PASS=$((PASS + 1)); _log "✅ $*"; }

_log "# RP service cert chain contract audit"
_log ""
_log "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
_log "Namespace: $NS"
_log ""
_log "| service | secret | chain_parts | leaf_subject | issuer | san_ok | verify_ok | fingerprint_match | expires | status |"
_log "|---------|--------|-------------|--------------|--------|--------|-----------|-------------------|---------|--------|"

for svc in "${GRPC_SERVICES[@]}"; do
  json="$(rp_runtime_health_service_json "$svc" 2>/dev/null || true)"
  dep="$(jq -r '.k8sName // .deployment // empty' <<<"$json")"
  [[ -n "$dep" ]] || dep="$svc"
  secret="$(rp_cert_contract_per_service_secret_name "$svc")"

  if ! kubectl get deploy "$dep" -n "$NS" >/dev/null 2>&1; then
    _fail "$svc: deployment $dep missing"
    _log "| $svc | $secret | — | — | — | no | no | no | — | **FAIL** |"
    continue
  fi

  result="$(rp_cert_chain_verify_mounted "$svc" "$dep" 2>/dev/null || echo '{"ok":false}')"
  secret_fp="$(rp_cert_chain_secret_fingerprint "$secret")"
  mounted_fp="$(echo "$result" | jq -r '.fingerprint_sha256 // ""')"
  fp_match="no"
  if [[ -n "$mounted_fp" && -n "$secret_fp" && "$mounted_fp" == "$secret_fp" ]]; then
    fp_match="yes"
  fi

  ok="$(echo "$result" | jq -r '.ok')"
  chain_parts="$(echo "$result" | jq -r '.chain_parts')"
  subject="$(echo "$result" | jq -r '.leaf_subject' | tr '|' '/')"
  issuer="$(echo "$result" | jq -r '.issuer' | tr '|' '/')"
  san_ok="$(echo "$result" | jq -r '.san_ok')"
  verify_ok="$(echo "$result" | jq -r '.verify_ok')"
  expires_ok="$(echo "$result" | jq -r '.expires_ok')"
  status="PASS"
  if [[ "$ok" != "true" ]]; then
    status="FAIL"
    FAIL=1
    _fail "$svc: cert chain verify failed ($(echo "$result" | jq -r '.verify_out // .error // "see report"'))"
  else
    _pass "$svc: chain ok (parts=$chain_parts fp_match=$fp_match)"
  fi

  _log "| $svc | $secret | $chain_parts | ${subject:0:40} | ${issuer:0:40} | $san_ok | $verify_ok | $fp_match | $expires_ok | **$status** |"
  _log ""
  _log "**$svc** serial=$(echo "$result" | jq -r '.serial // "—"') notBefore=$(echo "$result" | jq -r '.not_before // "—"') notAfter=$(echo "$result" | jq -r '.not_after // "—"')"
  _log "- leaf SHA256: $(echo "$result" | jq -r '.fingerprint_sha256 // "—"')"
  _log "- SAN: $(echo "$result" | jq -r '.san_list | join(", ")' 2>/dev/null || echo "—")"
  _log "- hostname verify: $(echo "$result" | jq -r '.hostname_ok') ($(echo "$result" | jq -r '.hostname // ""'))"
  _log "- verify: $(echo "$result" | jq -r '.verify_out // "—"')"
  _log ""
done

_log ""
_log "## Summary"
_log "- expected: $EXPECTED"
_log "- pass: $PASS"
_log "- failures: $FAIL"

if [[ "$FAIL" -ne 0 ]]; then
  _log ""
  _log "**RESULT: FAIL**"
  exit 1
fi
_log ""
_log "**RESULT: PASS** (11/11 cert chains verified, no record.local)"
exit 0
