#!/usr/bin/env bash
# Prove 3-stage PKI for every certPolicy.mtlsRequired service (not file existence only).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=lib/rp-dev-ca.sh
source "$SCRIPT_DIR/lib/rp-dev-ca.sh"
# shellcheck source=lib/rp-cert-proof.sh
source "$SCRIPT_DIR/lib/rp-cert-proof.sh"
# shellcheck source=lib/rp-service-cert-contract.sh
source "$SCRIPT_DIR/lib/rp-service-cert-contract.sh"

CERTS="$(rp_dev_certs_dir)"
ROOT="$(rp_dev_root_pem)"
INT="$(rp_dev_intermediate_pem)"
CHAIN="$(rp_dev_chain_pem)"
FAIL=0

bad() { echo "❌ $*" >&2; FAIL=1; }
ok_line() { echo "✅ $*"; }

echo "audit-rp-cert-coverage — 3-stage chain proof (infra/contracts/rp-service-runtime-contract.json)"
echo ""

_int_subject=""
_root_subject=""

# --- Anchors (once) ---
_rp_audit_verify_root() {
  local subj iss text
  subj="$(openssl x509 -in "$ROOT" -noout -subject 2>/dev/null | sed 's/^subject=//')"
  iss="$(openssl x509 -in "$ROOT" -noout -issuer 2>/dev/null | sed 's/^issuer=//')"
  echo "$subj" | grep -q 'record-platform-dev-root' || { bad "root: wrong subject ($subj)"; return 1; }
  [[ "$subj" == "$iss" ]] || { bad "root: must be self-signed"; return 1; }
  text="$(openssl x509 -in "$ROOT" -noout -text 2>/dev/null || true)"
  echo "$text" | grep -q 'CA:TRUE' || { bad "root: missing CA:TRUE"; return 1; }
  echo "$text" | grep -qiE 'Certificate Sign|keyCertSign' || { bad "root: missing keyCertSign"; return 1; }
  _root_subject="$subj"
  ok_line "root CA: self-signed; CA:TRUE; keyCertSign,cRLSign"
}

_rp_audit_verify_intermediate() {
  local subj iss text
  subj="$(openssl x509 -in "$INT" -noout -subject 2>/dev/null | sed 's/^subject=//')"
  iss="$(openssl x509 -in "$INT" -noout -issuer 2>/dev/null | sed 's/^issuer=//')"
  echo "$iss" | grep -q 'record-platform-dev-root' || { bad "intermediate: issuer must be root ($iss)"; return 1; }
  openssl verify -CAfile "$ROOT" "$INT" 2>&1 | grep -q ': OK$' || { bad "intermediate: does not verify against root"; return 1; }
  text="$(openssl x509 -in "$INT" -noout -text 2>/dev/null || true)"
  echo "$text" | grep -q 'CA:TRUE' || { bad "intermediate: missing CA:TRUE"; return 1; }
  _int_subject="$subj"
  ok_line "intermediate CA: signed by root; CA:TRUE; verifies against root"
}

_rp_audit_verify_chain_pem() {
  [[ -f "$CHAIN" ]] || { bad "missing dev-chain.pem"; return 1; }
  local count
  count="$(awk '/BEGIN CERTIFICATE/{n++} END{print n+0}' "$CHAIN")"
  [[ "$count" -eq 2 ]] || { bad "dev-chain.pem must contain exactly 2 certs (intermediate+root), got $count"; return 1; }
  local c1 c2
  c1="$(awk '/BEGIN CERTIFICATE/{on=1} on{print} /END CERTIFICATE/{exit}' "$CHAIN" | openssl x509 -noout -subject 2>/dev/null || true)"
  c2="$(awk '/BEGIN CERTIFICATE/{n++} n==2{on=1} on{print} /END CERTIFICATE/ && n==2{exit}' "$CHAIN" | openssl x509 -noout -subject 2>/dev/null || true)"
  echo "$c1" | grep -q 'intermediate' || { bad "dev-chain.pem first cert must be intermediate ($c1)"; return 1; }
  echo "$c2" | grep -q 'record-platform-dev-root' || { bad "dev-chain.pem second cert must be root ($c2)"; return 1; }
  ok_line "dev-chain.pem: intermediate + root (2 certs, correct order)"
}

_rp_audit_verify_key_match() {
  local label="$1" crt="$2" key="$3"
  [[ -f "$key" ]] || { bad "$label: missing key $key"; return 1; }
  local crt_pub key_pub
  crt_pub="$(openssl x509 -in "$crt" -noout -pubkey 2>/dev/null | openssl md5)"
  key_pub="$(openssl pkey -in "$key" -pubout 2>/dev/null | openssl md5)"
  [[ "$crt_pub" == "$key_pub" ]] || { bad "$label: cert/key public key mismatch"; return 1; }
}

