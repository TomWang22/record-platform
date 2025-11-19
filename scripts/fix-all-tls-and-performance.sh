#!/usr/bin/env bash
set -euo pipefail

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

say "=== Step 1: Rotate CA and Update TLS ==="
./scripts/rotate-ca-and-fix-tls.sh

say "=== Step 2: Verify Strict TLS ==="
NS="ingress-nginx"
kubectl -n "$NS" rollout status deploy/caddy-h3 --timeout=60s
sleep 2

say "=== Step 3: Test HTTP/2 and HTTP/3 ==="
HOST="${HOST:-record.local}"
if /opt/homebrew/opt/curl/bin/curl -k -sS -I --http2 -H "Host: ${HOST}" "https://${HOST}:8443/_caddy/healthz" 2>&1 | head -n1 | grep -q "200"; then
  ok "HTTP/2 works"
else
  warn "HTTP/2 failed - check port forwarding or DNS"
fi

if /opt/homebrew/opt/curl/bin/curl -k -sS -I --http3-only -H "Host: ${HOST}" "https://${HOST}:8443/_caddy/healthz" 2>&1 | head -n1 | grep -q "200"; then
  ok "HTTP/3 works"
else
  warn "HTTP/3 failed"
fi

say "Done!"
