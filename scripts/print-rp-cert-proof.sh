#!/usr/bin/env bash
# Print explicit x509 proof for RP dev PKI (B.crypto + post-K8s secrets).
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
CHAIN="$(rp_dev_chain_pem)"
KAFKA_SSL="$CERTS/kafka-ssl"

rp_cert_proof_say "=== RP cert proof (subject / issuer / SAN / EKU / verify / sha256) ==="

rp_cert_proof_verify_three_stage_anchors "$CERTS"

rp_cert_proof_require_files "$REPO_ROOT/certs" \
  dev-root.pem dev-root.key dev-intermediate.pem dev-intermediate.key dev-chain.pem \
  record-platform.test.crt record-platform.test.key \
  envoy-client.crt envoy-client.key

rp_cert_proof_print_one "edge record-platform.test (serverAuth only)" \
  "$CERTS/record-platform.test.crt" "$CHAIN" serverAuth

while IFS= read -r cn; do
  [[ -n "$cn" ]] || continue
  [[ -f "$CERTS/${cn}.crt" ]] || { rp_cert_proof_bad "missing service leaf: ${cn}.crt"; continue; }
  rp_cert_proof_print_one "service $cn (serverAuth + clientAuth)" \
    "$CERTS/${cn}.crt" "$CHAIN" serverAndClient
done < <(rp_cert_contract_mtls_services)

rp_cert_proof_print_one "envoy client (clientAuth only)" \
  "$CERTS/envoy-client.crt" "$CHAIN" clientAuth

if [[ -f "$KAFKA_SSL/client.crt" ]]; then
  rp_cert_proof_print_one "kafka client (clientAuth only)" \
    "$KAFKA_SSL/client.crt" "$CHAIN" clientAuth
elif [[ -f "$CERTS/kafka-dev/client.crt" ]]; then
  rp_cert_proof_say ""
  rp_cert_proof_say "ℹ️  kafka-ssl/client.crt not yet — showing kafka-dev client (run kafka-ssl-from-dev-root.sh for broker/JKS)"
  rp_cert_proof_print_one "kafka client (kafka-dev, clientAuth only)" \
    "$CERTS/kafka-dev/client.crt" "$CHAIN" clientAuth
fi

if [[ -f "$KAFKA_SSL/kafka-broker.pem" ]]; then
  rp_cert_proof_print_one "kafka broker leaf (serverAuth + clientAuth)" \
    "$KAFKA_SSL/kafka-broker.pem" "$CHAIN" serverAndClient
  NS="${HOUSING_NS:-record-platform}"
  REPLICAS="${KAFKA_BROKER_REPLICAS:-3}"
  # shellcheck source=lib/kafka-broker-sans.sh
  source "$SCRIPT_DIR/lib/kafka-broker-sans.sh"
  rp_cert_proof_say ""
  rp_cert_proof_say "--- kafka broker DNS SANs (all required broker names) ---"
  while IFS= read -r spec; do
    [[ -z "$spec" ]] && continue
    kind="${spec%%|*}"
    token="${spec#*|}"
    if [[ "$kind" == "exact" ]]; then
      openssl x509 -in "$KAFKA_SSL/kafka-broker.pem" -noout -text 2>/dev/null | grep -qE "DNS:${token}([^a-zA-Z0-9.-]|$)" \
        || rp_cert_proof_bad "kafka broker missing exact SAN: $token"
    else
      openssl x509 -in "$KAFKA_SSL/kafka-broker.pem" -noout -text 2>/dev/null | grep -q "DNS:${token}" \
        || rp_cert_proof_bad "kafka broker missing SAN: $token"
    fi
  done < <(rp_kafka_emit_san_verify_dns_specs "$NS" "$REPLICAS")
  [[ "$RP_CERT_PROOF_FAIL" -eq 0 ]] && rp_cert_proof_ok "kafka broker headless + per-broker external DNS SANs"
  rp_cert_proof_say ""
  rp_cert_proof_say "--- kafka broker MetalLB IP SANs (when assigned) ---"
  if [[ "${KAFKA_SSL_AUTO_METALLB_IPS:-1}" == "0" ]]; then
    rp_cert_proof_say "ℹ️  KAFKA_SSL_AUTO_METALLB_IPS=0 — MetalLB IP SAN check deferred to F.kafka_alignment"
  else
    _lb_ips="$(rp_kafka_metallb_external_lb_ips_csv "$NS" "$REPLICAS" 2>/dev/null || true)"
    if [[ -n "$_lb_ips" ]]; then
      IFS=',' read -r -a _ips <<< "${_lb_ips// /}"
      for _ip in "${_ips[@]}"; do
        [[ -z "$_ip" ]] && continue
        openssl x509 -in "$KAFKA_SSL/kafka-broker.pem" -noout -text 2>/dev/null | grep -q "IP Address:${_ip}" \
          || rp_cert_proof_bad "kafka broker missing MetalLB IP SAN: ${_ip}"
      done
      [[ "$RP_CERT_PROOF_FAIL" -eq 0 ]] && rp_cert_proof_ok "kafka broker MetalLB IP SANs (${_lb_ips})"
    else
      rp_cert_proof_say "ℹ️  no kafka-*-external LoadBalancer IPs in cluster yet (expected before F.kafka_alignment)"
    fi
  fi
  rp_cert_proof_say ""
  rp_cert_proof_say "--- kafka broker SAN dump (openssl) ---"
  openssl x509 -in "$KAFKA_SSL/kafka-broker.pem" -noout -text 2>/dev/null | grep -E 'DNS:|IP Address:' || true
