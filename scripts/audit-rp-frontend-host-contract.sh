#!/usr/bin/env bash
# Phase 0: forbid host drift (record.test, RP) in active RP frontend/backend runtime paths.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=scripts/lib/edge-test-url.sh
source "$REPO_ROOT/scripts/lib/edge-test-url.sh"

EDGE_BASE="$(edge_normalize_e2e_api_base)"
FAIL=0

fail() {
  echo "❌ $*"
  FAIL=1
}

ok() {
  echo "✅ $*"
}

FORBIDDEN_HOST_RE='record\.test'
FORBIDDEN_RP_RE='(record-platform|/och/|\boch\b|housing)'

# Active runtime paths (exclude toolkit-reference, docs bundles, test-results)
SCAN_PATHS=(
  webapp/lib webapp/app webapp/components webapp/e2e
  services/common/src
  services/api-gateway/src
  services/auth-service/src
  infra/k8s
  Caddyfile
)

echo "=== RP host contract audit ==="
echo "Edge base: $EDGE_BASE"

if [[ "$EDGE_BASE" != "https://record-platform.test" ]]; then
  fail "E2E edge must be https://record-platform.test (got $EDGE_BASE)"
else
  ok "Edge base is record-platform.test"
fi

if [[ -f webapp/playwright.config.ts ]]; then
  if grep -q 'record-platform\.test' webapp/playwright.config.ts; then
    ok "playwright.config.ts uses record-platform.test"
  else
    fail "playwright.config.ts missing record-platform.test default"
  fi
fi

echo ""
echo "--- Forbidden host: record.test (active paths) ---"
HOST_HITS=0
for root in "${SCAN_PATHS[@]}"; do
  [[ -e "$root" ]] || continue
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    # Allow explicit rejection lists / migration guards
    if [[ "$line" == *'!== "record.test"'* ]] || [[ "$line" == *'record\.test'*'audit'* ]]; then
      continue
    fi
  done < <(rg -n "$FORBIDDEN_HOST_RE" "$root" 2>/dev/null || true)
done

_grep_scan() {
  if command -v rg >/dev/null 2>&1; then
    rg -n "$@"
  else
    grep -RIn "$@"
  fi
}

if _grep_scan "$FORBIDDEN_HOST_RE" "${SCAN_PATHS[@]}" 2>/dev/null \
  | grep -v '!== "record.test"' \
  | grep -v 'FORBIDDEN_HOST' \
  | grep -v 'record\.test.*forbid' \
  | grep -v 'legacy record\.test' \
  | grep -v 'must not use legacy record\.test' \
  | head -40; then
  fail "Found record.test in active runtime paths (see above)"
  HOST_HITS=1
else
  ok "No record.test in active runtime paths"
fi

echo ""
echo "--- Forbidden RP strings (webapp + services + infra/k8s) ---"
if _grep_scan -i "$FORBIDDEN_RP_RE" webapp services infra/k8s \
  --glob '!**/toolkit-reference/**' \
  --glob '!**/*.md' \
  --glob '!**/node_modules/**' \
  2>/dev/null | head -30; then
  fail "Found RP/housing contamination in active paths"
else
  ok "No RP/housing strings in active webapp/services/k8s"
fi

echo ""
echo "--- gRPC TLS SNI must not default to public edge host ---"
if _grep_scan 'record\.test' services/common/src/grpc-clients.ts 2>/dev/null \
  | grep -v '!== "record.test"' | grep -q .; then
  fail "grpc-clients.ts still uses record.test as active SNI default"
else
  ok "grpc-clients.ts rejects record.test as SNI"
fi

if _grep_scan 'grpc\.ssl_target_name_override' services/common/src/grpc-clients.ts >/dev/null; then
  ok "grpc ssl_target_name_override present"
else
  fail "grpc-clients.ts missing ssl_target_name_override"
fi

echo ""
echo "--- Playwright / E2E edge ---"
if _grep_scan 'record\.test' webapp/e2e webapp/playwright.config.ts 2>/dev/null | grep -v 'legacy' | head -5; then
  fail "E2E still references record.test"
else
  ok "E2E uses record-platform.test"
fi

echo ""
echo "--- Edge auth smoke (optional) ---"
if command -v curl >/dev/null; then
  code="$(curl -sk -o /dev/null -w '%{http_code}' -X POST "$EDGE_BASE/auth/login" \
    -H 'Content-Type: application/json' \
    -d '{"email":"collector@record-platform.local","password":"record-platform-dev-test"}' || true)"
  if [[ "$code" == "200" || "$code" == "401" ]]; then
    ok "POST $EDGE_BASE/auth/login reachable (HTTP $code)"
  else
    fail "POST $EDGE_BASE/auth/login returned HTTP $code (expected 200/401; 503 often means gRPC TLS SNI drift)"
  fi
fi

echo ""
if [[ "$FAIL" -ne 0 ]]; then
  echo "Host contract audit FAILED"
  exit 1
fi
echo "Host contract audit PASSED"
exit 0
