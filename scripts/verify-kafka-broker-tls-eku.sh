#!/usr/bin/env bash
# Require broker leaf PEM to include TLS Web Server Authentication AND TLS Web Client Authentication
# (OpenSSL wording for serverAuth + clientAuth). Inter-broker TLS needs clientAuth on the broker cert.
#
# Usage:
#   ./scripts/verify-kafka-broker-tls-eku.sh
# Env:
#   KAFKA_TLS_PEM — path to broker cert PEM (default: $REPO_ROOT/certs/kafka-ssl/kafka-broker.pem)
#   REPO_ROOT
#   PREFLIGHT_SKIP_KAFKA_EKU_CHECK=1 — exit 0
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"

die() { echo "❌ $*" >&2; exit 1; }
ok() { echo "✅ $*"; }

[[ "${PREFLIGHT_SKIP_KAFKA_EKU_CHECK:-0}" == "1" ]] && exit 0

command -v openssl >/dev/null 2>&1 || die "openssl required"

PEM="${KAFKA_TLS_PEM:-$REPO_ROOT/certs/kafka-ssl/kafka-broker.pem}"
[[ -s "$PEM" ]] || die "Broker PEM missing or empty: $PEM (set KAFKA_TLS_PEM or run kafka-ssl generation)"

text="$(openssl x509 -in "$PEM" -noout -text 2>&1)" || die "openssl x509 failed on $PEM"

# OpenSSL prints "TLS Web Server Authentication" / "TLS Web Client Authentication" in EKU section.
if ! echo "$text" | grep -q "TLS Web Server Authentication"; then
  die "Broker cert missing TLS Web Server Authentication EKU in $PEM"
fi
if ! echo "$text" | grep -q "TLS Web Client Authentication"; then
  die "Broker cert missing TLS Web Client Authentication EKU (mTLS / inter-broker) in $PEM"
fi

ok "Broker PEM EKU OK (server + client auth): $PEM"
