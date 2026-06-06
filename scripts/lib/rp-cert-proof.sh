#!/usr/bin/env bash
# Shared RP x509 proof helpers (source from print-rp-cert-proof.sh / verify-rp-cert-chain.sh).
set -euo pipefail

SCRIPT_DIR_RP_CERT_PROOF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=rp-dev-ca.sh
source "$SCRIPT_DIR_RP_CERT_PROOF/rp-dev-ca.sh"

RP_CERT_PROOF_FAIL=0

rp_cert_proof_say() { printf '%s\n' "$*"; }
rp_cert_proof_bad() { rp_cert_proof_say "❌ $*"; RP_CERT_PROOF_FAIL=1; }
rp_cert_proof_ok() { rp_cert_proof_say "✅ $*"; }

rp_cert_proof_print_one() {
  local label="$1" pem="$2" chain="${3:-}"
  local want_eku="${4:-}" # serverAuth | clientAuth | serverAndClient | any

  rp_cert_proof_say ""
  rp_cert_proof_say "=== $label ==="
  rp_cert_proof_say "path: $pem"
  if [[ ! -f "$pem" ]]; then
    rp_cert_proof_bad "missing $pem"
    return
  fi

  rp_cert_proof_say "--- openssl x509 ---"
  openssl x509 -in "$pem" -noout -subject -issuer -ext subjectAltName -ext extendedKeyUsage 2>/dev/null \
    || { rp_cert_proof_bad "openssl x509 failed"; return; }

  local fp
  fp="$(openssl x509 -in "$pem" -noout -fingerprint -sha256 2>/dev/null | sed 's/^.*=//')"
  rp_cert_proof_say "sha256 fingerprint: $fp"

  local text
  text="$(openssl x509 -in "$pem" -noout -text 2>/dev/null || true)"
  case "$want_eku" in
    serverAuth)
      echo "$text" | grep -q "TLS Web Server Authentication" || { rp_cert_proof_bad "missing serverAuth"; return; }
      echo "$text" | grep -q "TLS Web Client Authentication" && { rp_cert_proof_bad "must not have clientAuth"; return; }
      ;;
    clientAuth)
      echo "$text" | grep -q "TLS Web Client Authentication" || { rp_cert_proof_bad "missing clientAuth"; return; }
      echo "$text" | grep -q "TLS Web Server Authentication" && { rp_cert_proof_bad "must not have serverAuth"; return; }
      ;;
    serverAndClient)
      echo "$text" | grep -q "TLS Web Server Authentication" || { rp_cert_proof_bad "missing serverAuth"; return; }
      echo "$text" | grep -q "TLS Web Client Authentication" || { rp_cert_proof_bad "missing clientAuth"; return; }
      ;;
    any|'') ;;
  esac

  if [[ -f "$pem" ]]; then
    if rp_dev_verify_leaf_chain "$pem" 2>&1 | grep -q ': OK$'; then
      rp_cert_proof_ok "openssl verify leaf → intermediate → root (dev-chain.pem)"
    else
      rp_cert_proof_bad "chain verify failed:"
      rp_dev_verify_leaf_chain "$pem" 2>&1 || true
    fi
  fi
}

rp_cert_proof_require_files() {
  local root="$1"
  shift
  local f
  for f in "$@"; do
    [[ -f "$root/$f" ]] || rp_cert_proof_bad "missing required cert file: $f"
  done
}

