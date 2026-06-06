#!/usr/bin/env bash
set -euo pipefail

# Generate Kafka SSL certificates for strict TLS
CERT_DIR="${CERT_DIR:-./certs/kafka}"
mkdir -p "$CERT_DIR"

echo "🔐 Generating Kafka SSL certificates..."

# Check if we have a CA (use dev-root.pem if available)
if [ -f "./certs/dev-root.pem" ]; then
  CA_CERT="./certs/dev-root.pem"
  CA_KEY="./certs/dev-root.key"
  echo "✅ Using existing CA: $CA_CERT"
else
  echo "❌ CA not found at ./certs/dev-root.pem"
  echo "Please run certificate generation first"
  exit 1
fi

# Generate Kafka keystore
echo "Creating Kafka keystore..."
keytool -genkeypair -alias kafka \
  -keyalg RSA -keysize 2048 \
  -keystore "$CERT_DIR/kafka.keystore.jks" \
  -storepass kafkastorepass \
  -keypass kafkakeypass \
  -validity 365 \
  -dname "CN=kafka.record-platform.svc.cluster.local, OU=Kafka, O=RecordPlatform, L=Local, ST=Local, C=US" \
  -ext "SAN=DNS:kafka,DNS:kafka.record-platform.svc.cluster.local,DNS:localhost"

# Export certificate from keystore
echo "Exporting certificate..."
keytool -exportcert -alias kafka \
  -keystore "$CERT_DIR/kafka.keystore.jks" \
  -storepass kafkastorepass \
  -file "$CERT_DIR/kafka.crt"

# Create truststore with CA
echo "Creating truststore..."
keytool -importcert -alias ca \
  -file "$CA_CERT" \
  -keystore "$CERT_DIR/kafka.truststore.jks" \
  -storepass kafkatrustpass \
  -noprompt

echo "✅ Kafka SSL certificates generated in $CERT_DIR"
echo "   - kafka.keystore.jks (keystore-password: kafkastorepass)"
echo "   - kafka.truststore.jks (truststore-password: kafkatrustpass)"
echo "   - kafka.crt (exported certificate)"
