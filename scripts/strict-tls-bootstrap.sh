# file: scripts/strict-tls-bootstrap.sh  (re-run to ensure secrets exist in BOTH namespaces)
#!/usr/bin/env bash
set -euo pipefail
# Run from repo root. dev-root.pem, record-platform.test.crt, record-platform.test.key must be in ./certs/
# For Envoy→backend mTLS we also need a dedicated Envoy client cert (CN=envoy). Generate with:
#   KAFKA_SSL=1 ./scripts/reissue-ca-and-leaf-load-all-services.sh   # persists certs/dev-root.key
#   ./scripts/generate-envoy-client-cert.sh                         # creates certs/envoy-client.crt|.key
# After this script: Envoy presents the Envoy client cert to gRPC backends (not the edge leaf).
# If you see "upstream connect error or disconnect/reset before headers. reset reason: remote connection failure",
# ensure envoy-client-tls exists and Envoy deploy uses it (envoy.crt/envoy.key).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"
# shellcheck source=lib/rp-pki-generation.sh
source "$SCRIPT_DIR/lib/rp-pki-generation.sh"
# shellcheck source=lib/rp-apply-service-mtls-secrets.sh
source "$SCRIPT_DIR/lib/rp-apply-service-mtls-secrets.sh"

# Caddy terminates TLS at the edge; record-platform-local-tls is the leaf cert.
for ns in ingress-nginx record-platform; do
  kubectl -n "$ns" delete secret record-platform-local-tls --ignore-not-found
  kubectl -n "$ns" create secret tls record-platform-local-tls \
    --cert=certs/record-platform.test.crt --key=certs/record-platform.test.key
  rp_annotate_secret_pki_generation "$ns" record-platform-local-tls
done
kubectl -n ingress-nginx create secret generic dev-root-ca \
  --from-file=dev-root.pem=certs/dev-root.pem \
  -o yaml --dry-run=client | kubectl apply -f -
rp_annotate_secret_pki_generation ingress-nginx dev-root-ca
kubectl -n record-platform create secret generic dev-root-ca \
  --from-file=dev-root.pem=certs/dev-root.pem \
  -o yaml --dry-run=client | kubectl apply -f -
rp_annotate_secret_pki_generation record-platform dev-root-ca
# Contract-driven per-service mTLS + bundle + edge aliases.
rp_apply_service_mtls_secrets record-platform
kubectl create namespace envoy-test --dry-run=client -o yaml | kubectl apply -f -
kubectl -n envoy-test create secret generic dev-root-ca \
  --from-file=dev-root.pem=certs/dev-root.pem \
  -o yaml --dry-run=client | kubectl apply -f -
rp_annotate_secret_pki_generation envoy-test dev-root-ca
# Envoy uses a dedicated client cert (CN=envoy), not the edge leaf, so backends see a proper client identity.
if [[ -f certs/envoy-client.crt ]] && [[ -f certs/envoy-client.key ]]; then
  kubectl -n envoy-test delete secret envoy-client-tls --ignore-not-found
  kubectl -n envoy-test create secret generic envoy-client-tls \
    --from-file=envoy.crt=certs/envoy-client.crt \
    --from-file=envoy.key=certs/envoy-client.key
  rp_annotate_secret_pki_generation envoy-test envoy-client-tls
  echo "Envoy client secret envoy-client-tls created (CN=envoy)."
else
  echo "⚠️  certs/envoy-client.crt or certs/envoy-client.key missing. Run: KAFKA_SSL=1 ./scripts/reissue-ca-and-leaf-load-all-services.sh then ./scripts/generate-envoy-client-cert.sh"
  if kubectl -n envoy-test get secret envoy-client-tls &>/dev/null; then
    echo "   (envoy-client-tls already exists in cluster; Envoy may still work.)"
  else
    echo "   Envoy deploy expects envoy-client-tls; create the cert and re-run this script."
    exit 1
  fi
fi

# Restart Envoy so it mounts envoy-client-tls and presents the Envoy client cert to gRPC backends.
if kubectl get deployment envoy-test -n envoy-test &>/dev/null; then
  kubectl -n envoy-test rollout restart deployment/envoy-test
  kubectl -n envoy-test rollout status deployment/envoy-test --timeout=90s || true
  echo "Envoy restarted (mTLS client cert CN=envoy will be used for upstream connections)."
fi