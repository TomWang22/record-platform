#!/usr/bin/env bash
# Check that curl supports HTTP/3 (--http3). If not, print install steps for macOS.
# Usage: ./scripts/ensure-curl-http3.sh
# Pipe into copilot or follow the printed steps.
set -euo pipefail

CURL_BIN="${CURL_BIN:-curl}"
CURL_PATH="$(command -v "$CURL_BIN" 2>/dev/null)" || true
if [[ -z "$CURL_PATH" ]]; then
  echo "curl not found. Install: brew install curl"
  exit 1
fi

echo "Checking: $CURL_PATH"
echo "  $($CURL_PATH -V 2>&1 | head -1)"
if $CURL_PATH -V 2>&1 | grep -qi 'HTTP3'; then
  echo "✅ This curl supports HTTP/3. Use: $CURL_PATH -vk --http3 https://192.168.64.240/_caddy/healthz --resolve record.local:443:192.168.64.240"
  exit 0
fi

echo "❌ This curl does NOT support HTTP/3 (no HTTP3 in curl -V)."
echo ""
echo "Install a curl build with HTTP/3 (macOS):"
echo "  1) brew install curl"
echo "     Then: /opt/homebrew/opt/curl/bin/curl -V   # look for HTTP3"
echo "  2) If missing: brew install curl --HEAD   or   brew install curl-openssl"
echo "  3) Use it: export PATH=\"/opt/homebrew/opt/curl/bin:\$PATH\""
echo "  4) Verify: curl -V   # must list HTTP3 in Features"
echo ""
echo "Then test QUIC:"
echo "  curl -vk --http3 https://192.168.64.240/_caddy/healthz --resolve record.local:443:192.168.64.240"
echo ""
echo "See docs/TRANSPORT_FOUR_LAYERS.md for the four layers and capture location."
exit 1
