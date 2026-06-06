#!/usr/bin/env bash
# Generate certs/ for strict TLS and base kustomize: record.local.crt, record.local.key, dev-root.pem.
# Uses mkcert. Run from repo root. Idempotent: skips if certs/ already has the files.
# Usage: ./scripts/ensure-certs-for-strict-tls.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

CERTS_DIR="$REPO_ROOT/certs"
HOST="${HOST:-record.local}"

if [[ -f "$CERTS_DIR/record.local.crt" ]] && [[ -f "$CERTS_DIR/record.local.key" ]] && [[ -f "$CERTS_DIR/dev-root.pem" ]]; then
  echo "✅ certs/ already present (record.local.crt, record.local.key, dev-root.pem). Delete certs/ to regenerate."
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
mkcert -cert-file "$CERTS_DIR/record.local.crt" -key-file "$CERTS_DIR/record.local.key" \
  "$HOST" \
  "*.$HOST" \
  "localhost" \
  "127.0.0.1" \
  "::1" \
  "caddy-h3.ingress-nginx.svc.cluster.local" \
  "*.ingress-nginx.svc.cluster.local" \
  "*.record-platform.svc.cluster.local" \
  "auth-service.record-platform.svc.cluster.local" \
  "api-gateway.record-platform.svc.cluster.local" \
  "social-service.record-platform.svc.cluster.local" \
  "shopping-service.record-platform.svc.cluster.local" \
  "listings-service.record-platform.svc.cluster.local" \
  "analytics-service.record-platform.svc.cluster.local" \
  "auction-monitor.record-platform.svc.cluster.local" \
  "python-ai-service.record-platform.svc.cluster.local" \
  "records-service.record-platform.svc.cluster.local" \
  >/dev/null 2>&1

cp "$CA_ROOT/rootCA.pem" "$CERTS_DIR/dev-root.pem"
echo "✅ certs/ created: record.local.crt, record.local.key, dev-root.pem"
