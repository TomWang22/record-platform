#!/usr/bin/env bash
# Convert Kafka JKS keystore/truststore to PEM files for the Go readiness agent.
# Intended for initContainer / one-shot sidecar. Does not modify live StatefulSet.
set -euo pipefail

SECRETS_DIR="${SECRETS_DIR:-/etc/kafka/secrets}"
OUT_DIR="${OUT_DIR:-/etc/kafka/pem}"
KS_PASS_FILE="${KS_PASS_FILE:-$SECRETS_DIR/kafka.keystore-password}"
TS_PASS_FILE="${TS_PASS_FILE:-$SECRETS_DIR/kafka.truststore-password}"

KS_PASS="$(tr -d '\n' <"$KS_PASS_FILE")"
TS_PASS="$(tr -d '\n' <"$TS_PASS_FILE")"

mkdir -p "$OUT_DIR"

# Keystore JKS → PKCS12 → PEM cert + key
keytool -importkeystore \
  -srckeystore "$SECRETS_DIR/kafka.keystore.jks" \
  -srcstoretype JKS \
  -srcstorepass "$KS_PASS" \
  -destkeystore "$OUT_DIR/kafka.keystore.p12" \
  -deststoretype PKCS12 \
  -deststorepass "$KS_PASS" \
  -noprompt >/dev/null

openssl pkcs12 -in "$OUT_DIR/kafka.keystore.p12" -passin "pass:$KS_PASS" -nokeys -out "$OUT_DIR/tls.crt"
openssl pkcs12 -in "$OUT_DIR/kafka.keystore.p12" -passin "pass:$KS_PASS" -nodes -nocerts -out "$OUT_DIR/tls.key"

# Truststore JKS → PEM CA bundle (export all trusted certs)
keytool -importkeystore \
  -srckeystore "$SECRETS_DIR/kafka.truststore.jks" \
  -srcstoretype JKS \
  -srcstorepass "$TS_PASS" \
  -destkeystore "$OUT_DIR/kafka.truststore.p12" \
  -deststoretype PKCS12 \
  -deststorepass "$TS_PASS" \
  -noprompt >/dev/null

openssl pkcs12 -in "$OUT_DIR/kafka.truststore.p12" -passin "pass:$TS_PASS" -nokeys -out "$OUT_DIR/ca.pem"

chmod 600 "$OUT_DIR/tls.key" "$OUT_DIR/"*.p12 2>/dev/null || true
chmod 644 "$OUT_DIR/tls.crt" "$OUT_DIR/ca.pem"

echo "PEM written to $OUT_DIR (tls.crt tls.key ca.pem)"
