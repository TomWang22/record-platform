#!/usr/bin/env bash
# Fail if any generated cert/key is stale relative to certs/.rp-pki-generation-id,
# or K8s secret annotations don't match, or old fingerprints survive.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=lib/rp-dev-ca.sh
source "$SCRIPT_DIR/lib/rp-dev-ca.sh"
# shellcheck source=lib/rp-service-cert-contract.sh
source "$SCRIPT_DIR/lib/rp-service-cert-contract.sh"

NS="${HOUSING_NS:-record-platform}"
CERTS="$(rp_dev_certs_dir)"
FAIL=0

bad() { echo "❌ $*" >&2; FAIL=1; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*" >&2; }

echo "audit-rp-no-stale-pki"
echo ""

GEN_ID_FILE="$CERTS/.rp-pki-generation-id"
[[ -f "$GEN_ID_FILE" ]] || { bad "missing $GEN_ID_FILE"; exit 1; }
EXPECTED_GEN_ID="$(cat "$GEN_ID_FILE")"
GEN_ID_MTIME="$(stat -f %m "$GEN_ID_FILE" 2>/dev/null || stat -c %Y "$GEN_ID_FILE" 2>/dev/null || echo 0)"
echo "  generation-id: $EXPECTED_GEN_ID"
echo "  marker mtime: $GEN_ID_MTIME"
echo ""

echo "=== Disk mtime checks ==="
_check_not_older() {
  local label="$1" path="$2"
  [[ -f "$path" ]] || return 0
  local fmtime
  fmtime="$(stat -f %m "$path" 2>/dev/null || stat -c %Y "$path" 2>/dev/null || echo 0)"
  if [[ "$fmtime" -lt "$GEN_ID_MTIME" ]]; then
    bad "$label ($path) is older than generation-id marker"
  fi
}

_check_not_older "dev-root.pem" "$CERTS/dev-root.pem"
_check_not_older "dev-intermediate.pem" "$CERTS/dev-intermediate.pem"
_check_not_older "dev-chain.pem" "$CERTS/dev-chain.pem"
_check_not_older "edge cert" "$CERTS/record-platform.test.crt"
_check_not_older "envoy-client" "$CERTS/envoy-client.crt"

while IFS= read -r svc; do
  [[ -n "$svc" ]] || continue
  _check_not_older "$svc cert" "$CERTS/${svc}.crt"
  _check_not_older "$svc key" "$CERTS/${svc}.key"
done < <(rp_cert_contract_mtls_services)

for f in "$CERTS/kafka-ssl/kafka-broker.pem" "$CERTS/kafka-ssl/client.crt" \
         "$CERTS/kafka-ssl/kafka.keystore.jks" "$CERTS/kafka-ssl/kafka.truststore.jks"; do
  _check_not_older "kafka $(basename "$f")" "$f"
done
ok "no disk certs older than generation-id marker"

echo ""
echo "=== Issuer checks (all leaves signed by current intermediate) ==="
INT_SUBJECT="$(openssl x509 -in "$CERTS/dev-intermediate.pem" -noout -subject 2>/dev/null | sed 's/^subject=//' || true)"
_check_leaf_issuer() {
  local label="$1" crt="$2"
  [[ -f "$crt" ]] || return 0
  local iss
  iss="$(openssl x509 -in "$crt" -noout -issuer 2>/dev/null | sed 's/^issuer=//' || true)"
  if [[ "$iss" != "$INT_SUBJECT" ]]; then
    bad "$label issuer mismatch (expected current intermediate)"
  fi
}
_check_leaf_issuer "edge" "$CERTS/record-platform.test.crt"
_check_leaf_issuer "envoy-client" "$CERTS/envoy-client.crt"
while IFS= read -r svc; do
  [[ -n "$svc" ]] || continue
  _check_leaf_issuer "$svc" "$CERTS/${svc}.crt"
done < <(rp_cert_contract_mtls_services)
_check_leaf_issuer "kafka-broker" "$CERTS/kafka-ssl/kafka-broker.pem"
_check_leaf_issuer "kafka-client" "$CERTS/kafka-ssl/client.crt"
ok "all leaf issuers match current intermediate"

echo ""
echo "=== K8s generation-id annotation checks ==="
if ! kubectl cluster-info --request-timeout=5s >/dev/null 2>&1; then
  warn "cluster not up; skipping K8s generation-id checks"
else
  _check_k8s_gen() {
    local ns="$1" name="$2"
    if ! kubectl get secret "$name" -n "$ns" >/dev/null 2>&1; then
      return 0
    fi
    local ann
    ann="$(kubectl get secret "$name" -n "$ns" -o jsonpath='{.metadata.annotations.rp\.dev/pki-generation-id}' 2>/dev/null || true)"
    if [[ "$ann" != "$EXPECTED_GEN_ID" ]]; then
      bad "secret/$name (ns=$ns) generation-id='${ann:-<none>}' != expected '$EXPECTED_GEN_ID'"
    fi
  }

  for _ns in "$NS" ingress-nginx; do
    _check_k8s_gen "$_ns" record-platform-local-tls
    _check_k8s_gen "$_ns" dev-root-ca
  done
  _check_k8s_gen "$NS" service-tls
  _check_k8s_gen "$NS" edge-service-tls
  _check_k8s_gen "$NS" "$(rp_cert_contract_bundle_secret_name)"

  while IFS= read -r svc; do
    [[ -n "$svc" ]] || continue
    _check_k8s_gen "$NS" "$(rp_cert_contract_per_service_secret_name "$svc")"
  done < <(rp_cert_contract_mtls_services)

  ok "all K8s TLS secret generation-ids match"

  echo ""
  echo "=== K8s fingerprint match (disk vs secret) ==="
  _disk_fp() {
    openssl x509 -in "$1" -noout -fingerprint -sha256 2>/dev/null | sed 's/^.*=//' || true
  }
  _k8s_leaf_fp() {
    local ns="$1" name="$2"
    kubectl get secret "$name" -n "$ns" -o jsonpath='{.data.tls\.crt}' 2>/dev/null \
      | base64 -d 2>/dev/null \
      | awk '/BEGIN CERTIFICATE/{on=1} on{print} /END CERTIFICATE/{exit}' \
      | openssl x509 -noout -fingerprint -sha256 2>/dev/null | sed 's/^.*=//' || true
  }

  EDGE_DISK_FP="$(_disk_fp "$CERTS/record-platform.test.crt")"
  for _ns in "$NS" ingress-nginx; do
    K8S_FP="$(_k8s_leaf_fp "$_ns" record-platform-local-tls)"
    if [[ -n "$K8S_FP" && "$K8S_FP" != "$EDGE_DISK_FP" ]]; then
      bad "record-platform-local-tls ($NS) fingerprint mismatch (disk=$EDGE_DISK_FP k8s=$K8S_FP)"
    fi
  done

  while IFS= read -r svc; do
    [[ -n "$svc" ]] || continue
    sec="$(rp_cert_contract_per_service_secret_name "$svc")"
    DISK_FP="$(_disk_fp "$CERTS/${svc}.crt")"
    K8S_FP="$(_k8s_leaf_fp "$NS" "$sec")"
    if [[ -n "$K8S_FP" && "$K8S_FP" != "$DISK_FP" ]]; then
      bad "secret/$sec fingerprint mismatch (disk=$DISK_FP k8s=$K8S_FP)"
    fi
  done < <(rp_cert_contract_mtls_services)
  ok "disk/K8s cert fingerprints match"

  echo ""
  echo "=== Negative checks ==="
  if kubectl get secret service-tls-webapp -n "$NS" >/dev/null 2>&1; then
    bad "service-tls-webapp exists (webapp must not have mTLS leaf)"
  else
    ok "no service-tls-webapp"
  fi
fi

echo ""
if [[ "$FAIL" -eq 0 ]]; then
  echo "✅ audit-rp-no-stale-pki passed (generation=$EXPECTED_GEN_ID)"
  exit 0
fi
echo "❌ audit-rp-no-stale-pki failed" >&2
exit 1
