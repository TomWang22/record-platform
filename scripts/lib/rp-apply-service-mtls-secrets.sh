#!/usr/bin/env bash
# Apply per-service mTLS secrets + combined bundle (Option A + B documented in certPolicy).
set -euo pipefail

_rp_apply_mtls_lib="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_rp_apply_mtls_repo="$(cd "$_rp_apply_mtls_lib/../.." && pwd)"
# shellcheck source=lib/rp-dev-ca.sh
source "$_rp_apply_mtls_lib/rp-dev-ca.sh"
# shellcheck source=lib/rp-pki-generation.sh
source "$_rp_apply_mtls_lib/rp-pki-generation.sh"
# shellcheck source=lib/rp-service-cert-contract.sh
source "$_rp_apply_mtls_lib/rp-service-cert-contract.sh"

_rp_apply_verify_cert_count() {
  local label="$1" pem_file="$2" expected="$3"
  local count
  count="$(awk '/BEGIN CERTIFICATE/{n++} END{print n+0}' "$pem_file")"
  if [[ "$count" -ne "$expected" ]]; then
    echo "❌ $label: expected $expected certs, got $count in $pem_file" >&2
    return 1
  fi
}

rp_apply_service_mtls_secrets() {
  local ns="${1:-record-platform}"
  local certs
  certs="$(rp_dev_certs_dir)"
  local chain_pem
  chain_pem="$(rp_dev_chain_pem)"

  local bundle
  bundle="$(rp_cert_contract_bundle_secret_name)"
  local -a from_args=(--from-file=ca.crt="$chain_pem" --from-file=dev-chain.pem="$chain_pem")
  local gen_id="${RP_PKI_GENERATION_ID:-}"
  [[ -n "$gen_id" ]] && from_args+=(--from-literal=rp-pki-generation-id="$gen_id")

  while IFS= read -r svc; do
    [[ -n "$svc" ]] || continue
    local crt="$certs/${svc}.crt" key="$certs/${svc}.key"
    [[ -f "$crt" && -f "$key" ]] || { echo "❌ missing disk cert for $svc ($crt)" >&2; return 1; }

    from_args+=(--from-file="${svc}.crt=$crt" --from-file="${svc}.key=$key")

    local sec chain_crt="${TMPDIR:-/tmp}/rp-${svc}-chain.pem"
    sec="$(rp_cert_contract_per_service_secret_name "$svc")"
    rp_dev_leaf_with_chain "$crt" >"$chain_crt"

    _rp_apply_verify_cert_count "service-tls $svc tls.crt" "$chain_crt" 2 || return 1
    _rp_apply_verify_cert_count "service-tls $svc ca.crt" "$chain_pem" 2 || return 1

    kubectl -n "$ns" delete secret "$sec" --ignore-not-found 2>/dev/null || true
    kubectl -n "$ns" create secret generic "$sec" \
      --from-file=tls.crt="$chain_crt" \
      --from-file=tls.key="$key" \
      --from-file=ca.crt="$chain_pem" \
      --from-file=dev-chain.pem="$chain_pem"
    rp_annotate_secret_pki_generation "$ns" "$sec"
    rm -f "$chain_crt"
    echo "  ✅ secret/$sec (per-service mTLS leaf; tls.crt=leaf+intermediate)"
  done < <(rp_cert_contract_mtls_services)

  kubectl -n "$ns" delete secret "$bundle" --ignore-not-found 2>/dev/null || true
  # shellcheck disable=SC2068
  kubectl -n "$ns" create secret generic "$bundle" "${from_args[@]}"
  rp_annotate_secret_pki_generation "$ns" "$bundle"
  echo "  ✅ secret/$bundle (combined bundle: <service>.crt/.key + ca.crt + dev-chain.pem)"

  local edge_crt="$certs/record-platform.test.crt" edge_key="$certs/record-platform.test.key"
  [[ -f "$edge_crt" && -f "$edge_key" ]] || { echo "❌ missing edge cert $edge_crt" >&2; return 1; }
  local chain_tmp="${_rp_apply_mtls_repo}/.rp-edge-chain-tmp.pem"
  rp_dev_leaf_with_chain "$edge_crt" >"$chain_tmp"
  _rp_apply_verify_cert_count "edge tls.crt" "$chain_tmp" 2 || return 1

  kubectl -n "$ns" delete secret service-tls edge-service-tls --ignore-not-found 2>/dev/null || true
  kubectl -n "$ns" create secret generic service-tls \
    --from-file=tls.crt="$chain_tmp" \
    --from-file=tls.key="$edge_key" \
    --from-file=ca.crt="$chain_pem"
  rp_annotate_secret_pki_generation "$ns" service-tls
  kubectl -n "$ns" create secret generic edge-service-tls \
    --from-file=tls.crt="$chain_tmp" \
    --from-file=tls.key="$edge_key" \
    --from-file=ca.crt="$chain_pem"
  rp_annotate_secret_pki_generation "$ns" edge-service-tls
  rm -f "$chain_tmp"
  echo "  ✅ secret/service-tls + edge-service-tls (edge leaf alias)"
}
