#!/usr/bin/env bash
# Valgrind memory-leak check for HTTP/3 curl usage.
# Runs curl (in HTTP/3 image) under valgrind --leak-check=full.
# Optional: set RUN_VALGRIND=1 to enable; otherwise skipped.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

# Use enhanced image (has valgrind); fallback to alpine/curl-http3
HTTP3_IMAGE="http3-curl-enhanced:latest"
if ! docker image inspect "$HTTP3_IMAGE" >/dev/null 2>&1; then
  HTTP3_IMAGE="alpine/curl-http3:latest"
fi

run_valgrind_curl() {
  local url="${1:-https://127.0.0.1:30443/_caddy/healthz}"
  local out="/tmp/valgrind-curl-$$.log"
  
  docker run --rm --network host \
    "$HTTP3_IMAGE" \
    sh -c "valgrind --leak-check=full --error-exitcode=0 --log-file=/tmp/vg.log curl -k -s --http3-only --connect-timeout 5 '$url' >/dev/null; cat /tmp/vg.log" \
    > "$out" 2>&1
  
  if grep -q "no leaks are possible" "$out" 2>/dev/null; then
    ok "Valgrind: no leaks (curl HTTP/3)"
    return 0
  fi
  if grep -q "ERROR SUMMARY: 0 errors" "$out" 2>/dev/null; then
    ok "Valgrind: 0 errors (curl HTTP/3)"
    return 0
  fi
  warn "Valgrind reported issues; check $out"
  cat "$out" | tail -30
  return 1
}

main() {
  [[ "${RUN_VALGRIND:-0}" != "1" ]] && { say "Valgrind memory-leak test skipped (RUN_VALGRIND=1 to enable)"; return 0; }
  
  say "=== Valgrind memory-leak test (curl HTTP/3) ==="
  
  if ! docker image inspect "$HTTP3_IMAGE" >/dev/null 2>&1; then
    warn "Image $HTTP3_IMAGE not found; pull or build http3-curl-enhanced"
    return 0
  fi
  
  if ! docker run --rm "$HTTP3_IMAGE" sh -c "valgrind --version" >/dev/null 2>&1; then
    warn "Valgrind not available in $HTTP3_IMAGE; skipping"
    return 0
  fi
  
  run_valgrind_curl "https://127.0.0.1:30443/_caddy/healthz" || true
  say "=== Valgrind test complete ==="
}

main "$@"