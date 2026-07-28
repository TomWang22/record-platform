#!/usr/bin/env bash
# Generate certs/ for strict TLS smoke (mkcert). Prefer restored / generate-canonical-dev-tls.sh
# PKI (record-platform.test + per-service leaves). This helper is a fallback only.
# Idempotent: skips if record-platform.test leaf + root already exist.
# Usage: ./scripts/ensure-certs-for-strict-tls.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

CERTS_DIR="$REPO_ROOT/certs"
HOST="${HOST:-record-platform.test}"

if [[ -f "$CERTS_DIR/record-platform.test.crt" ]] && [[ -f "$CERTS_DIR/record-platform.test.key" ]] && [[ -f "$CERTS_DIR/dev-root.pem" ]]; then
  echo "✅ certs/ already present (record-platform.test.crt/key + dev-root.pem). Delete certs/ to regenerate via this helper."
  exit 0
fi

if ! command -v mkcert &>/dev/null; then
  echo "❌ mkcert not found. Install with: brew install mkcert && mkcert -install" >&2
  exit 1
fi

mkcert -install 2>/dev/null || true
CA_ROOT="$(mkcert -CAROOT)"
if [[ ! -f "$CA_ROOT/rootCA.pem" ]]; then
  echo "❌ mkcert CA not found. Run: mkcert -install" >&2
  exit 1
fi

mkdir -p "$CERTS_DIR"
mkcert -cert-file "$CERTS_DIR/record-platform.test.crt" -key-file "$CERTS_DIR/record-platform.test.key" \
  "$HOST" \
  "*.$HOST" \
  "localhost" \
  "127.0.0.1" \
  "::1" \
  "caddy-h3.ingress-nginx.svc.cluster.local" \
  "*.ingress-nginx.svc.cluster.local" \
  "*.record-platform.svc.cluster.local" \
  "api-gateway.record-platform.svc.cluster.local" \
  "auth-service.record-platform.svc.cluster.local" \
  "records-service.record-platform.svc.cluster.local" \
  "listings-service.record-platform.svc.cluster.local" \
  "shopping-service.record-platform.svc.cluster.local" \
  "messaging-service.record-platform.svc.cluster.local" \
  "media-service.record-platform.svc.cluster.local" \
  "trust-service.record-platform.svc.cluster.local" \
  "notification-service.record-platform.svc.cluster.local" \
  "analytics-service.record-platform.svc.cluster.local" \
  "auction-monitor.record-platform.svc.cluster.local" \
  "python-ai-service.record-platform.svc.cluster.local" \
  >/dev/null 2>&1

cp "$CA_ROOT/rootCA.pem" "$CERTS_DIR/dev-root.pem"
echo "✅ certs/ created: record-platform.test.crt/key + dev-root.pem (messaging replaces social; no booking)"
