#!/usr/bin/env bash
# Create Kafka broker keystore/truststore and kafka-ssl-secret using dev-root-ca (same CA as Caddy).
# Run after reissue (certs/dev-root.pem and certs/dev-root.key must exist).
# Output: certs/kafka-ssl/*.jks, *.p12, passwords; creates kafka-ssl-secret in record-platform
#   with ca-cert.pem (dev-root), keystore, truststore for Docker Kafka SSL and Node clients.
#
# Usage: ./scripts/kafka-ssl-from-dev-root.sh
#   KAFKA_SSL_NS=record-platform  — namespace for kafka-ssl-secret
#   KAFKA_SSL_PASS=changeit       — keystore/truststore password
#   KAFKA_BROKER_REPLICAS=3       — SANs for kafka-0..N-1 (headless + external service DNS)
#   KAFKA_SSL_EXTRA_IP_SANS=      — optional manual IPs; merged with auto-discovered LB IPs when auto is on
#   KAFKA_SSL_AUTO_METALLB_IPS=   — default 1: append LB IPs from kubectl get svc kafka-*-external (same ns). Set 0 to disable.
#   SAN list: scripts/lib/kafka-broker-sans.sh (shared with verify-kafka-tls-sans.sh).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="${SCRIPT_DIR}/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
cd "$REPO_ROOT"

# shellcheck source=lib/rp-dev-ca.sh
source "$SCRIPT_DIR/lib/rp-dev-ca.sh"
# shellcheck source=lib/rp-pki-generation.sh
source "$SCRIPT_DIR/lib/rp-pki-generation.sh"

NS="${KAFKA_SSL_NS:-record-platform}"
PASS="${KAFKA_SSL_PASS:-changeit}"
CA_PEM="${REPO_ROOT}/certs/dev-root.pem"
OUT="${REPO_ROOT}/certs/kafka-ssl"
TMP="${REPO_ROOT}/.kafka-ssl-tmp.$$"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }

say "=== Kafka SSL from dev-root-ca (strict TLS, same CA as Caddy) ==="

command -v openssl >/dev/null 2>&1 || { echo "❌ openssl required"; exit 1; }
command -v keytool >/dev/null 2>&1 || { echo "❌ keytool required (brew install openjdk)"; exit 1; }

