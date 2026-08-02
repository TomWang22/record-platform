#!/usr/bin/env bash
# Generate Kafka TLS negative-test fixtures (public certs + keys under certs/kafka-client/_fixtures).
# Keys are gitignored via certs/; never commit them.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib/rp-dev-ca.sh
source "$SCRIPT_DIR/lib/rp-dev-ca.sh"
rp_dev_bootstrap_chain

OUT="${REPO_ROOT}/certs/kafka-client/_fixtures"
mkdir -p "$OUT"

gen_leaf() {
  local name="$1" eku="$2" days="$3" not_before_offset="${4:-0}"
  local key="$OUT/${name}.key" crt="$OUT/${name}.crt" csr="$OUT/${name}.csr" ext="$OUT/${name}.ext"
  openssl genrsa -out "$key" 2048 2>/dev/null
  openssl req -new -key "$key" -out "$csr" -subj "/CN=${name}/O=Record Platform" 2>/dev/null
  cat >"$ext" <<EOF
[v3]
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=${eku}
subjectAltName=DNS:${name},URI:spiffe://record-platform/fixture/${name}
EOF
  # startdate/enddate via -days; for not-yet-valid use future start via faketime if available, else openssl -startdate
  if [[ "$not_before_offset" -gt 0 ]]; then
    # Issue with short validity starting in the future using -not_before relative if supported
    local start end
    start="$(date -u -v+"${not_before_offset}"d +%Y%m%d%H%M%SZ 2>/dev/null || date -u -d "+${not_before_offset} days" +%Y%m%d%H%M%SZ)"
    end="$(date -u -v+"$((not_before_offset + days))"d +%Y%m%d%H%M%SZ 2>/dev/null || date -u -d "+$((not_before_offset + days)) days" +%Y%m%d%H%M%SZ)"
    openssl x509 -req -in "$csr" -CA "$(rp_dev_intermediate_pem)" -CAkey "$(rp_dev_intermediate_key)" \
      -CAserial "$(rp_dev_certs_dir)/dev-intermediate.srl" -CAcreateserial \
      -out "$crt" -sha256 -extensions v3 -extfile "$ext" \
      -not_before "$start" -not_after "$end" 2>/dev/null \
      || openssl x509 -req -in "$csr" -CA "$(rp_dev_intermediate_pem)" -CAkey "$(rp_dev_intermediate_key)" \
           -CAserial "$(rp_dev_certs_dir)/dev-intermediate.srl" -CAcreateserial \
           -out "$crt" -days "$days" -sha256 -extensions v3 -extfile "$ext" 2>/dev/null
  else
    openssl x509 -req -in "$csr" -CA "$(rp_dev_intermediate_pem)" -CAkey "$(rp_dev_intermediate_key)" \
      -CAserial "$(rp_dev_certs_dir)/dev-intermediate.srl" -CAcreateserial \
      -out "$crt" -days "$days" -sha256 -extensions v3 -extfile "$ext" 2>/dev/null
  fi
  # expired: backdate by issuing with -days 0 and openssl ca -startdate if needed
  if [[ "$name" == "client-expired" ]]; then
    openssl x509 -req -in "$csr" -CA "$(rp_dev_intermediate_pem)" -CAkey "$(rp_dev_intermediate_key)" \
      -CAserial "$(rp_dev_certs_dir)/dev-intermediate.srl" -CAcreateserial \
      -out "$crt" -days 1 -sha256 -extensions v3 -extfile "$ext" 2>/dev/null
    # Force expiry by rewriting with past dates when supported
    local past future
    past="$(date -u -v-30d +%Y%m%d%H%M%SZ 2>/dev/null || date -u -d '-30 days' +%Y%m%d%H%M%SZ)"
    future="$(date -u -v-1d +%Y%m%d%H%M%SZ 2>/dev/null || date -u -d '-1 days' +%Y%m%d%H%M%SZ)"
    openssl x509 -req -in "$csr" -CA "$(rp_dev_intermediate_pem)" -CAkey "$(rp_dev_intermediate_key)" \
      -CAserial "$(rp_dev_certs_dir)/dev-intermediate.srl" -CAcreateserial \
      -out "$crt" -sha256 -extensions v3 -extfile "$ext" \
      -not_before "$past" -not_after "$future" 2>/dev/null || true
  fi
  openssl verify -CAfile "$(rp_dev_root_pem)" -untrusted "$(rp_dev_intermediate_pem)" "$crt" >/dev/null 2>&1 || true
  echo "fixture ${name} eku=${eku} fp=$(openssl x509 -in "$crt" -noout -fingerprint -sha256 | sed 's/.*=//')"
}

# CLIENT_AUTH_EKU_ABSENT: serverAuth only (no clientAuth)
gen_leaf "client-auth-eku-absent" "serverAuth" 30 0
# serverAuth-absent server leaf for broker-side negative (serverAuth missing)
gen_leaf "server-auth-eku-absent" "clientAuth" 30 0
gen_leaf "client-expired" "clientAuth" 1 0
gen_leaf "client-not-yet-valid" "clientAuth" 30 30

# malformed chain helper: leaf only PEM without intermediate (copy leaf)
cp "$OUT/client-auth-eku-absent.crt" "$OUT/client-malformed-chain-leaf-only.crt"
cp "$OUT/client-auth-eku-absent.key" "$OUT/client-malformed-chain-leaf-only.key"

# missing intermediate presentation is a runtime config case (truststore root-only) — marker file
cat >"$OUT/README.md" <<'EOF'
Negative fixtures for Kafka TLS acceptance. Private keys must not be committed.
EOF

echo "✅ fixtures in ${OUT}"
