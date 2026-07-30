#!/usr/bin/env bash
# Regression: Kafka TLS material must match RP 3-stage PKI (no separate CA, no rp.dev drift).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=lib/rp-dev-ca.sh
source "$SCRIPT_DIR/lib/rp-dev-ca.sh"
# shellcheck source=lib/rp-kafka-ssl-fingerprint.sh
source "$SCRIPT_DIR/lib/rp-kafka-ssl-fingerprint.sh"

NS="${HOUSING_NS:-record-platform}"
KAFKA_SSL="${REPO_ROOT}/certs/kafka-ssl"
FAIL=0

die() { echo "❌ $*" >&2; FAIL=1; }
ok() { echo "✅ $*"; }

_check_leaf() {
  local label="$1" pem="$2"
  [[ -f "$pem" ]] || { die "missing $pem"; return; }
  if rp_dev_verify_leaf_chain "$pem" 2>&1 | grep -q ': OK$'; then
    ok "$label verifies (leaf → intermediate → root)"
  else
    die "$label does not verify against dev-chain.pem"
    rp_dev_verify_leaf_chain "$pem" 2>&1 || true
  fi
}

_check_eku() {
  local label="$1" pem="$2" want="$3"
  local text
  text="$(openssl x509 -in "$pem" -noout -text 2>/dev/null || true)"
  case "$want" in
    clientAuth)
      echo "$text" | grep -q "TLS Web Client Authentication" || die "$label missing clientAuth EKU"
      echo "$text" | grep -q "TLS Web Server Authentication" && die "$label must not have serverAuth EKU"
      ;;
    serverAndClient)
      echo "$text" | grep -q "TLS Web Server Authentication" || die "$label missing serverAuth EKU"
      echo "$text" | grep -q "TLS Web Client Authentication" || die "$label missing clientAuth EKU"
      ;;
  esac
  ok "$label EKU ($want)"
}

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

say "=== rp-verify-kafka-cert-chain ==="

for f in dev-root.pem dev-intermediate.pem dev-chain.pem; do
  [[ -f "$(rp_dev_certs_dir)/$f" ]] || die "missing certs/$f"
done

_check_leaf "kafka client" "$KAFKA_SSL/client.crt"
_check_eku "kafka client" "$KAFKA_SSL/client.crt" clientAuth

_check_leaf "kafka broker" "$KAFKA_SSL/kafka-broker.pem"
_check_eku "kafka broker" "$KAFKA_SSL/kafka-broker.pem" serverAndClient

[[ -f "$KAFKA_SSL/ca-cert.pem" ]] || die "missing ca-cert.pem"
if ! cmp -s "$KAFKA_SSL/ca-cert.pem" "$(rp_dev_chain_pem)"; then
  die "ca-cert.pem must equal certs/dev-chain.pem (full chain, not root-only)"
fi
ok "ca-cert.pem matches dev-chain.pem"

if [[ -L "$KAFKA_SSL/dev-chain.pem" ]] || [[ -f "$KAFKA_SSL/dev-chain.pem" ]]; then
  ok "kafka-ssl/dev-chain.pem present"
else
  die "missing kafka-ssl/dev-chain.pem symlink"
fi

KAFKA_KEYSTORE_PATH="$KAFKA_SSL/kafka.keystore.jks" \
  KAFKA_KEYSTORE_PASSWORD_FILE="$KAFKA_SSL/kafka.keystore-password" \
  REPO_ROOT="$REPO_ROOT" \
  bash "$SCRIPT_DIR/verify-kafka-broker-keystore-jks.sh" || FAIL=1

if command -v kubectl >/dev/null 2>&1 && kubectl get secret kafka-ssl-secret -n "$NS" &>/dev/null; then
  _rp_ann="$(kubectl get secret kafka-ssl-secret -n "$NS" -o jsonpath='{.metadata.annotations.och\.dev/ca-fingerprint-sha256}' 2>/dev/null || true)"
  [[ -z "$_rp_ann" ]] || die "kafka-ssl-secret still has rp.dev/ca-fingerprint-sha256 annotation"
  if [[ "${RP_VERIFY_KAFKA_SKIP_SECRET_ANNOTATION:-0}" != "1" ]]; then
    if rp_kafka_ssl_verify_triple_match "$NS" "$KAFKA_SSL/ca-cert.pem"; then
      ok "kafka-ssl-secret: disk ca-cert.pem == secret data == rp.dev annotation"
    else
      die "kafka-ssl-secret fingerprint triple mismatch — Recovery: bash scripts/kafka-refresh-tls-from-lb.sh"
    fi
  else
    ok "kafka-ssl-secret cluster check skipped (B.crypto disk-only; annotation applied in F.kafka_alignment)"
  fi
  if kubectl get secret rp-kafka-ssl-secret -n "$NS" &>/dev/null 2>&1; then
    die "rp-kafka-ssl-secret must not exist in namespace $NS"
  fi
elif [[ "${RP_VERIFY_KAFKA_SKIP_SECRET_ANNOTATION:-0}" != "1" ]]; then
  echo "ℹ️  kafka-ssl-secret not in cluster yet (expected before F.kafka_alignment / apply-rp-kafka-ssl-secret.sh)"
fi

bash "$SCRIPT_DIR/rp-audit-kafka-ssl-secret-writers.sh" || FAIL=1

_hits="$(grep -rl 'rp-kafka-ssl-secret' "$REPO_ROOT/scripts" "$REPO_ROOT/infra" 2>/dev/null \
  | grep -vE 'rp-verify-kafka-cert-chain|rp-verify-kustomize-app-services|print-rp-cert-proof|verify-bootstrap-state|cluster_health|package-|toolkit-reference|dev-onboard|apply-och|rollout-restart-och|check-rp-hybrid-cold-bootstrap-toolkit|README\.md' || true)"
if [[ -n "$_hits" ]]; then
  die "rp-kafka-ssl-secret still referenced in active paths: $_hits"
else
  ok "no rp-kafka-ssl-secret in active bootstrap scripts/manifests"
fi

if [[ "$FAIL" -ne 0 ]]; then
  say "=== rp-verify-kafka-cert-chain FAILED ==="
  exit 1
fi
say "=== rp-verify-kafka-cert-chain PASSED ==="
