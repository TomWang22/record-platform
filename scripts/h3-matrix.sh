# ==================================================
# FILE: scripts/h3-matrix.sh  (root)  — unchanged
# ==================================================
#!/usr/bin/env bash
set -euo pipefail
HOST=record.local
CURL="${CURL_BIN:-/opt/homebrew/opt/curl/bin/curl}"
if ! "$CURL" --version 2>/dev/null | grep -q 'HTTP3'; then CURL="$(command -v curl)"; fi
echo '127.0.0.1 record.local' | sudo tee -a /etc/hosts >/dev/null
echo "== Caddy health (H2) =="; "$CURL" -sS -I --http2      -H "Host: $HOST" https://$HOST/_caddy/healthz | head -n1
echo "== Caddy health (H3) =="; if "$CURL" --help all 2>&1 | grep -q -- --http3-only; then "$CURL" -sS -I --http3-only -H "Host: $HOST" https://$HOST/_caddy/healthz | head -n1; else echo "HTTP/3 not supported by this curl"; fi
echo "== Backend via ingress (H2) =="; "$CURL" -sS -I --http2      -H "Host: $HOST" https://$HOST/api/healthz | head -n1
echo "== Backend via ingress (H3) =="; if "$CURL" --help all 2>&1 | grep -q -- --http3-only; then "$CURL" -sS -I --http3-only -H "Host: $HOST" https://$HOST/api/healthz | head -n1; else echo "HTTP/3 not supported by this curl"; fi