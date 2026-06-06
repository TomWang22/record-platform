#!/usr/bin/env bash
# Gate: RP 3-stage PKI (root → intermediate → leaf) + Kafka JKS/secret chain contract.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=lib/rp-dev-ca.sh
source "$SCRIPT_DIR/lib/rp-dev-ca.sh"
# shellcheck source=lib/rp-cert-proof.sh
source "$SCRIPT_DIR/lib/rp-cert-proof.sh"
# shellcheck source=lib/rp-kafka-ssl-fingerprint.sh
source "$SCRIPT_DIR/lib/rp-kafka-ssl-fingerprint.sh"

NS="${HOUSING_NS:-record-platform}"
CERTS="$(rp_dev_certs_dir)"
KAFKA_SSL="$CERTS/kafka-ssl"
FAIL=0

die() { echo "❌ $*" >&2; FAIL=1; }
ok() { echo "✅ $*"; }

rp_cert_proof_verify_three_stage_anchors "$CERTS" || true
[[ "$RP_CERT_PROOF_FAIL" -eq 0 ]] || FAIL=1

rp_cert_proof_verify_leaf_not_ca "$CERTS/record-platform.test.crt" "edge record-platform.test" || true
[[ "$RP_CERT_PROOF_FAIL" -eq 0 ]] || FAIL=1

for cn in messaging-service media-service trust-service notification-service auth-service listings-service api-gateway; do
  [[ -f "$CERTS/${cn}.crt" ]] || continue
  rp_cert_proof_verify_leaf_not_ca "$CERTS/${cn}.crt" "$cn" || true
done
[[ "$RP_CERT_PROOF_FAIL" -eq 0 ]] || FAIL=1

[[ -f "$KAFKA_SSL/kafka-broker.pem" ]] && rp_cert_proof_verify_leaf_not_ca "$KAFKA_SSL/kafka-broker.pem" "kafka broker" || true
[[ "$RP_CERT_PROOF_FAIL" -eq 0 ]] || FAIL=1

[[ -f "$KAFKA_SSL/ca-cert.pem" ]] && cmp -s "$KAFKA_SSL/ca-cert.pem" "$(rp_dev_chain_pem)" \
  && ok "kafka-ssl ca-cert.pem = dev-chain.pem" \
  || die "kafka-ssl ca-cert.pem must equal certs/dev-chain.pem"

if [[ -f "$KAFKA_SSL/kafka.keystore.jks" ]] && [[ -f "$KAFKA_SSL/kafka.keystore-password" ]]; then
  KAFKA_KEYSTORE_PATH="$KAFKA_SSL/kafka.keystore.jks" \
    KAFKA_KEYSTORE_PASSWORD_FILE="$KAFKA_SSL/kafka.keystore-password" \
    REPO_ROOT="$REPO_ROOT" \
    bash "$SCRIPT_DIR/verify-kafka-broker-keystore-jks.sh" || FAIL=1
  _pw="$(tr -d '\r\n' <"$KAFKA_SSL/kafka.keystore-password")"
  _clen="$(keytool -list -v -keystore "$KAFKA_SSL/kafka.keystore.jks" -storepass "$_pw" -storetype JKS 2>/dev/null \
    | grep -m1 'Certificate chain length:' | awk '{print $NF}')"
  [[ "$_clen" == "2" ]] && ok "Kafka broker JKS chain length: 2 (leaf + intermediate)" \
    || die "Kafka broker JKS chain length must be 2 (got ${_clen:-unknown})"
  if [[ -f "$KAFKA_SSL/kafka.truststore.jks" ]] && [[ -f "$KAFKA_SSL/kafka.truststore-password" ]]; then
    _tpw="$(tr -d '\r\n' <"$KAFKA_SSL/kafka.truststore-password")"
    keytool -list -v -keystore "$KAFKA_SSL/kafka.truststore.jks" -storepass "$_tpw" -storetype JKS 2>/dev/null \
      | grep -q 'record-platform-dev-root' && ok "Kafka truststore contains root CA" \
      || die "Kafka truststore must contain record-platform-dev-root"
  fi
fi

if command -v kubectl >/dev/null 2>&1 && kubectl get secret kafka-ssl-secret -n "$NS" &>/dev/null 2>&1; then
  if rp_kafka_ssl_verify_triple_match "$NS" "$KAFKA_SSL/ca-cert.pem" 2>/dev/null; then
    ok "kafka-ssl-secret ca-cert.pem fingerprint triple-match (disk == secret == annotation)"
  else
    die "kafka-ssl-secret fingerprint mismatch"
  fi
fi

if [[ "$FAIL" -ne 0 ]]; then
  echo "❌ rp-verify-three-stage-cert-contract failed" >&2
  exit 1
fi
echo "✅ rp-verify-three-stage-cert-contract OK"
