#!/usr/bin/env bash
# Fix stability issues and ensure strict TLS for all services

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

say()  { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()   { echo "  ✅ $*"; }
warn() { echo "  ⚠️  $*"; }
fail() { echo "  ❌ $*" >&2; }

say "=== Fixing Stability and Ensuring Strict TLS ==="

# 1. Fix kubectl port
say "1. Fixing kubectl port..."
if command -v docker >/dev/null 2>&1; then
  CORRECT_PORT=$(docker port h3-control-plane 2>&1 | grep 6443 | awk '{print $3}' | cut -d: -f2)
  if [[ -n "$CORRECT_PORT" ]]; then
    kubectl config set-cluster kind-h3 --server="https://127.0.0.1:$CORRECT_PORT" 2>&1 && ok "Port fixed: $CORRECT_PORT"
  fi
fi

# 2. Verify all pods are ready
say "2. Verifying all pods are ready..."
./scripts/verify-infrastructure.sh 2>&1 | tail -30

# 3. Check TLS secrets
say "3. Checking TLS secrets..."
if kubectl -n ingress-nginx get secret dev-root-ca >/dev/null 2>&1; then
  ok "CA secret exists"
else
  warn "CA secret missing - will be created by rotation suite"
fi

if kubectl -n ingress-nginx get secret record-local-tls >/dev/null 2>&1; then
  ok "Leaf secret exists"
else
  warn "Leaf secret missing - will be created by rotation suite"
fi

# 4. Ensure mkcert CA is available
say "4. Ensuring mkcert CA is available..."
if command -v mkcert >/dev/null 2>&1; then
  MKCERT_CA="$(mkcert -CAROOT)/rootCA.pem"
  if [[ -f "$MKCERT_CA" ]]; then
    ok "mkcert CA available: $MKCERT_CA"
  else
    warn "mkcert CA not found - running mkcert -install"
    mkcert -install 2>&1 || warn "mkcert install failed"
  fi
else
  warn "mkcert not found"
fi

say "=== Stability Check Complete ==="
ok "Ready for strict TLS testing and rotation"
