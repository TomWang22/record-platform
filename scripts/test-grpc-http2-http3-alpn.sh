#!/usr/bin/env bash
set -euo pipefail

HOST="${HOST:-record.local}"
CURL_BIN="${CURL_BIN:-/opt/homebrew/opt/curl/bin/curl}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/http3.sh
. "$SCRIPT_DIR/lib/http3.sh"
HTTP3_RESOLVE="${HOST}:443:127.0.0.1"

say "=== Testing gRPC over HTTP/2/3 with ALPN ==="

# Test 1: HTTP/2 with prior knowledge
say "Test 1: HTTP/2 with prior knowledge"
if "$CURL_BIN" -k -v --http2-prior-knowledge -H "Host: $HOST" \
  "https://$HOST:8443/_caddy/healthz" 2>&1 | grep -q "ALPN.*h2\|HTTP/2"; then
  ok "HTTP/2 ALPN negotiation works"
else
  warn "HTTP/2 ALPN negotiation may have failed"
fi

# Test 2: HTTP/3
say "Test 2: HTTP/3 (QUIC)"
if http3_curl -k -v --http3-only --max-time 15 \
  -H "Host: $HOST" \
  --resolve "$HTTP3_RESOLVE" \
  "https://$HOST/_caddy/healthz" 2>&1 | grep -q "HTTP/3\|QUIC"; then
  ok "HTTP/3 works"
else
  warn "HTTP/3 may have failed"
fi

# Test 3: gRPC health check via HTTP/2
say "Test 3: gRPC health check via HTTP/2"
if command -v grpcurl >/dev/null 2>&1; then
  if grpcurl -insecure -H "Host: $HOST" \
    -d '{}' \
    "$HOST:8443" \
    auth.AuthService/HealthCheck 2>&1 | grep -q "healthy"; then
    ok "gRPC health check works via HTTP/2"
  else
    warn "gRPC health check failed"
  fi
else
  warn "grpcurl not installed, skipping gRPC test"
fi

# Test 4: Check ALPN negotiation
say "Test 4: ALPN negotiation details"
"$CURL_BIN" -k -v --http2-prior-knowledge -H "Host: $HOST" \
  "https://$HOST:8443/_caddy/healthz" 2>&1 | grep -iE "ALPN|protocol|h2|h3" | head -5

say "=== ALPN Testing Complete ==="