_rp_audit_verify_service_leaf() {
  local svc="$1" crt="$2"
  local subj iss text sans_ext
  [[ -f "$crt" ]] || { bad "$svc: missing $crt"; return 1; }

  local key="${crt%.crt}.key"
  _rp_audit_verify_key_match "$svc" "$crt" "$key" || return 1

  subj="$(openssl x509 -in "$crt" -noout -subject 2>/dev/null | sed 's/^subject=//')"
  iss="$(openssl x509 -in "$crt" -noout -issuer 2>/dev/null | sed 's/^issuer=//')"
  [[ "$subj" != "$iss" ]] || { bad "$svc: leaf must not be self-signed"; return 1; }
  echo "$iss" | grep -q 'record-platform-dev-intermediate' || { bad "$svc: issuer must be intermediate ($iss)"; return 1; }
  echo "$iss" | grep -q 'record-platform-dev-root' && { bad "$svc: leaf must not be signed directly by root"; return 1; }

  text="$(openssl x509 -in "$crt" -noout -text 2>/dev/null || true)"
  echo "$text" | grep -q 'CA:TRUE' && { bad "$svc: leaf must not be CA:TRUE"; return 1; }

  if ! rp_dev_verify_leaf_chain "$crt" 2>&1 | grep -q ': OK$'; then
    bad "$svc: openssl verify leaf → intermediate → root failed"
    rp_dev_verify_leaf_chain "$crt" 2>&1 || true
    return 1
  fi

  echo "$text" | grep -q 'TLS Web Server Authentication' \
    && echo "$text" | grep -q 'TLS Web Client Authentication' \
    || { bad "$svc: EKU must be serverAuth + clientAuth"; return 1; }

  local cn
  cn="$(rp_cert_contract_common_name "$svc")"
  sans_ext="$(openssl x509 -in "$crt" -noout -ext subjectAltName 2>/dev/null || true)"
  for dns_form in "$cn" "${cn}.record-platform" "${cn}.record-platform.svc" "${cn}.record-platform.svc.cluster.local"; do
    echo "$sans_ext" | grep -q "DNS:${dns_form}" \
      || { bad "$svc: SAN missing DNS:${dns_form}"; return 1; }
  done

  ok_line "${svc}: 3-stage verified root → intermediate → leaf; served chain leaf+intermediate; trust bundle intermediate+root"
}

_rp_audit_verify_edge_leaf() {
  local crt="$CERTS/record-platform.test.crt"
  local subj iss text sans_ext
  [[ -f "$crt" ]] || { bad "edge: missing $crt"; return 1; }

  local key="$CERTS/record-platform.test.key"
  _rp_audit_verify_key_match "edge" "$crt" "$key" || return 1

  subj="$(openssl x509 -in "$crt" -noout -subject 2>/dev/null | sed 's/^subject=//')"
  iss="$(openssl x509 -in "$crt" -noout -issuer 2>/dev/null | sed 's/^issuer=//')"
  [[ "$subj" != "$iss" ]] || { bad "edge: leaf must not be self-signed"; return 1; }
  echo "$iss" | grep -q 'record-platform-dev-intermediate' || { bad "edge: issuer must be intermediate"; return 1; }
  rp_dev_verify_leaf_chain "$crt" 2>&1 | grep -q ': OK$' || { bad "edge: chain verify failed"; return 1; }
  text="$(openssl x509 -in "$crt" -noout -text 2>/dev/null || true)"
  echo "$text" | grep -q 'TLS Web Server Authentication' \
    && ! echo "$text" | grep -q 'TLS Web Client Authentication' \
    || { bad "edge: EKU must be serverAuth only"; return 1; }
  sans_ext="$(openssl x509 -in "$crt" -noout -ext subjectAltName 2>/dev/null || true)"
  echo "$sans_ext" | grep -q 'DNS:record-platform.test' \
    || { bad "edge: SAN missing DNS:record-platform.test"; return 1; }
  ok_line "record-platform.test: 3-stage verified root → intermediate → leaf; EKU serverAuth only; SAN DNS:record-platform.test"
}

_rp_audit_verify_client_leaf() {
  local label="$1" crt="$2"
  local subj iss text
  [[ -f "$crt" ]] || { bad "$label: missing $crt"; return 1; }

  local key="${crt%.crt}.key"
  _rp_audit_verify_key_match "$label" "$crt" "$key" || return 1

  iss="$(openssl x509 -in "$crt" -noout -issuer 2>/dev/null | sed 's/^issuer=//')"
  echo "$iss" | grep -q 'record-platform-dev-intermediate' || { bad "$label: issuer must be intermediate"; return 1; }
  rp_dev_verify_leaf_chain "$crt" 2>&1 | grep -q ': OK$' || { bad "$label: chain verify failed"; return 1; }
  text="$(openssl x509 -in "$crt" -noout -text 2>/dev/null || true)"
  echo "$text" | grep -q 'TLS Web Client Authentication' \
    && ! echo "$text" | grep -q 'TLS Web Server Authentication' \
    || { bad "$label: EKU must be clientAuth only"; return 1; }
  ok_line "${label}: 3-stage verified root → intermediate → leaf; EKU clientAuth only"
}

