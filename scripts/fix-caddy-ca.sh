#!/usr/bin/env bash
set -euo pipefail

NS_ING="ingress-nginx"
HOST="${HOST:-record.local}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

# Check if mkcert CA exists
if [[ -f "$(mkcert -CAROOT 2>/dev/null)/rootCA.pem" ]]; then
  CA_PATH="$(mkcert -CAROOT)/rootCA.pem"
  ok "Found mkcert CA at: $CA_PATH"
else
  warn "mkcert CA not found. Install with: brew install mkcert && mkcert -install"
  exit 1
fi

# Update CA secret in Kubernetes
say "Updating CA secret in Kubernetes..."
kubectl -n "$NS_ING" create secret generic dev-root-ca \
  --from-file=dev-root.pem="$CA_PATH" \
  --dry-run=client -o yaml | kubectl apply -f -

ok "CA secret updated"

# Restart Caddy to pick up new CA
say "Restarting Caddy..."
kubectl -n "$NS_ING" rollout restart deploy/caddy-h3
kubectl -n "$NS_ING" rollout status deploy/caddy-h3 --timeout=60s

ok "Caddy restarted"

# Test HTTP/2 and HTTP/3
say "Testing HTTP/2 and HTTP/3..."
sleep 2

if /opt/homebrew/opt/curl/bin/curl -k -sS -I --http2 -H "Host: ${HOST}" "https://${HOST}:8443/_caddy/healthz" | head -n1 | grep -q "200"; then
  ok "HTTP/2 works"
else
  warn "HTTP/2 failed"
fi

if /opt/homebrew/opt/curl/bin/curl -k -sS -I --http3-only -H "Host: ${HOST}" "https://${HOST}:8443/_caddy/healthz" | head -n1 | grep -q "200"; then
  ok "HTTP/3 works"
else
  warn "HTTP/3 failed (may be firewall/port issue)"
fi

say "Done. Test with CA trust:"
echo "  curl -sS -I --http2 -H 'Host: ${HOST}' 'https://${HOST}:8443/_caddy/healthz'"
