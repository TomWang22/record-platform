#!/usr/bin/env bash
# B.crypto — self-contained 3-stage PKI + Kafka TLS + K8s TLS secrets (cold-bootstrap owns full sequence).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
HOUSING_NS="${HOUSING_NS:-record-platform}"

# shellcheck source=lib/rp-bootstrap-trust-mode.sh
source "$SCRIPT_DIR/lib/rp-bootstrap-trust-mode.sh"

step() {
  [[ "${RP_CRYPTO_SUPPRESS_STEPS:-0}" == "1" ]] && return 0
  printf '\n\033[1m▶ %s\033[0m\n' "$*"
}
ok() { echo "✅ $*"; }
die() { echo "❌ $*" >&2; exit 1; }

rp_bootstrap_print_trust_banner

# --- Generation ID (unique per B.crypto run) ---
RP_PKI_GENERATION_ID="${RP_PKI_GENERATION_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 4)}"
RP_PKI_GENERATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
export RP_PKI_GENERATION_ID RP_PKI_GENERATED_AT

step "B.crypto 0/11 — destructive PKI reset"
RP_CRYPTO_RESET="${RP_CRYPTO_RESET:-1}"
if [[ "$RP_CRYPTO_RESET" == "1" ]]; then
  chmod +x "$SCRIPT_DIR/rp-reset-dev-pki.sh" 2>/dev/null || true
  bash "$SCRIPT_DIR/rp-reset-dev-pki.sh" || die "rp-reset-dev-pki.sh failed"
  ok "destructive PKI reset complete"
else
  echo "  ℹ️  RP_CRYPTO_RESET=0 — skipping destructive reset"
fi

# Write generation-id + timestamp markers early so all certs generated after are newer by mtime
mkdir -p "$REPO_ROOT/certs"
printf '%s' "$RP_PKI_GENERATION_ID" > "$REPO_ROOT/certs/.rp-pki-generation-id"
printf '%s' "$RP_PKI_GENERATED_AT" > "$REPO_ROOT/certs/.rp-pki-generated-at"
ok "certs/.rp-pki-generation-id = $RP_PKI_GENERATION_ID (written before cert generation)"

step "B.crypto 1/11 — prepare Kafka dirs"
rm -rf "${REPO_ROOT}/certs/kafka-ssl" "${REPO_ROOT}/certs/kafka-dev"
mkdir -p "${REPO_ROOT}/certs/kafka-ssl" "${REPO_ROOT}/certs/kafka-dev"

step "B.crypto 2/11 — dev-generate-certs.sh (root → intermediate → service + edge leaves)"
export RP_DEV_CERTS_FORCE="${RP_DEV_CERTS_FORCE:-1}"
bash "$SCRIPT_DIR/dev-generate-certs.sh" || die "dev-generate-certs.sh failed"
ok "3-stage anchors + contract-driven service mTLS leaves + edge leaf"

step "B.crypto 3/11 — generate-envoy-client-cert.sh"
bash "$SCRIPT_DIR/generate-envoy-client-cert.sh" || die "generate-envoy-client-cert.sh failed"
ok "envoy-client.crt (clientAuth, intermediate-signed)"

step "B.crypto 4/11 — kafka-ssl-from-dev-root.sh (disk PEM/JKS)"
export KAFKA_SSL_NS="$HOUSING_NS"
export KAFKA_SSL_AUTO_METALLB_IPS=0
export KAFKA_SSL_SKIP_K8S_SECRET=1
bash "$SCRIPT_DIR/kafka-ssl-from-dev-root.sh" || die "kafka-ssl-from-dev-root.sh failed"
ok "kafka-ssl disk material"

step "B.crypto 5/11 — verify generation-id marker"
ok "certs/.rp-pki-generation-id = $RP_PKI_GENERATION_ID"

step "B.crypto 6/11 — audit-rp-cert-coverage.sh (3-stage chain proof)"
bash "$SCRIPT_DIR/audit-rp-cert-coverage.sh" || die "audit-rp-cert-coverage.sh failed"
ok "3-stage cert coverage verified"

step "B.crypto 7/11 — print-rp-cert-proof.sh"
bash "$SCRIPT_DIR/print-rp-cert-proof.sh" || die "print-rp-cert-proof.sh failed"
ok "cert proof transcript PASSED"

step "B.crypto 8/11 — strict-tls-bootstrap.sh (K8s TLS secrets with generation-id)"
for _ns in record-platform ingress-nginx observability envoy-test; do
  kubectl create namespace "$_ns" --dry-run=client -o yaml 2>/dev/null | kubectl apply -f - --request-timeout=20s 2>/dev/null || true
done
bash "$SCRIPT_DIR/strict-tls-bootstrap.sh" || die "strict-tls-bootstrap.sh failed"
ok "per-service + bundle mTLS secrets applied"

step "B.crypto 9/11 — audit-rp-k8s-service-tls-secrets.sh"
if kubectl get ns record-platform --request-timeout=5s >/dev/null 2>&1; then
  bash "$SCRIPT_DIR/audit-rp-k8s-service-tls-secrets.sh" || die "audit-rp-k8s-service-tls-secrets.sh failed"
  ok "K8s service TLS secrets verified"
else
  echo "  ℹ️  cluster API not ready — K8s TLS audit deferred to post F.cluster_deploy"
fi

step "B.crypto 10/11 — Kafka chain regression"
bash "$SCRIPT_DIR/rp-audit-kafka-ssl-secret-writers.sh" || die "kafka-ssl-secret writers audit failed"
RP_VERIFY_KAFKA_SKIP_SECRET_ANNOTATION=1 make -C "$REPO_ROOT" rp-verify-kafka-cert-chain \
  || die "rp-verify-kafka-cert-chain failed"
ok "Kafka chain regression PASSED"

step "B.crypto 11/11 — trust gate scripts (ollama policy + webapp internal calls)"
bash "$SCRIPT_DIR/test-rp-ollama-gate.sh" || die "test-rp-ollama-gate.sh failed"
bash "$SCRIPT_DIR/audit-rp-webapp-internal-calls.sh" || die "audit-rp-webapp-internal-calls.sh failed"
ok "ollama gate policy + webapp TLS policy"

step "B.crypto — compose contract"
bash "$SCRIPT_DIR/rp-verify-compose-contract.sh" || die "rp-verify-compose-contract.sh failed"

echo ""
echo "━━━ B.crypto trust summary ━━━"
echo "  • PKI generation: $RP_PKI_GENERATION_ID (at $RP_PKI_GENERATED_AT)"
echo "  • 3-stage PKI: root → intermediate → leaf (all certPolicy.mtlsServices)"
echo "  • K8s: service-tls-<service> + rp-service-mtls-bundle + edge aliases"
echo "  • webapp: edge TLS only (no service mTLS leaf unless policy changes)"
echo "  • ML trust mode: $(rp_bootstrap_trust_mode_label)"
echo ""
ok "B.crypto complete — bootstrap-native trust gates satisfied"