# Root → intermediate → leaf contract (disk PKI).
rp_cert_proof_verify_three_stage_anchors() {
  local certs="${1:-$(rp_dev_certs_dir)}"
  local root="$certs/dev-root.pem"
  local int="$certs/dev-intermediate.pem"
  local chain="$certs/dev-chain.pem"

  rp_cert_proof_say ""
  rp_cert_proof_say "=== 3-stage PKI anchors (root → intermediate → leaf) ==="

  [[ -f "$root" ]] || { rp_cert_proof_bad "missing $root"; return; }
  [[ -f "$int" ]] || { rp_cert_proof_bad "missing $int"; return; }
  [[ -f "$chain" ]] || { rp_cert_proof_bad "missing $chain"; return; }

  local subj iss text
  subj="$(openssl x509 -in "$root" -noout -subject 2>/dev/null | sed 's/^subject=//')"
  iss="$(openssl x509 -in "$root" -noout -issuer 2>/dev/null | sed 's/^issuer=//')"
  echo "$subj" | grep -q 'CN=record-platform-dev-root' \
    || rp_cert_proof_bad "root subject must be CN=record-platform-dev-root ($subj)"
  [[ "$subj" == "$iss" ]] && rp_cert_proof_ok "root CA self-signed (issuer == subject)" \
    || rp_cert_proof_bad "root issuer must equal subject ($iss vs $subj)"
  text="$(openssl x509 -in "$root" -noout -text 2>/dev/null || true)"
  echo "$text" | grep -q 'CA:TRUE' || rp_cert_proof_bad "root basicConstraints CA:TRUE missing"
  echo "$text" | grep -qiE 'Certificate Sign|keyCertSign' || rp_cert_proof_bad "root keyUsage keyCertSign missing"
  rp_cert_proof_ok "root CA: CA:TRUE + keyCertSign,cRLSign"

  subj="$(openssl x509 -in "$int" -noout -subject 2>/dev/null || true)"
  iss="$(openssl x509 -in "$int" -noout -issuer 2>/dev/null || true)"
  echo "$iss" | grep -q 'CN=record-platform-dev-root' \
    || rp_cert_proof_bad "intermediate issuer must be root ($iss)"
  if openssl verify -CAfile "$root" "$int" 2>&1 | grep -q ': OK$'; then
    rp_cert_proof_ok "intermediate CA signed by root (openssl verify)"
  else
    rp_cert_proof_bad "intermediate does not verify against root"
    openssl verify -CAfile "$root" "$int" 2>&1 || true
  fi

  # dev-chain.pem order: intermediate PEM first, then root PEM (see rp_dev_ensure_intermediate_ca)
  local _c1 _c2
  _c1="$(awk '/BEGIN CERTIFICATE/{on=1} on{print} /END CERTIFICATE/{exit}' "$chain" | openssl x509 -noout -subject 2>/dev/null || true)"
  _c2="$(awk '/BEGIN CERTIFICATE/{n++} n==2{on=1} on{print} /END CERTIFICATE/ && n==2{exit}' "$chain" | openssl x509 -noout -subject 2>/dev/null || true)"
  echo "$_c1" | grep -q 'intermediate' || rp_cert_proof_bad "dev-chain.pem first cert must be intermediate ($_c1)"
  echo "$_c2" | grep -q 'record-platform-dev-root' || rp_cert_proof_bad "dev-chain.pem second cert must be root ($_c2)"
  [[ "$RP_CERT_PROOF_FAIL" -eq 0 ]] && rp_cert_proof_ok "dev-chain.pem: intermediate + root (chain bundle order)"
}

rp_cert_proof_verify_leaf_not_ca() {
  local pem="$1" label="${2:-leaf}"
  local text
  [[ -f "$pem" ]] || { rp_cert_proof_bad "missing $pem"; return; }
  text="$(openssl x509 -in "$pem" -noout -text 2>/dev/null || true)"
  if echo "$text" | grep -q 'CA:TRUE'; then
    rp_cert_proof_bad "$label must not be CA:TRUE"
  else
    rp_cert_proof_ok "leaf $label: not a CA (CA:FALSE or absent)"
  fi
  if rp_dev_verify_leaf_chain "$pem" 2>&1 | grep -q ': OK$'; then
    rp_cert_proof_ok "openssl verify $label → intermediate → root"
  else
    rp_cert_proof_bad "openssl verify failed for $label"
    rp_dev_verify_leaf_chain "$pem" 2>&1 || true
  fi
}
