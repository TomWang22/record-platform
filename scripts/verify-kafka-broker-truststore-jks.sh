#!/usr/bin/env bash
# Fail fast: Kafka truststore must trust broker leafs signed by dev-intermediate (3-stage PKI).
# Root-only truststore causes PKIX path building failed on inter-broker / listener SSL startup.
#
# Usage (repo root):
#   ./scripts/verify-kafka-broker-truststore-jks.sh
# Env:
#   KAFKA_TRUSTSTORE_PATH            — default certs/kafka-ssl/kafka.truststore.jks
#   KAFKA_TRUSTSTORE_PASSWORD_FILE   — default certs/kafka-ssl/kafka.truststore-password
#   KAFKA_BROKER_PEM_PATH            — default certs/kafka-ssl/kafka-broker.pem
#   REPO_ROOT
#   PREFLIGHT_SKIP_KAFKA_JKS_VERIFY=1 — exit 0
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"

die() { echo "❌ $*" >&2; exit 1; }
ok() { echo "✅ $*"; }

[[ "${PREFLIGHT_SKIP_KAFKA_JKS_VERIFY:-0}" == "1" ]] && exit 0

command -v keytool >/dev/null 2>&1 || die "keytool required"
command -v openssl >/dev/null 2>&1 || die "openssl required"

# shellcheck source=lib/rp-dev-ca.sh
source "$SCRIPT_DIR/lib/rp-dev-ca.sh"

TS="${KAFKA_TRUSTSTORE_PATH:-$REPO_ROOT/certs/kafka-ssl/kafka.truststore.jks}"
PWFILE="${KAFKA_TRUSTSTORE_PASSWORD_FILE:-$REPO_ROOT/certs/kafka-ssl/kafka.truststore-password}"
BROKER="${KAFKA_BROKER_PEM_PATH:-$REPO_ROOT/certs/kafka-ssl/kafka-broker.pem}"

[[ -f "$TS" ]] || die "Truststore missing: $TS"
[[ -f "$PWFILE" ]] || die "Truststore password file missing: $PWFILE"
[[ -f "$BROKER" ]] || die "Broker PEM missing: $BROKER"

PASS="$(tr -d '\r\n' <"$PWFILE")"
[[ -n "$PASS" ]] || die "Empty truststore password in $PWFILE"

list="$(keytool -list -keystore "$TS" -storepass "$PASS" -storetype JKS 2>&1)" || die "keytool -list truststore failed"
echo "$list" | grep -q "dev-intermediate-ca" || die "Truststore missing alias dev-intermediate-ca (intermediate required for PKIX)"
echo "$list" | grep -q "dev-root-ca" || die "Truststore missing alias dev-root-ca"

ROOT="$(rp_dev_root_pem)"
INT="$(rp_dev_intermediate_pem)"
[[ -f "$ROOT" && -f "$INT" ]] || die "dev-root.pem / dev-intermediate.pem missing under certs/"

if ! openssl verify -CAfile "$ROOT" -untrusted "$INT" "$BROKER" >/dev/null 2>&1; then
  openssl verify -CAfile "$ROOT" -untrusted "$INT" "$BROKER" >&2 || true
  die "Broker PEM does not chain to dev-root via dev-intermediate (fix kafka-ssl-from-dev-root.sh)"
fi

TMP="${REPO_ROOT}/.kafka-truststore-verify.$$"
mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT

keytool -exportcert -alias dev-intermediate-ca -keystore "$TS" -storepass "$PASS" -rfc \
  >"$TMP/from-ts-intermediate.pem" 2>/dev/null || die "Could not export dev-intermediate-ca from truststore"
keytool -exportcert -alias dev-root-ca -keystore "$TS" -storepass "$PASS" -rfc \
  >"$TMP/from-ts-root.pem" 2>/dev/null || die "Could not export dev-root-ca from truststore"

if ! openssl verify -CAfile "$TMP/from-ts-root.pem" -untrusted "$TMP/from-ts-intermediate.pem" "$BROKER" >/dev/null 2>&1; then
  die "Broker PEM does not verify against truststore JKS anchors (PKIX drift)"
fi

ok "Broker truststore OK: intermediate + root anchors; broker leaf chains for inter-broker SSL"
