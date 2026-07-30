#!/usr/bin/env bash
# Verify RP dev 3-stage PKI and TLS secrets before bootstrap.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=lib/rp-dev-ca.sh
source "$SCRIPT_DIR/lib/rp-dev-ca.sh"
# shellcheck source=lib/kafka-broker-sans.sh
source "$SCRIPT_DIR/lib/kafka-broker-sans.sh"
# shellcheck source=lib/rp-service-cert-contract.sh
source "$SCRIPT_DIR/lib/rp-service-cert-contract.sh"

NS="${HOUSING_NS:-record-platform}"
REPLICAS="${KAFKA_BROKER_REPLICAS:-3}"
FAIL=0

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
bad() { echo "❌ $*"; FAIL=1; }

check_leaf_chain() {
  local label="$1" pem="$2"
  if [[ ! -f "$pem" ]]; then
    bad "$label missing: $pem"
    return
  fi
  if rp_dev_forbidden_in_cert "$pem"; then
    bad "$label contains forbidden SAN/subject (RP/localhost/127.0.0.1)"
    return
  fi
  if rp_dev_verify_leaf_chain "$pem" | grep -q ': OK'; then
    ok "$label: openssl verify leaf → intermediate → root"
  else
    bad "$label chain verify failed"
    rp_dev_verify_leaf_chain "$pem" || true
  fi
}

check_eku() {
  local label="$1" pem="$2" want="$3"
  local text
  text="$(openssl x509 -in "$pem" -noout -text 2>/dev/null || true)"
  case "$want" in
    serverAuth)
      echo "$text" | grep -q "TLS Web Server Authentication" || { bad "$label missing serverAuth"; return; }
      echo "$text" | grep -q "TLS Web Client Authentication" && { bad "$label must not have clientAuth"; return; }
      ;;
    clientAuth)
      echo "$text" | grep -q "TLS Web Client Authentication" || { bad "$label missing clientAuth"; return; }
      ;;
    serverAndClient)
      echo "$text" | grep -q "TLS Web Server Authentication" || { bad "$label missing serverAuth"; return; }
      echo "$text" | grep -q "TLS Web Client Authentication" || { bad "$label missing clientAuth"; return; }
      ;;
  esac
  ok "$label EKU ($want)"
}

say "=== RP cert chain verifier ==="

for f in "$(rp_dev_root_pem)" "$(rp_dev_root_key)" "$(rp_dev_intermediate_pem)" "$(rp_dev_intermediate_key)"; do
  [[ -f "$f" ]] || { bad "missing $f"; continue; }
  ok "present $(basename "$f")"
done

check_leaf_chain "edge" "$(rp_dev_certs_dir)/record-platform.test.crt"
check_eku "edge" "$(rp_dev_certs_dir)/record-platform.test.crt" serverAuth
if openssl x509 -in "$(rp_dev_certs_dir)/record-platform.test.crt" -noout -text | grep -q 'DNS:record-platform.test'; then
  ok "edge SAN includes DNS:record-platform.test"
else
  bad "edge SAN missing DNS:record-platform.test"
fi

while IFS= read -r cn; do
  [[ -n "$cn" ]] || continue
  check_leaf_chain "$cn" "$(rp_dev_certs_dir)/${cn}.crt"
  check_eku "$cn" "$(rp_dev_certs_dir)/${cn}.crt" serverAndClient
done < <(rp_cert_contract_mtls_services)

check_leaf_chain "envoy-client" "$(rp_dev_certs_dir)/envoy-client.crt"
check_eku "envoy-client" "$(rp_dev_certs_dir)/envoy-client.crt" clientAuth

KAFKA_SSL="${REPO_ROOT}/certs/kafka-ssl"
CLIENT_CRT="${KAFKA_SSL}/client.crt"
BROKER_PEM="${KAFKA_SSL}/kafka-broker.pem"
if [[ "${RP_REQUIRE_KAFKA_SSL:-0}" == "1" ]] || [[ -f "$CLIENT_CRT" ]] || [[ -f "$BROKER_PEM" ]]; then
  if [[ -f "$CLIENT_CRT" ]]; then
    check_leaf_chain "kafka-client" "$CLIENT_CRT"
    check_eku "kafka-client" "$CLIENT_CRT" clientAuth
  else
    bad "missing $CLIENT_CRT (run kafka-ssl-from-dev-root.sh)"
  fi
else
  ok "kafka-ssl/client.crt not yet (deferred until kafka-ssl-from-dev-root.sh after MetalLB)"
fi

if [[ -f "$BROKER_PEM" ]]; then
  check_leaf_chain "kafka-broker" "$BROKER_PEM"
  check_eku "kafka-broker" "$BROKER_PEM" serverAndClient
  while IFS= read -r spec; do
    [[ -z "$spec" ]] && continue
    kind="${spec%%|*}"
    token="${spec#*|}"
    if [[ "$kind" == "exact" ]]; then
      openssl x509 -in "$BROKER_PEM" -noout -text | grep -qE "DNS:${token}([^a-zA-Z0-9.-]|$)" || bad "kafka broker missing exact SAN: $token"
    else
      openssl x509 -in "$BROKER_PEM" -noout -text | grep -q "DNS:${token}" || bad "kafka broker missing SAN: $token"
    fi
  done < <(rp_kafka_emit_san_verify_dns_specs "$NS" "$REPLICAS")
  ok "kafka broker has required broker DNS SANs"
elif [[ "${RP_REQUIRE_KAFKA_SSL:-0}" == "1" ]]; then
  bad "missing $BROKER_PEM (run kafka-ssl-from-dev-root.sh)"
else
  ok "kafka-ssl/kafka-broker.pem not yet (deferred until kafka-ssl-from-dev-root.sh)"
fi

if [[ "${RP_SKIP_K8S_VERIFY:-0}" == "1" ]]; then
  ok "Kubernetes TLS secrets skipped (RP_SKIP_K8S_VERIFY=1; run after strict-tls-bootstrap / kafka-ssl-from-dev-root)"
  if [[ "$FAIL" -eq 0 ]]; then
    say "=== RP cert chain verification PASSED ==="
    exit 0
  fi
  say "=== RP cert chain verification FAILED ==="
  exit 1
fi

say "Kubernetes TLS secrets"
for ns_secret in "ingress-nginx/record-platform-local-tls" "record-platform/record-platform-local-tls" "record-platform/kafka-ssl-secret"; do
  ns="${ns_secret%%/*}"
  sec="${ns_secret#*/}"
  if kubectl get secret "$sec" -n "$ns" --request-timeout=10s >/dev/null 2>&1; then
    ok "secret $ns/$sec exists"
  elif [[ "$sec" == "kafka-ssl-secret" ]] && [[ "${RP_REQUIRE_KAFKA_SSL:-0}" != "1" ]]; then
    ok "secret $ns/$sec not yet (kafka-ssl-from-dev-root.sh after cluster/MetalLB)"
  else
    bad "secret $ns/$sec missing (run strict-tls-bootstrap.sh + kafka-ssl-from-dev-root.sh)"
  fi
done

if [[ "$FAIL" -eq 0 ]]; then
  say "=== RP cert chain verification PASSED ==="
  exit 0
fi
say "=== RP cert chain verification FAILED ==="
exit 1
