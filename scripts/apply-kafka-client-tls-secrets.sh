#!/usr/bin/env bash
# Apply dedicated kafka-client-tls-<service> Secrets from certs/kafka-client/<service>/.
# Does not touch service-tls-* or kafka-ssl-secret.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib/rp-pki-generation.sh
source "$SCRIPT_DIR/lib/rp-pki-generation.sh"

NS="${KAFKA_CLIENT_TLS_NS:-record-platform}"
OUT_ROOT="${REPO_ROOT}/certs/kafka-client"

SERVICES=(
  analytics-service
  auction-monitor
  auth-service
  listings-service
  media-service
  messaging-service
  notification-service
  python-ai-service
  shopping-service
  trust-service
  ollama-gateway
  ollama-worker
)

ok() { echo "✅ $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

[[ -d "$OUT_ROOT" ]] || fail "missing ${OUT_ROOT}; run scripts/generate-kafka-client-service-tls.sh first"
kubectl get ns "$NS" >/dev/null 2>&1 || fail "namespace ${NS} missing"

applied=0
for svc in "${SERVICES[@]}"; do
  dir="${OUT_ROOT}/${svc}"
  secret="kafka-client-tls-${svc}"
  [[ -f "${dir}/tls.crt" && -f "${dir}/tls.key" && -f "${dir}/ca-chain.pem" ]] \
    || fail "incomplete material for ${svc}"

  kubectl -n "$NS" create secret generic "$secret" \
    --from-file=tls.crt="${dir}/tls.crt" \
    --from-file=tls.key="${dir}/tls.key" \
    --from-file=ca-chain.pem="${dir}/ca-chain.pem" \
    --from-file=ca.crt="${dir}/ca-chain.pem" \
    --from-file=leaf.crt="${dir}/leaf.crt" \
    --dry-run=client -o yaml | kubectl apply -f -

  kubectl -n "$NS" label secret "$secret" --overwrite \
    "app.kubernetes.io/part-of=record-platform" \
    "rp.dev/kafka-client-tls=true" \
    "rp.dev/service=${svc}" >/dev/null

  kubectl -n "$NS" annotate secret "$secret" --overwrite \
    "rp.dev/trust-boundary=dedicated-kafka-client" \
    "rp.dev/eku=clientAuth" \
    "rp.dev/spiffe=spiffe://record-platform/service/${svc}" >/dev/null

  rp_annotate_secret_pki_generation "$NS" "$secret" || true
  applied=$((applied + 1))
  ok "applied ${NS}/${secret}"
done

echo "applied=${applied}/12"
[[ "$applied" -eq 12 ]] || fail "expected 12 secrets"
