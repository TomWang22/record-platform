#!/usr/bin/env bash
# Record Platform dev PKI: root → intermediate → leaf (3-stage chain).
# Source from dev-generate-certs.sh, kafka-ssl-from-dev-root.sh, generate-envoy-client-cert.sh
#
# Env:
#   RP_DEV_CERTS_FORCE=1  — regenerate root + intermediate + all leaves
#   RP_DEV_CERT_DAYS=365
#
# shellcheck shell=bash

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

rp_dev_certs_dir() {
  printf '%s' "${REPO_ROOT}/certs"
}

rp_dev_root_pem() { printf '%s' "$(rp_dev_certs_dir)/dev-root.pem"; }
rp_dev_root_key() { printf '%s' "$(rp_dev_certs_dir)/dev-root.key"; }
rp_dev_intermediate_pem() { printf '%s' "$(rp_dev_certs_dir)/dev-intermediate.pem"; }
rp_dev_intermediate_key() { printf '%s' "$(rp_dev_certs_dir)/dev-intermediate.key"; }
rp_dev_chain_pem() { printf '%s' "$(rp_dev_certs_dir)/dev-chain.pem"; }

# curl/openssl --cacert for Caddy edge (leaf is signed by intermediate; dev-root.pem alone fails verify).
rp_dev_edge_ca_file() {
  local chain root
  chain="$(rp_dev_chain_pem)"
  if [[ -f "$chain" ]]; then
    printf '%s' "$chain"
    return 0
  fi
  root="$(rp_dev_root_pem)"
  if [[ -f "$root" ]]; then
    printf '%s' "$root"
    return 0
  fi
  return 1
}

rp_dev_ensure_dirs() {
  mkdir -p "$(rp_dev_certs_dir)" "${REPO_ROOT}/certs/kafka-dev" "${REPO_ROOT}/certs/kafka-ssl"
}

rp_dev_force_regen() {
  [[ "${RP_DEV_CERTS_FORCE:-0}" == "1" ]]
}

_rp_dev_chain_bootstrapped=0

rp_dev_bootstrap_chain() {
  if [[ "${_rp_dev_chain_bootstrapped}" == "1" ]]; then
    return 0
  fi
  rp_dev_ensure_root_ca
  rp_dev_ensure_intermediate_ca
  _rp_dev_chain_bootstrapped=1
}

rp_dev_regenerate_pki_anchors() {
  rm -f "$(rp_dev_intermediate_pem)" "$(rp_dev_intermediate_key)" "$(rp_dev_root_pem)" "$(rp_dev_root_key)" \
    "$(rp_dev_certs_dir)/dev-root.srl" "$(rp_dev_certs_dir)/dev-intermediate.srl" \
    "$(rp_dev_chain_pem)" 2>/dev/null || true
  _rp_dev_chain_bootstrapped=0
  rp_dev_bootstrap_chain
}

rp_dev_ensure_root_ca() {
  local pem key days="${RP_DEV_CERT_DAYS:-365}"
  pem="$(rp_dev_root_pem)"
  key="$(rp_dev_root_key)"
  if [[ -f "$pem" && -f "$key" ]]; then
    return 0
  fi
  openssl genrsa -out "$key" 4096 2>/dev/null
  openssl req -x509 -new -nodes -key "$key" -sha256 -days "$days" \
    -out "$pem" \
    -subj "/CN=record-platform-dev-root/O=Record Platform/C=US" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:1" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null
}

