#!/usr/bin/env bash
# Repair: annotate all existing PKI secrets with generation-id from certs/.rp-pki-generation-id.
# Does NOT recreate certs or restart deployments — annotation-only repair.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=lib/rp-pki-generation.sh
source "$SCRIPT_DIR/lib/rp-pki-generation.sh"
# shellcheck source=lib/rp-service-cert-contract.sh
source "$SCRIPT_DIR/lib/rp-service-cert-contract.sh"

NS="${HOUSING_NS:-record-platform}"

say() { printf '\033[1m▶ %s\033[0m\n' "$*"; }
ok()  { echo "✅ $*"; }
die() { echo "❌ $*" >&2; exit 1; }

GEN_ID="$(rp_pki_generation_id)" || die "cannot determine generation-id"
echo "rp-reannotate-pki-secrets — generation-id=$GEN_ID"
echo ""

_ann() {
  local ns="$1" name="$2"
  if kubectl get secret "$name" -n "$ns" >/dev/null 2>&1; then
    rp_annotate_secret_pki_generation "$ns" "$name"
    echo "  annotated secret/$name (ns=$ns)"
  fi
}

say "Per-service mTLS secrets"
while IFS= read -r svc; do
  [[ -n "$svc" ]] || continue
  _ann "$NS" "$(rp_cert_contract_per_service_secret_name "$svc")"
done < <(rp_cert_contract_mtls_services)

say "Bundle secret"
_ann "$NS" "$(rp_cert_contract_bundle_secret_name)"

say "Edge + legacy secrets"
_ann "$NS" service-tls
_ann "$NS" edge-service-tls

say "Edge TLS (ingress-nginx + record-platform)"
for _ns in ingress-nginx "$NS"; do
  _ann "$_ns" record-platform-local-tls
  _ann "$_ns" dev-root-ca
done

say "Envoy"
_ann envoy-test dev-root-ca
_ann envoy-test envoy-client-tls

say "Kafka"
_ann "$NS" kafka-ssl-secret

echo ""
ok "rp-reannotate-pki-secrets done (generation=$GEN_ID)"

say "Running audit-rp-k8s-service-tls-secrets.sh..."
bash "$SCRIPT_DIR/audit-rp-k8s-service-tls-secrets.sh"
