#!/usr/bin/env bash
set -euo pipefail
HOST=record.local
CURL="${CURL_BIN:-/opt/homebrew/opt/curl/bin/curl}"
if ! "$CURL" --version 2>/dev/null | grep -q 'HTTP3'; then CURL="$(command -v curl)"; fi
grep -q "$HOST" /etc/hosts || echo "127.0.0.1 $HOST" | sudo tee -a /etc/hosts >/dev/null

echo "== H2 =="
"$CURL" -sS --http2      -H "Host: $HOST" https://$HOST/api/ai/healthz
echo
echo "== H3 =="
if "$CURL" --help all 2>&1 | grep -q -- --http3-only; then
  "$CURL" -sS --http3-only -H "Host: $HOST" https://$HOST/api/ai/healthz || true
  echo
else
  echo "curl without HTTP/3 support; skipping H3"
fi