rp_dev_ensure_intermediate_ca() {
  local root_pem root_key int_pem int_key days="${RP_DEV_CERT_DAYS:-365}" tmp
  rp_dev_ensure_root_ca
  root_pem="$(rp_dev_root_pem)"
  root_key="$(rp_dev_root_key)"
  int_pem="$(rp_dev_intermediate_pem)"
  int_key="$(rp_dev_intermediate_key)"
  if [[ -f "$int_pem" && -f "$int_key" ]]; then
    cat "$int_pem" "$root_pem" > "$(rp_dev_chain_pem)"
    return 0
  fi
  tmp="${REPO_ROOT}/.rp-dev-ca-tmp.$$"
  mkdir -p "$tmp"
  openssl genrsa -out "$int_key" 4096 2>/dev/null
  openssl req -new -key "$int_key" -out "$tmp/intermediate.csr" \
    -subj "/CN=record-platform-dev-intermediate/O=Record Platform/C=US" 2>/dev/null
  cat > "$tmp/intermediate.ext" <<'EOF'
[v3_intermediate]
basicConstraints = critical,CA:TRUE,pathlen:0
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always,issuer
EOF
  openssl x509 -req -in "$tmp/intermediate.csr" -CA "$root_pem" -CAkey "$root_key" \
    -CAcreateserial -out "$int_pem" -days "$days" -sha256 \
    -extensions v3_intermediate -extfile "$tmp/intermediate.ext" 2>/dev/null
  cat "$int_pem" "$root_pem" > "$(rp_dev_chain_pem)"
  rm -rf "$tmp"
}

rp_dev_sign_leaf() {
  # Usage: rp_dev_sign_leaf <leaf_crt> <leaf_key> <csr_subj> <extfile_path>
  local leaf_crt="$1" leaf_key="$2" csr_subj="$3" extfile="$4" days="${RP_DEV_CERT_DAYS:-365}"
  local int_pem int_key tmp sect srl
  rp_dev_bootstrap_chain
  int_pem="$(rp_dev_intermediate_pem)"
  int_key="$(rp_dev_intermediate_key)"
  srl="$(rp_dev_certs_dir)/dev-intermediate.srl"
  sect="$(grep -E '^\[' "$extfile" | head -1 | tr -d '[]')"
  tmp="${REPO_ROOT}/.rp-dev-sign-tmp.$$"
  mkdir -p "$tmp"
  if rp_dev_force_regen; then
    rm -f "$leaf_crt" "$leaf_key" 2>/dev/null || true
  fi
  if [[ ! -f "$leaf_crt" ]] || [[ ! -f "$leaf_key" ]]; then
    openssl genrsa -out "$leaf_key" 2048
    openssl req -new -key "$leaf_key" -out "$tmp/leaf.csr" -subj "$csr_subj"
    if ! openssl x509 -req -in "$tmp/leaf.csr" -CA "$int_pem" -CAkey "$int_key" \
      -CAserial "$srl" -CAcreateserial -out "$leaf_crt" -days "$days" -sha256 \
      -extfile "$extfile" -extensions "$sect"; then
      echo "❌ failed to sign leaf: $leaf_crt (section=$sect)" >&2
      rm -rf "$tmp"
      return 1
    fi
    if ! rp_dev_verify_leaf_chain "$leaf_crt" | grep -q ': OK'; then
      echo "❌ leaf chain verify failed after sign: $leaf_crt" >&2
      rp_dev_verify_leaf_chain "$leaf_crt" >&2 || true
      rm -rf "$tmp"
      return 1
    fi
  fi
  rm -rf "$tmp"
}

rp_dev_leaf_with_chain() {
  # cat leaf + intermediate → stdout (for K8s tls.crt)
  local leaf_crt="$1"
  cat "$leaf_crt" "$(rp_dev_intermediate_pem)"
}

rp_dev_verify_leaf_chain() {
  local leaf_crt="$1"
  openssl verify -CAfile "$(rp_dev_root_pem)" -untrusted "$(rp_dev_intermediate_pem)" "$leaf_crt"
}

rp_dev_forbidden_in_cert() {
  local pem="$1"
  openssl x509 -in "$pem" -noout -text 2>/dev/null | grep -qiE \
    'off-campus-housing\.test|record\.local|DNS:localhost|DNS:127\.0\.0\.1|IP Address:127\.0\.0\.1|IP:127\.0\.0\.1' && return 0
  return 1
}
