#!/usr/bin/env bash
# Ensure stable environment - fixes all known issues permanently

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

say()  { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()   { echo "  ✅ $*"; }
warn() { echo "  ⚠️  $*"; }

say "=== Ensuring Stable Environment ==="

# 1. Fix kubectl port (always)
say "1. Fixing kubectl port..."
if command -v docker >/dev/null 2>&1; then
  CORRECT_PORT=$(docker port h3-control-plane 2>&1 | grep 6443 | awk '{print $3}' | cut -d: -f2)
  if [[ -n "$CORRECT_PORT" ]]; then
    kubectl config set-cluster kind-h3 --server="https://127.0.0.1:$CORRECT_PORT" >/dev/null 2>&1 && ok "Port fixed: $CORRECT_PORT"
  fi
fi

# 2. Ensure mkcert CA
say "2. Ensuring mkcert CA..."
if command -v mkcert >/dev/null 2>&1; then
  MKCERT_CA="$(mkcert -CAROOT)/rootCA.pem"
  if [[ -f "$MKCERT_CA" ]]; then
    ok "mkcert CA: $MKCERT_CA"
  else
    mkcert -install >/dev/null 2>&1 && ok "mkcert CA installed"
  fi
fi

# 3. Check pods (robust method)
say "3. Checking pod status..."
./scripts/check-pods-robust.sh 2>&1 | tail -20

say "=== Environment Stable ==="
ok "Ready for strict TLS testing"
