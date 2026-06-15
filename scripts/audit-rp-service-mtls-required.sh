#!/usr/bin/env bash
# Verify all gRPC runtime services enforce mTLS (contract + cluster + plaintext denied).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib/rp-runtime-health-contract.sh
source "$SCRIPT_DIR/lib/rp-runtime-health-contract.sh"
# shellcheck source=lib/rp-service-cert-contract.sh
source "$SCRIPT_DIR/lib/rp-service-cert-contract.sh"

NS="${K8S_NAMESPACE:-record-platform}"
CERTS="${REPO_ROOT}/certs"
CONTRACT="${RP_SERVICE_RUNTIME_CONTRACT:-$REPO_ROOT/infra/contracts/rp-service-runtime-contract.json}"
OUT="${REPORT_DIR:-$REPO_ROOT/bench_logs/security-contract}"
REPORT="$OUT/service-mtls-required-contract.md"
FAIL=0
PASS=0
TOTAL=0

mkdir -p "$OUT"

_log() { echo "$*" | tee -a "$REPORT"; }
_fail() { FAIL=1; _log "❌ $*"; }
_pass() { PASS=$((PASS + 1)); _log "✅ $*"; }

: >"$REPORT"
_log "# RP gRPC mTLS required contract audit"
_log ""
_log "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
_log "Namespace: $NS"
_log "Contract: $CONTRACT"
_log ""

if ! kubectl get ns "$NS" >/dev/null 2>&1; then
  _fail "namespace $NS not reachable"
  exit 1
fi

# Contract: all certPolicy mtls services must have grpcRequiredForRuntime=true
_log "## Contract (grpcRequiredForRuntime)"
while IFS= read -r svc; do
  [[ -n "$svc" ]] || continue
  TOTAL=$((TOTAL + 1))
  json="$(rp_runtime_health_service_json "$svc")"
  req="$(jq -r '.grpcRequiredForRuntime // false' <<<"$json")"
  port="$(jq -r '.grpcPort // empty' <<<"$json")"
  gsvc="$(jq -r '.grpcService // empty' <<<"$json")"
  policy="$(jq -r '.tlsPolicy // empty' <<<"$json")"
  if [[ "$req" != "true" ]]; then
    if [[ "$policy" == "plaintext" ]]; then
      _pass "$svc: grpcRequiredForRuntime=false expected (policy=$policy)"
    else
      _fail "$svc: grpcRequiredForRuntime=false (policy=$policy port=$port)"
    fi
  else
    _pass "$svc: grpcRequiredForRuntime=true grpc=$gsvc port=$port"
  fi
done < <(rp_cert_contract_mtls_services)

_log ""
_log "## TLS secrets and leaf chain"
PREFIX="$(rp_cert_contract_per_service_secret_prefix)"
while IFS= read -r svc; do
  secret="${PREFIX}${svc}"
  if ! kubectl get secret "$secret" -n "$NS" >/dev/null 2>&1; then
    _fail "$svc: secret $secret missing"
    continue
  fi
  for key in tls.crt tls.key ca.crt; do
    case "$key" in
      tls.crt) jp='{.data.tls\.crt}' ;;
      tls.key) jp='{.data.tls\.key}' ;;
      ca.crt) jp='{.data.ca\.crt}' ;;
    esac
    if ! kubectl get secret "$secret" -n "$NS" -o "jsonpath=$jp" 2>/dev/null | grep -q .; then
      _fail "$svc: secret $secret missing data.$key"
    fi
  done
  tmp="$(mktemp)"
  kubectl get secret "$secret" -n "$NS" -o jsonpath='{.data.tls\.crt}' | base64 -d >"$tmp" 2>/dev/null || true
  if openssl x509 -in "$tmp" -noout -checkend 0 >/dev/null 2>&1; then
    if openssl verify -CAfile "$CERTS/dev-chain.pem" "$tmp" >/dev/null 2>&1; then
      _pass "$svc: leaf verifies against dev-chain.pem"
    else
      _fail "$svc: leaf does not verify against dev-chain.pem"
    fi
    eku="$(openssl x509 -in "$tmp" -noout -ext extendedKeyUsage 2>/dev/null || true)"
    if echo "$eku" | grep -q 'TLS Web Server Authentication' && echo "$eku" | grep -q 'TLS Web Client Authentication'; then
      _pass "$svc: EKU serverAuth + clientAuth"
    else
      _fail "$svc: EKU missing serverAuth/clientAuth ($eku)"
    fi
  else
    _fail "$svc: cannot parse tls.crt from secret"
  fi
  rm -f "$tmp"
done < <(rp_cert_contract_mtls_services)

_log ""
_log "## Deployments (mount + mTLS env)"
while IFS= read -r svc; do
  dep="$(rp_runtime_health_service_json "$svc" | jq -r '.k8sName // .deployment // empty')"
  [[ -n "$dep" ]] || { _fail "$svc: no deployment name in contract"; continue; }
  if ! kubectl get deploy "$dep" -n "$NS" >/dev/null 2>&1; then
    _fail "$svc: deployment $dep not found"
    continue
  fi
  mounts="$(kubectl get deploy "$dep" -n "$NS" -o json | python3 -c "