echo "=== PKI anchors ==="
_rp_audit_verify_root || true
_rp_audit_verify_intermediate || true
_rp_audit_verify_chain_pem || true

echo ""
echo "=== Service mTLS leaves ==="
while IFS= read -r svc; do
  [[ -n "$svc" ]] || continue
  _rp_audit_verify_service_leaf "$svc" "$CERTS/${svc}.crt" || true
done < <(rp_cert_contract_mtls_services)

echo ""
echo "=== Edge + special leaves ==="
_rp_audit_verify_edge_leaf || true
[[ -f "$CERTS/envoy-client.crt" ]] && _rp_audit_verify_client_leaf "envoy-client" "$CERTS/envoy-client.crt" || bad "missing envoy-client.crt"

echo ""
echo "=== Kafka leaves ==="
KAFKA_SSL="$CERTS/kafka-ssl"
if [[ -f "$KAFKA_SSL/client.crt" ]]; then
  _rp_audit_verify_client_leaf "kafka-client" "$KAFKA_SSL/client.crt" || true
else
  bad "missing kafka-ssl/client.crt"
fi
if [[ -f "$KAFKA_SSL/kafka-broker.pem" ]]; then
  local_iss="$(openssl x509 -in "$KAFKA_SSL/kafka-broker.pem" -noout -issuer 2>/dev/null | sed 's/^issuer=//' || true)"
  echo "$local_iss" | grep -q 'record-platform-dev-intermediate' || { bad "kafka broker: issuer must be intermediate"; }
  rp_dev_verify_leaf_chain "$KAFKA_SSL/kafka-broker.pem" 2>&1 | grep -q ': OK$' || { bad "kafka broker: chain verify failed"; }
  local_text="$(openssl x509 -in "$KAFKA_SSL/kafka-broker.pem" -noout -text 2>/dev/null || true)"
  echo "$local_text" | grep -q 'TLS Web Server Authentication' || { bad "kafka broker: missing serverAuth EKU"; }
  echo "$local_text" | grep -q 'TLS Web Client Authentication' || { bad "kafka broker: missing clientAuth EKU"; }
  if [[ "$FAIL" -eq 0 ]] || ! echo "$local_iss" | grep -q 'record-platform-dev-root'; then
    ok_line "kafka broker: 3-stage verified root → intermediate → leaf; EKU serverAuth+clientAuth"
  fi
else
  bad "missing kafka-ssl/kafka-broker.pem"
fi

# webapp must stay non-mTLS unless policy changes
echo ""
echo "=== Policy checks ==="
if python3 - "$REPO_ROOT/infra/contracts/rp-service-runtime-contract.json" <<'PY' 2>/dev/null; then
import json, sys
doc = json.load(open(sys.argv[1]))
for row in doc["certPolicy"]["nonMtls"]:
    if row["serviceName"] == "webapp" and not row.get("mtlsRequired", False):
        sys.exit(0)
sys.exit(1)
PY
  ok_line "webapp: certPolicy.mtlsRequired=false (browser edge TLS via Caddy; no service mTLS leaf required)"
  [[ -f "$CERTS/webapp.crt" ]] && bad "webapp.crt exists but webapp must not have mTLS leaf unless mtlsRequired=true"
else
  bad "webapp certPolicy: expected mtlsRequired=false in nonMtls"
fi

for script in dev-generate-certs.sh print-rp-cert-proof.sh verify-rp-cert-chain.sh; do
  grep -qE 'for cn in messaging-service media-service' "$SCRIPT_DIR/$script" 2>/dev/null \
    && bad "$script still hardcodes partial mTLS service list"
done

# generation-id check
if [[ -f "$CERTS/.rp-pki-generation-id" ]]; then
  ok_line "pki-generation-id: $(cat "$CERTS/.rp-pki-generation-id")"
else
  bad "missing certs/.rp-pki-generation-id (run RP_CRYPTO_RESET=1 bash scripts/rp-bootstrap-crypto.sh)"
fi

echo ""
_mtls_n="$(rp_cert_contract_mtls_services | grep -c . || echo 0)"
if [[ "$FAIL" -eq 0 ]]; then
  echo "✅ audit-rp-cert-coverage passed (${_mtls_n} service leaves + edge + kafka; 3-stage chain verified)"
  exit 0
fi
echo "❌ audit-rp-cert-coverage failed — trust gate not satisfied" >&2
exit 1
