#!/usr/bin/env bash
# Destructive PKI reset: wipe all generated cert material from disk and K8s secrets.
# Called at the start of B.crypto unless RP_CRYPTO_RESET=0.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=lib/rp-service-cert-contract.sh
source "$SCRIPT_DIR/lib/rp-service-cert-contract.sh"

NS="${HOUSING_NS:-record-platform}"
say() { printf '\033[1m▶ %s\033[0m\n' "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*" >&2; }

say "rp-reset-dev-pki — destructive disk + K8s PKI wipe"

# --- Disk wipe ---
say "1. Disk PKI wipe"
rm -f certs/dev-root.pem certs/dev-root.key \
     certs/dev-intermediate.pem certs/dev-intermediate.key \
     certs/dev-chain.pem \
     certs/.rp-pki-generation-id 2>/dev/null || true

rm -f certs/*.crt certs/*.key certs/*.csr certs/*.srl 2>/dev/null || true
rm -f certs/envoy-client.crt certs/envoy-client.key 2>/dev/null || true
rm -f certs/record-platform.test.crt certs/record-platform.test.key 2>/dev/null || true
rm -rf certs/kafka-dev certs/kafka-ssl 2>/dev/null || true
mkdir -p certs/kafka-dev certs/kafka-ssl
ok "disk: certs/ wiped (anchors, leaves, kafka, envoy, srl)"

# --- K8s secret wipe (best-effort) ---
say "2. K8s TLS secret wipe"
if ! kubectl cluster-info --request-timeout=5s >/dev/null 2>&1; then
  warn "cluster not up; disk PKI reset only"
  ok "rp-reset-dev-pki done (disk only)"
  exit 0
fi

_delete_secret() {
  local ns="$1" name="$2"
  if kubectl get secret "$name" -n "$ns" >/dev/null 2>&1; then
    kubectl delete secret "$name" -n "$ns" --ignore-not-found 2>/dev/null || true
    echo "  deleted secret/$name in $ns"
  fi
}

for _ns in "$NS" ingress-nginx envoy-test observability; do
  kubectl get ns "$_ns" --request-timeout=3s >/dev/null 2>&1 || continue
  _delete_secret "$_ns" record-platform-local-tls
  _delete_secret "$_ns" dev-root-ca
done

for _name in service-tls edge-service-tls envoy-client-tls rp-service-mtls-bundle kafka-ssl-secret; do
  _delete_secret "$NS" "$_name"
done

while IFS= read -r svc; do
  [[ -n "$svc" ]] || continue
  _sec="$(rp_cert_contract_per_service_secret_name "$svc")"
  _delete_secret "$NS" "$_sec"
done < <(rp_cert_contract_mtls_services)

_delete_secret envoy-test envoy-client-tls
_delete_secret envoy-test dev-root-ca

ok "K8s TLS secrets wiped"
ok "rp-reset-dev-pki done"