fi

if [[ -f "$KAFKA_SSL/kafka.keystore.jks" ]] && [[ -f "$KAFKA_SSL/kafka.keystore-password" ]]; then
  rp_cert_proof_say ""
  rp_cert_proof_say "--- kafka broker JKS ---"
  if KAFKA_KEYSTORE_PATH="$KAFKA_SSL/kafka.keystore.jks" \
    KAFKA_KEYSTORE_PASSWORD_FILE="$KAFKA_SSL/kafka.keystore-password" \
    REPO_ROOT="$REPO_ROOT" \
    bash "$SCRIPT_DIR/verify-kafka-broker-keystore-jks.sh" 2>/dev/null; then
    rp_cert_proof_ok "kafka.keystore.jks PrivateKeyEntry + EKU + chain"
    _pw="$(tr -d '\r\n' <"$KAFKA_SSL/kafka.keystore-password")"
    _clen="$(keytool -list -v -keystore "$KAFKA_SSL/kafka.keystore.jks" -storepass "$_pw" -storetype JKS 2>/dev/null \
      | grep -m1 'Certificate chain length:' | awk '{print $NF}')"
    [[ -n "$_clen" ]] && rp_cert_proof_say "JKS certificate chain length: ${_clen}"
  else
    rp_cert_proof_bad "kafka.keystore.jks verification failed"
  fi
fi

if command -v kubectl >/dev/null 2>&1; then
  NS="${HOUSING_NS:-record-platform}"
  if kubectl get secret kafka-ssl-secret -n "$NS" -o name &>/dev/null 2>&1; then
    rp_cert_proof_say ""
    rp_cert_proof_say "--- k8s secret record-platform/kafka-ssl-secret keys ---"
    kubectl get secret kafka-ssl-secret -n "$NS" -o jsonpath='{range $k,$v := .data}{"$k "}{end}' 2>/dev/null | tr ' ' '\n' | sort -u || true
    _ann="$(kubectl get secret kafka-ssl-secret -n "$NS" -o go-template='{{index .metadata.annotations "rp.dev/ca-fingerprint-sha256"}}' 2>/dev/null || true)"
    [[ -n "$_ann" ]] && rp_cert_proof_ok "annotation rp.dev/ca-fingerprint-sha256 present" \
      || rp_cert_proof_say "ℹ️  rp.dev/ca-fingerprint-sha256 not set yet (expected after apply-rp-kafka-ssl-secret.sh / MetalLB)"
  fi
fi

rp_cert_proof_say ""
rp_cert_proof_say "--- kafka-ssl-secret writer audit ---"
bash "$SCRIPT_DIR/rp-audit-kafka-ssl-secret-writers.sh" || RP_CERT_PROOF_FAIL=1

_hits="$(grep -rl 'och-kafka-ssl-secret' "$REPO_ROOT/scripts" "$REPO_ROOT/infra" 2>/dev/null \
  | grep -vE 'rp-verify-kafka-cert-chain|rp-verify-kustomize-app-services|print-rp-cert-proof|verify-bootstrap-state|cluster_health|package-|toolkit-reference|dev-onboard|apply-och|rollout-restart-och|check-rp-hybrid-cold-bootstrap-toolkit|README\.md' || true)"
if [[ -n "$_hits" ]]; then
  rp_cert_proof_bad "och-kafka-ssl-secret referenced in active paths:"
  printf '%s\n' "$_hits" | sed 's/^/  /'
  RP_CERT_PROOF_FAIL=1
else
  rp_cert_proof_ok "no och-kafka-ssl-secret in active bootstrap scripts/manifests"
fi

if [[ -f "$KAFKA_SSL/client.crt" && -f "$KAFKA_SSL/kafka-broker.pem" ]]; then
  rp_cert_proof_say ""
  rp_cert_proof_say "--- rp-verify-kafka-cert-chain (disk + optional cluster) ---"
  _vk_env=(RP_VERIFY_KAFKA_SKIP_SECRET_ANNOTATION="${RP_VERIFY_KAFKA_SKIP_SECRET_ANNOTATION:-1}")
  if ! env "${_vk_env[@]}" bash "$SCRIPT_DIR/rp-verify-kafka-cert-chain.sh"; then
    RP_CERT_PROOF_FAIL=1
  fi
fi

if [[ "$RP_CERT_PROOF_FAIL" -ne 0 ]]; then
  rp_cert_proof_say ""
  rp_cert_proof_bad "cert proof FAILED"
  exit 1
fi
rp_cert_proof_say ""
rp_cert_proof_ok "cert proof PASSED"
exit 0
