#!/usr/bin/env bash
# Debug network for Docker builds: npm registry and Docker Hub.
# Run from repo root. Checks host and (optionally) inside a container.
# Usage: ./scripts/debug-build-network.sh
#   IN_CONTAINER=1  also run checks inside a node:20-alpine container (simulates build)

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

IN_CONTAINER="${IN_CONTAINER:-0}"
# 30s: first connection to Docker Hub (e.g. IPv6) can be slow; 15s often false-fails
TIMEOUT="${TIMEOUT:-30}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
fail(){ echo "❌ $*"; }

# URLs that must work during build
NPM_REGISTRY="https://registry.npmjs.org"
NPM_PKG="https://registry.npmjs.org/pnpm/-/pnpm-9.11.0.tgz"
DOCKER_HUB="https://registry-1.docker.io/v2/"
GITHUB_CR="https://ghcr.io/v2/"

check_url() {
  local url="$1" name="$2"
  if curl -sSfL --connect-timeout "$TIMEOUT" --max-time "$((TIMEOUT + 5))" -o /dev/null -w "%{http_code}" "$url" 2>/dev/null | grep -qE '^[23]'; then
    ok "$name: reachable"
    return 0
  else
    fail "$name: failed or timeout (${TIMEOUT}s)"
    return 1
  fi
}

say "1. Host proxy env (if set)"
for v in HTTP_PROXY HTTPS_PROXY http_proxy https_proxy NO_PROXY no_proxy; do
  [[ -n "${!v:-}" ]] && echo "   $v=${!v}"
done
[[ -z "${HTTP_PROXY:-}${HTTPS_PROXY:-}" ]] && echo "   No HTTP(S)_PROXY set"

say "2. Host connectivity (timeout ${TIMEOUT}s)"
check_url "$NPM_REGISTRY" "registry.npmjs.org" || true
check_url "$NPM_PKG" "npm pnpm tarball" || true
check_url "$DOCKER_HUB" "Docker Hub v2" || true
check_url "$GITHUB_CR" "ghcr.io v2" || true

say "3. Host DNS"
for h in registry.npmjs.org registry-1.docker.io ghcr.io; do
  if getent hosts "$h" 2>/dev/null | head -1 || nslookup "$h" 2>/dev/null | grep -q "Address"; then
    ok "resolve $h"
  else
    fail "resolve $h"
  fi
done

if [[ "$IN_CONTAINER" != "1" ]]; then
  say "4. Docker daemon (pull test)"
  if ( docker pull --disable-content-trust busybox:1.36 2>&1 | tail -3 ); then
    ok "Docker pull works"
  else
    warn "Docker pull failed (check daemon network/proxy)"
  fi
  say "5. Fix options (see docs/BUILD_NETWORK_FIX.md)"
  echo "   - Build with host network: DOCKER_BUILD_NETWORK=host ./scripts/build-and-load-k3d.sh"
  echo "   - Set Docker daemon proxy in ~/.docker/daemon.json or Docker Desktop"
  echo "   - Set HTTP_PROXY/HTTPS_PROXY before docker build if behind corporate proxy"
  echo "   - Retry: builds use host network by default in our script when BUILD_NETWORK=host"
  exit 0
fi

say "4. Inside container (node:20-alpine, simulates build)"
docker run --rm --network host node:20-alpine sh -c "
  echo '   Checking from container...'
  apk add --no-cache curl 2>/dev/null
  for u in $NPM_REGISTRY $DOCKER_HUB; do
    if curl -sSfL --connect-timeout $TIMEOUT -o /dev/null \"\$u\" 2>/dev/null; then
      echo \"   OK \$u\"
    else
      echo \"   FAIL \$u\"
    fi
  done
" 2>&1 || warn "Container check failed (run without IN_CONTAINER=1 for host-only)"

say "Done. See docs/BUILD_NETWORK_FIX.md for fixes."
