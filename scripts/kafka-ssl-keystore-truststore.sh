#!/usr/bin/env bash
# DEPRECATED for bootstrap: use scripts/kafka-ssl-from-dev-root.sh + scripts/apply-rp-kafka-ssl-secret.sh
# (full broker JKS + client.crt/client.key from dev-root CA). This script writes a partial secret only.
# Generate Kafka keystore + truststore and create kafka-ssl-secret in record-platform.
# Run before deploying Kafka with strict TLS (SSL on 9093).
# Requires: keytool (Java), kubectl.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="${SCRIPT_DIR}/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
NS="${KAFKA_SSL_NS:-record-platform}"
TMP="${KAFKA_SSL_TMP:-/tmp/kafka-ssl-$$}"
PASS="${KAFKA_SSL_PASS:-changeit}"
CN="${KAFKA_SSL_CN:-kafka.record-platform.svc.cluster.local}"

if ! command -v keytool >/dev/null 2>&1; then
  echo "❌ keytool not found. Install Java (e.g. brew install openjdk) or set JAVA_HOME."
  exit 1
fi
if ! command -v kubectl >/dev/null 2>&1; then
  echo "❌ kubectl not found."
  exit 1
fi
if ! kubectl --request-timeout=10s cluster-info >/dev/null 2>&1; then
  echo "❌ Cluster not reachable. Start Kind/Colima and set kubectl context."
  exit 1
fi

mkdir -p "$TMP"
cd "$TMP"
trap 'rm -rf "$TMP"' EXIT

echo "Generating Kafka keystore (CN=$CN)..."
keytool -genkeypair -alias kafka -keyalg RSA -keysize 2048 \
  -keystore kafka.keystore.jks -storepass "$PASS" -keypass "$PASS" \
  -dname "CN=$CN,OU=Platform,O=Record,L=Local,ST=State,C=US" -validity 3650

echo "Exporting broker cert and building truststore..."
keytool -exportcert -alias kafka -keystore kafka.keystore.jks \
  -storepass "$PASS" -file kafka.cer
keytool -importcert -alias kafka -file kafka.cer \
  -keystore kafka.truststore.jks -storepass "$PASS" -noprompt

echo -n "$PASS" > kafka.keystore-password
echo -n "$PASS" > kafka.key-password
echo -n "$PASS" > kafka.truststore-password

echo "Creating kafka-ssl-secret in namespace $NS..."
kubectl create namespace "$NS" 2>/dev/null || true
kubectl create secret generic kafka-ssl-secret -n "$NS" \
  --from-file=kafka.keystore.jks \
  --from-file=kafka.truststore.jks \
  --from-file=kafka.keystore-password \
  --from-file=kafka.key-password \
  --from-file=kafka.truststore-password \
  --dry-run=client -o yaml | kubectl apply -f - --request-timeout=15s

echo "✅ kafka-ssl-secret created/updated in $NS"
echo "   Next: apply Kafka deploy with SSL listener (e.g. kubectl apply -k infra/k8s/overlays/dev)"
echo "   Ensure Kafka deploy uses KAFKA_SSL_ENABLED=true and SSL listener on 9093."
