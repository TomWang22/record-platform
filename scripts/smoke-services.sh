#!/usr/bin/env bash
set -euo pipefail
HOST=record.local
CURL="${CURL_BIN:-/opt/homebrew/opt/curl/bin/curl}"
command -v "$CURL" >/dev/null || CURL="$(command -v curl)"

echo '127.0.0.1 record.local' | sudo tee -a /etc/hosts >/dev/null || true

printf "%-28s " "/api/whoami"
$CURL -sS --http2 -H "Host: $HOST" "https://$HOST/api/whoami" || true

echo "== H2 =="
for p in /api/healthz /api/auth/healthz /api/records/healthz /api/listings/healthz /api/analytics/healthz /api/ai/healthz; do
  printf "%-28s " "$p"
  $CURL -sS --http2 -I -H "Host: $HOST" "https://$HOST$p" | head -n1
done

if "$CURL" --help all 2>&1 | grep -q -- --http3-only; then
  echo "== H3 (best effort) =="
  for p in /api/healthz /api/ai/healthz; do
    printf "%-28s " "$p"
    $CURL -sS --http3-only -I -H "Host: $HOST" "https://$HOST$p" 2>/dev/null | head -n1 || true
  done
fi

printf "%-28s " "/api/whoami"
$CURL -sS --http2 -H "Host: $HOST" "https://$HOST/api/whoami" || true