ctx=$(kubectl config current-context 2>/dev/null || echo "")
kctl() {
  if [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
    colima ssh -- kubectl --request-timeout=15s "$@" 2>/dev/null || colima ssh -- kubectl --request-timeout=15s "$@"
  else
    kubectl --request-timeout=15s "$@" 2>/dev/null || kubectl --request-timeout=15s "$@"
  fi
}

# shellcheck source=lib/kafka-broker-sans.sh
source "$SCRIPT_DIR/lib/kafka-broker-sans.sh"

if [[ ! -f "$CA_PEM" ]] || [[ ! -f "$(rp_dev_root_key)" ]]; then
  echo "❌ dev-root CA not found. Run: pnpm run reissue (with KAFKA_SSL=1 to persist CA key), or ensure certs/dev-root.pem and certs/dev-root.key exist."
  exit 1
fi
rp_dev_bootstrap_chain

mkdir -p "$OUT" "$TMP"
trap 'rm -rf "$TMP"' EXIT
# Remove existing keystore/truststore so keytool never sees "alias already exists"
rm -f "$OUT/kafka.keystore.jks" "$OUT/kafka.truststore.jks" "$OUT/kafka.keystore-password" "$OUT/kafka.truststore-password" "$OUT/kafka.key-password" "$OUT/kafka-broker.pem" 2>/dev/null || true

REPLICAS="${KAFKA_BROKER_REPLICAS:-3}"
# Default on: KRaft EXTERNAL://<MetalLB>:9094 requires those IPs in the broker cert. Disable with KAFKA_SSL_AUTO_METALLB_IPS=0.
if [[ "${KAFKA_SSL_AUTO_METALLB_IPS:-1}" != "0" ]]; then
  _auto_extra="$(rp_kafka_metallb_external_lb_ips_csv "$NS" "$REPLICAS")"
  if [[ -n "$_auto_extra" ]]; then
    if [[ -n "${KAFKA_SSL_EXTRA_IP_SANS:-}" ]]; then
      KAFKA_SSL_EXTRA_IP_SANS="${KAFKA_SSL_EXTRA_IP_SANS},${_auto_extra}"
    else
      KAFKA_SSL_EXTRA_IP_SANS="${_auto_extra}"
    fi
    ok "MetalLB: merged kafka-*-external LB IPs into KAFKA_SSL_EXTRA_IP_SANS (${_auto_extra})"
  elif [[ "${KAFKA_SSL_AUTO_METALLB_IPS:-}" == "1" ]]; then
    warn "KAFKA_SSL_AUTO_METALLB_IPS=1 but no kafka-*-external LoadBalancer IPs in namespace ${NS}"
  fi
fi
KAFKA_SANS="$(rp_kafka_subject_alt_name_openssl_value "$NS" "$REPLICAS" "${KAFKA_SSL_EXTRA_IP_SANS:-}")"
CN="${KAFKA_SSL_CN:-kafka}"
say "Broker TLS SANs: replicas 0..$((REPLICAS - 1)), namespace=${NS} (MetalLB IPs auto-merged when discoverable; KAFKA_SSL_AUTO_METALLB_IPS=0 to skip)"

say "1. Generating Kafka broker key and CSR..."
openssl genrsa -out "$TMP/kafka.key" 2048 2>/dev/null
openssl req -new -key "$TMP/kafka.key" -out "$TMP/kafka.csr" \
  -subj "/CN=${CN}/O=record-platform" 2>/dev/null

# Broker EKU: serverAuth (listener) + clientAuth (JVM as TLS client for inter-broker SSL, etc.).
# Omitting clientAuth causes: "Extended key usage does not permit use for TLS client authentication".
# Use a dedicated section name (not [v3_req]) so macOS/LibreSSL openssl.cnf [v3_req] defaults cannot override EKU.
cat > "$TMP/san.ext" <<EOF
[kafka_broker_tls]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth, clientAuth
subjectAltName = $KAFKA_SANS
EOF

say "2. Signing broker cert with dev intermediate..."
if ! openssl x509 -req -in "$TMP/kafka.csr" -CA "$(rp_dev_intermediate_pem)" -CAkey "$(rp_dev_intermediate_key)" \
  -CAserial "$(rp_dev_certs_dir)/dev-intermediate.srl" -CAcreateserial \
  -out "$TMP/kafka.pem" -days 365 -sha256 \
  -extensions kafka_broker_tls -extfile "$TMP/san.ext"; then
  echo "❌ openssl x509 broker sign failed (see errors above)"
  exit 1
fi
if ! openssl x509 -in "$TMP/kafka.pem" -text -noout | grep -A2 "Extended Key Usage" | grep -q "TLS Web Client Authentication"; then
  echo "❌ Signed broker cert missing clientAuth EKU (JKS will break Kafka). OpenSSL output:"
  openssl x509 -in "$TMP/kafka.pem" -text -noout | grep -A3 "Extended Key Usage" || true
  exit 1
fi
ok "Broker cert signed (serverAuth + clientAuth in PEM)"
cp "$TMP/kafka.pem" "$OUT/kafka-broker.pem"
cp "$TMP/kafka.key" "$OUT/kafka-broker.key"

say "3. Creating JKS keystore and truststore..."
# Keystore: leaf + issuing intermediate (peers need full chain on the wire).
# Truststore: intermediate + root (broker leaf is signed by intermediate, not dev-root directly).
cat "$TMP/kafka.pem" "$(rp_dev_intermediate_pem)" >"$TMP/kafka-chain.pem"
openssl pkcs12 -export -in "$TMP/kafka-chain.pem" -inkey "$TMP/kafka.key" \
  -out "$TMP/kafka.p12" -passout "pass:$PASS" -name kafka 2>/dev/null
keytool -importkeystore -srckeystore "$TMP/kafka.p12" -srcstoretype PKCS12 \
  -srcstorepass "$PASS" -destkeystore "$OUT/kafka.keystore.jks" \
  -deststoretype JKS -deststorepass "$PASS" -noprompt 2>/dev/null

rm -f "$OUT/kafka.truststore.jks"
keytool -importcert -alias dev-intermediate-ca -file "$(rp_dev_intermediate_pem)" \
  -keystore "$OUT/kafka.truststore.jks" -storepass "$PASS" -noprompt 2>/dev/null
keytool -importcert -alias dev-root-ca -file "$CA_PEM" \
  -keystore "$OUT/kafka.truststore.jks" -storepass "$PASS" -noprompt 2>/dev/null

echo -n "$PASS" > "$OUT/kafka.keystore-password"
echo -n "$PASS" > "$OUT/kafka.truststore-password"
echo -n "$PASS" > "$OUT/kafka.key-password"  # KAFKA_SSL_KEY_CREDENTIALS (in-cluster Kafka deploy)
cp "$(rp_dev_chain_pem)" "$OUT/ca-cert.pem"
cp "$(rp_dev_chain_pem)" "$OUT/ca.crt"
cp "$(rp_dev_chain_pem)" "$OUT/dev-chain.pem"

chmod +x "$SCRIPT_DIR/verify-kafka-broker-keystore-jks.sh" \
  "$SCRIPT_DIR/verify-kafka-broker-truststore-jks.sh" 2>/dev/null || true
KAFKA_KEYSTORE_PATH="$OUT/kafka.keystore.jks" \
  KAFKA_KEYSTORE_PASSWORD_FILE="$OUT/kafka.keystore-password" \
  REPO_ROOT="$REPO_ROOT" \
  bash "$SCRIPT_DIR/verify-kafka-broker-keystore-jks.sh" || exit 1
KAFKA_TRUSTSTORE_PATH="$OUT/kafka.truststore.jks" \
  KAFKA_TRUSTSTORE_PASSWORD_FILE="$OUT/kafka.truststore-password" \
  KAFKA_BROKER_PEM_PATH="$OUT/kafka-broker.pem" \
  REPO_ROOT="$REPO_ROOT" \
  bash "$SCRIPT_DIR/verify-kafka-broker-truststore-jks.sh" || exit 1

say "3b. Generating Kafka client cert (mTLS: ssl.client.auth=required)..."
openssl genrsa -out "$TMP/client.key" 2048 2>/dev/null
openssl req -new -key "$TMP/client.key" -out "$TMP/client.csr" \
  -subj "/CN=kafka-client/O=record-platform" 2>/dev/null
cat > "$TMP/client.ext" <<EOF
[v3_client]
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = clientAuth
EOF
openssl x509 -req -in "$TMP/client.csr" -CA "$(rp_dev_intermediate_pem)" -CAkey "$(rp_dev_intermediate_key)" \
  -CAserial "$(rp_dev_certs_dir)/dev-intermediate.srl" -CAcreateserial -out "$TMP/client.crt" -days 365 -sha256 \
  -extensions v3_client -extfile "$TMP/client.ext" 2>/dev/null
cp "$TMP/client.crt" "$OUT/client.crt"
cp "$TMP/client.key" "$OUT/client.key"
ok "Kafka client cert (client.crt, client.key) for Node/KafkaJS mTLS"

ok "Keystore/truststore, ca-cert.pem, and client cert in $OUT"

if [[ "${KAFKA_SSL_SKIP_K8S_SECRET:-0}" == "1" ]]; then
  ok "Skipping k8s secret (KAFKA_SSL_SKIP_K8S_SECRET=1); disk material in $OUT"
else
  say "4. Applying kafka-ssl-secret in $NS (canonical writer: apply-rp-kafka-ssl-secret.sh)..."
  kubectl create namespace "$NS" --dry-run=client -o yaml 2>/dev/null | kubectl apply -f - 2>/dev/null || true
  HOUSING_NS="$NS" bash "$SCRIPT_DIR/apply-rp-kafka-ssl-secret.sh"
fi

say "=== Kafka SSL (dev-root-ca) done ==="
echo "  Keystore/truststore: $OUT. Docker Kafka: mount $OUT, use SSL listener 9093."
echo "  Clients (Node/KafkaJS): KAFKA_CA_CERT, KAFKA_CLIENT_CERT, KAFKA_CLIENT_KEY from kafka-ssl-secret (ca-cert.pem, client.crt, client.key)."
echo "  SAN gate: pnpm verify:kafka-tls-sans (uses kafka-broker.pem in kafka-ssl-secret or $OUT/kafka-broker.pem)."
