#!/usr/bin/env bash
# Canonical writer for record-platform/kafka-ssl-secret (disk → secret + rp.dev annotation).
# Only this script may set rp.dev/ca-fingerprint-sha256 on kafka-ssl-secret.
#
# Prereq: certs/kafka-ssl/* from kafka-ssl-from-dev-root.sh (KAFKA_SSL_SKIP_K8S_SECRET=1).
# Usage: HOUSING_NS=record-platform bash scripts/apply-rp-kafka-ssl-secret.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="${SCRIPT_DIR}/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
cd "$REPO_ROOT"

NS="${HOUSING_NS:-record-platform}"
OUT="${REPO_ROOT}/certs/kafka-ssl"
TMP="${REPO_ROOT}/.kafka-ssl-secret-apply.$$"
export RP_LAST_KAFKA_SSL_SECRET_WRITER="scripts/apply-rp-kafka-ssl-secret.sh"

# shellcheck source=lib/rp-kafka-ssl-fingerprint.sh
source "$SCRIPT_DIR/lib/rp-kafka-ssl-fingerprint.sh"
# shellcheck source=lib/rp-pki-generation.sh
source "$SCRIPT_DIR/lib/rp-pki-generation.sh"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
die() { echo "❌ $*" >&2; exit 1; }

command -v kubectl >/dev/null 2>&1 || die "kubectl required"
[[ -f "$OUT/ca-cert.pem" ]] || die "missing $OUT/ca-cert.pem — run kafka-ssl-from-dev-root.sh first"

ctx="$(kubectl config current-context 2>/dev/null || echo "")"
kctl() {
  if [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
    colima ssh -- kubectl --request-timeout=25s "$@" 2>/dev/null || colima ssh -- kubectl --request-timeout=25s "$@"
  else
    kubectl --request-timeout=25s "$@" 2>/dev/null || kubectl --request-timeout=25s "$@"
  fi
}

_disk_fp="$(rp_kafka_ssl_ca_fingerprint "$OUT/ca-cert.pem")"
[[ -n "$_disk_fp" ]] || die "could not fingerprint disk ca-cert.pem"

mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT

say "apply-rp-kafka-ssl-secret (ns=$NS) — disk CA fingerprint ${_disk_fp}"

kubectl create namespace "$NS" --dry-run=client -o yaml 2>/dev/null | kubectl apply -f - --request-timeout=20s 2>/dev/null || true

for f in kafka.keystore.jks kafka.truststore.jks kafka.keystore-password kafka.truststore-password \
  kafka.key-password kafka-broker.pem kafka-broker.key ca-cert.pem ca.crt client.crt client.key; do
  [[ -f "$OUT/$f" ]] || die "missing $OUT/$f"
done

_yaml="${TMP}/kafka-ssl-secret.yaml"
kubectl create secret generic kafka-ssl-secret -n "$NS" \
  --from-file=kafka.keystore.jks="$OUT/kafka.keystore.jks" \
  --from-file=kafka.truststore.jks="$OUT/kafka.truststore.jks" \
  --from-file=kafka.keystore-password="$OUT/kafka.keystore-password" \
  --from-file=kafka.truststore-password="$OUT/kafka.truststore-password" \
  --from-file=kafka.key-password="$OUT/kafka.key-password" \
  --from-file=kafka-broker.pem="$OUT/kafka-broker.pem" \
  --from-file=kafka-broker.key="$OUT/kafka-broker.key" \
  --from-file=ca-cert.pem="$OUT/ca-cert.pem" \
  --from-file=ca.crt="$OUT/ca.crt" \
  --from-file=client.crt="$OUT/client.crt" \
  --from-file=client.key="$OUT/client.key" \
  --dry-run=client -o yaml >"$_yaml"

if ! kubectl apply -f "$_yaml" --request-timeout=30s 2>/dev/null; then
  if [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
    colima ssh -- env KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl apply -f "$_yaml" --request-timeout=30s \
      || die "kubectl apply kafka-ssl-secret failed"
  else
    die "kubectl apply kafka-ssl-secret failed"
  fi
fi
ok "kafka-ssl-secret data applied from $OUT"

kctl annotate secret kafka-ssl-secret -n "$NS" "rp.dev/ca-fingerprint-sha256-" --overwrite 2>/dev/null || true
kctl annotate secret kafka-ssl-secret -n "$NS" \
  "rp.dev/ca-fingerprint-sha256=${_disk_fp}" \
  "rp.dev/last-writer=${RP_LAST_KAFKA_SSL_SECRET_WRITER}" \
  --overwrite || die "failed to annotate kafka-ssl-secret"

rp_annotate_secret_pki_generation "$NS" kafka-ssl-secret

if ! rp_kafka_ssl_verify_triple_match "$NS" "$OUT/ca-cert.pem"; then
  die "post-apply fingerprint mismatch (disk / secret / annotation) — Recovery: bash scripts/kafka-refresh-tls-from-lb.sh"
fi
ok "disk ca-cert.pem == secret ca-cert.pem == rp.dev/ca-fingerprint-sha256 (${_disk_fp})"
