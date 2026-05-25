#!/usr/bin/env bash
# Shared PKI generation-id helpers. Source from any script that writes or audits K8s TLS secrets.
#
# Functions:
#   rp_pki_generation_id     — current id from env or certs/.rp-pki-generation-id
#   rp_pki_generated_at      — timestamp from env or certs/.rp-pki-generated-at or now
#   rp_annotate_secret_pki_generation <ns> <secret-name>  — annotate a K8s secret

_RP_PKI_GEN_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_RP_PKI_GEN_REPO="$(cd "$_RP_PKI_GEN_LIB_DIR/../.." && pwd)"

rp_pki_generation_id() {
  if [[ -n "${RP_PKI_GENERATION_ID:-}" ]]; then
    printf '%s' "$RP_PKI_GENERATION_ID"
    return 0
  fi
  local f="$_RP_PKI_GEN_REPO/certs/.rp-pki-generation-id"
  if [[ -f "$f" ]] && [[ -s "$f" ]]; then
    cat "$f"
    return 0
  fi
  if [[ "${RP_ALLOW_MISSING_PKI_GENERATION:-0}" == "1" ]]; then
    return 0
  fi
  echo "❌ certs/.rp-pki-generation-id missing and RP_PKI_GENERATION_ID not set" >&2
  return 1
}

rp_pki_generated_at() {
  if [[ -n "${RP_PKI_GENERATED_AT:-}" ]]; then
    printf '%s' "$RP_PKI_GENERATED_AT"
    return 0
  fi
  local f="$_RP_PKI_GEN_REPO/certs/.rp-pki-generated-at"
  if [[ -f "$f" ]] && [[ -s "$f" ]]; then
    cat "$f"
    return 0
  fi
  date -u +%Y-%m-%dT%H:%M:%SZ
}

rp_annotate_secret_pki_generation() {
  local ns="$1" name="$2"
  local gen_id
  gen_id="$(rp_pki_generation_id 2>/dev/null || true)"
  [[ -z "$gen_id" ]] && return 0
  local gen_at
  gen_at="$(rp_pki_generated_at)"
  kubectl -n "$ns" annotate secret "$name" --overwrite \
    "rp.dev/pki-generation-id=$gen_id" \
    "rp.dev/pki-generated-at=$gen_at" \
    "rp.dev/pki-chain-model=root->intermediate->leaf" 2>/dev/null || true
}
