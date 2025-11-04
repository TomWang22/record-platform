#!/usr/bin/env bash
set -euo pipefail
echo '127.0.0.1 record.local' | sudo tee -a /etc/hosts >/dev/null

# Ensure pf redirect is in place if your kind hostPort is 8443
if ! sudo pfctl -s Anchors | grep -q h3-redirect; then
  ./scripts/pf-redirect.sh
fi

echo "== curl -V =="
/opt/homebrew/opt/curl/bin/curl -V

echo; echo "== H2 =="
/opt/homebrew/opt/curl/bin/curl -I -vvv --http2 -H 'Host: record.local' https://record.local/_caddy/healthz || true

echo; echo "== H3 only =="
/opt/homebrew/opt/curl/bin/curl -I -vvv --http3-only -H 'Host: record.local' https://record.local/_caddy/healthz || true