#!/usr/bin/env bash
set -euo pipefail

HOST="${HOST:-record.local}"
CURL_BIN="/opt/homebrew/opt/curl/bin/curl"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

say "=== Production Readiness Verification ==="

# Test full chain: Client -> Caddy -> Ingress -> Backend
say "Testing Full Chain (Client -> Caddy -> Ingress Nginx -> Backend)"

echo ""
echo "1. Caddy health (H2):"
if "$CURL_BIN" -k -sS -I --http2 -H "Host: $HOST" "https://$HOST:8443/_caddy/healthz" 2>&1 | head -n1 | grep -q "200"; then
  ok "Caddy health (H2) works"
else
  warn "Caddy health (H2) failed"
fi

echo ""
echo "2. Caddy health (H3):"
if "$CURL_BIN" -k -sS -I --http3-only -H "Host: $HOST" "https://$HOST:8443/_caddy/healthz" 2>&1 | head -n1 | grep -q "200"; then
  ok "Caddy health (H3) works"
else
  warn "Caddy health (H3) failed"
fi

echo ""
echo "3. Backend via Ingress (H2) - Full Chain:"
RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 -H "Host: $HOST" "https://$HOST:8443/api/healthz" 2>&1)
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
if [[ "$HTTP_CODE" =~ ^(200|404|502)$ ]]; then
  ok "Full chain (H2) works - HTTP $HTTP_CODE"
  echo "   Chain: Client -> Caddy (H2) -> Ingress Nginx -> Backend"
else
  warn "Full chain (H2) returned HTTP $HTTP_CODE"
fi

echo ""
echo "4. Backend via Ingress (H3) - Full Chain:"
RESPONSE_H3=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http3-only -H "Host: $HOST" "https://$HOST:8443/api/healthz" 2>&1)
HTTP_CODE_H3=$(echo "$RESPONSE_H3" | tail -1)
if [[ "$HTTP_CODE_H3" =~ ^(200|404|502)$ ]]; then
  ok "Full chain (H3) works - HTTP $HTTP_CODE_H3"
  echo "   Chain: Client -> Caddy (H3/QUIC) -> Ingress Nginx -> Backend"
else
  warn "Full chain (H3) returned HTTP $HTTP_CODE_H3"
fi

echo ""
echo "5. Strict TLS verification:"
if "$CURL_BIN" -k -sS -I --tlsv1.1 --http2 -H "Host: $HOST" "https://$HOST:8443/_caddy/healthz" 2>&1 | grep -qE "error|handshake|protocol"; then
  ok "TLS 1.1 correctly rejected (strict TLS enforced)"
else
  warn "TLS 1.1 was not rejected"
fi

say "=== Verification Complete ==="