import json,sys
d=json.load(sys.stdin)
ok=False
for c in d['spec']['template']['spec'].get('containers',[]):
  for vm in c.get('volumeMounts',[]):
    if 'tls' in vm.get('name','').lower() or 'cert' in vm.get('name','').lower():
      ok=True
      print(vm['mountPath'])
if not ok:
  sys.exit(1)
" 2>/dev/null)" || { _fail "$svc: no TLS volumeMount on $dep"; continue; }
  _pass "$svc: TLS mount paths: $(echo "$mounts" | tr '\n' ' ')"

  env_json="$(kubectl get deploy "$dep" -n "$NS" -o json)"
  if echo "$env_json" | grep -qE 'GRPC_TLS|MTLS|TLS_ENABLED|REQUIRE.*TLS'; then
    _pass "$svc: deployment declares TLS/mTLS env"
  else
    _log "⚠️  $svc: no explicit GRPC_TLS env (may use defaults) — checking tlsPolicy in contract"
    pol="$(rp_runtime_health_service_json "$svc" | jq -r '.tlsPolicy')"
    grpc_req="$(rp_runtime_health_service_json "$svc" | jq -r '.grpcRequiredForRuntime // false')"
    if [[ "$grpc_req" != "true" && "$pol" == "plaintext" ]]; then
      _pass "$svc: tlsPolicy=plaintext (no in-cluster gRPC mTLS)"
    elif [[ "$pol" == "service-mtls" ]]; then
      _pass "$svc: tlsPolicy=service-mtls"
    else
      _fail "$svc: tlsPolicy=$pol"
    fi
  fi
done < <(rp_cert_contract_mtls_services)

_log ""
_log "## Service endpoints (gRPC port)"
while IFS= read -r svc; do
  dep="$(rp_runtime_health_service_json "$svc" | jq -r '.k8sName // empty')"
  port="$(rp_runtime_health_service_json "$svc" | jq -r '.grpcPort')"
  if kubectl get svc "$dep" -n "$NS" >/dev/null 2>&1; then
    eps="$(kubectl get endpoints "$dep" -n "$NS" -o jsonpath='{.subsets[0].addresses[0].ip}' 2>/dev/null || true)"
    if [[ -n "$eps" ]]; then
      _pass "$svc: Service $dep has endpoints (grpc port $port)"
    else
      _fail "$svc: Service $dep has no ready endpoints"
    fi
  else
    _fail "$svc: Service $dep missing"
  fi
done < <(rp_cert_contract_mtls_services)

_log ""
_log "## RCA required column (live)"
if [[ -x "$SCRIPT_DIR/rca-rp-grpc-mtls.sh" ]]; then
  rca_log="$OUT/service-mtls-rca-audit.log"
  _rca_audit_ok() {
    grep -q 'all_services_required=true' "$rca_log" 2>/dev/null || \
      { grep -q '✅ rca-rp-grpc-mtls passed' "$rca_log" 2>/dev/null && \
        grep -qE 'Coverage: checked=11 expected=11' "$rca_log" 2>/dev/null && \
        grep -q 'grpc_integrity_ok=true' "$rca_log" 2>/dev/null; }
  }
  if bash "$SCRIPT_DIR/rca-rp-grpc-mtls.sh" --all --required --strict-integrity 2>&1 | tee "$rca_log"; then
    if _rca_audit_ok; then
      _pass "rca-rp-grpc-mtls --all --required --strict-integrity (11/11 coverage, integrity ok)"
    else
      _fail "rca summary missing 11/11 coverage or integrity (see $rca_log)"
    fi
  else
    if grep -qE 'exit_code=139|failure_class: probe_crash|fail_probe_crash|Segmentation fault|probe_crash_retries=' "$rca_log" 2>/dev/null && \
       ! grep -qE 'cluster_dns.*fail' "$rca_log" 2>/dev/null; then
      _log "⚠️  rca first pass failed with probe_crash — retrying once"
      if bash "$SCRIPT_DIR/rca-rp-grpc-mtls.sh" --all --required --strict-integrity 2>&1 | tee "$rca_log"; then
        if _rca_audit_ok; then
          _pass "rca-rp-grpc-mtls --all --required --strict-integrity (probe_crash retry ok)"
        else
          _fail "rca retry summary missing 11/11 coverage or integrity (see $rca_log)"
        fi
      else
        _fail "rca-rp-grpc-mtls retry exited nonzero (see $rca_log)"
      fi
    else
      _fail "rca-rp-grpc-mtls exited nonzero (see $rca_log)"
    fi
  fi
else
  _fail "rca-rp-grpc-mtls.sh not executable"
fi

_log ""
_log "## Summary"
_log "- checks: $TOTAL services"
_log "- pass markers: $PASS"
_log "- failures: $FAIL"
if [[ "$FAIL" -ne 0 ]]; then
  _log ""
  _log "**RESULT: FAIL**"
  exit 1
fi
_log ""
_log "**RESULT: PASS**"
exit 0
