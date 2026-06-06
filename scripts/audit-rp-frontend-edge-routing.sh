#!/usr/bin/env bash
# Audit edge routing: pages return HTML, /api/* returns JSON, no ambiguous client paths.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_URL="${BASE_URL:-https://record-platform.test}"

failures=0

log() { printf '%s\n' "$*"; }
fail() { log "FAIL: $*"; failures=$((failures + 1)); }
pass() { log "PASS: $*"; }

curl_json() {
  curl -sk "$1" -H 'Accept: application/json'
}

curl_headers() {
  curl -skI "$1"
}

content_type() {
  curl_headers "$1" | awk -F': ' 'tolower($1)=="content-type" {print tolower($2); exit}' | tr -d '\r'
}

body_head() {
  curl -sk "$1" | head -c 400
}

is_html_ct() {
  [[ "$1" == *text/html* ]]
}

is_json_ct() {
  [[ "$1" == *application/json* ]] || [[ "$1" == *+json* ]]
}

looks_like_html_body() {
  local body="$1"
  [[ "$body" == *"<!DOCTYPE"* ]] || [[ "$body" == *"<html"* ]]
}

check_page_html() {
  local path="$1"
  local ct body
  ct="$(content_type "${BASE_URL}${path}")"
  body="$(body_head "${BASE_URL}${path}")"
  if is_html_ct "$ct" || looks_like_html_body "$body"; then
    pass "page ${path} returns HTML"
  else
    fail "page ${path} expected HTML (content-type=${ct:-unknown})"
  fi
  if [[ "$body" == *'"error":"auth required"'* ]] || [[ "$body" == *'"error": "auth required"'* ]]; then
    fail "page ${path} returns raw auth JSON instead of HTML UI"
  fi
}

check_api_json() {
  local path="$1"
  local expect_status="${2:-any}"
  local ct body status
  status="$(curl -sk -o /tmp/rp-audit-body.txt -w '%{http_code}' "${BASE_URL}${path}" -H 'Accept: application/json')"
  ct="$(curl -skI "${BASE_URL}${path}" -H 'Accept: application/json' | awk -F': ' 'tolower($1)=="content-type" {print tolower($2); exit}' | tr -d '\r')"
  body="$(head -c 400 /tmp/rp-audit-body.txt)"

  if looks_like_html_body "$body" || is_html_ct "$ct"; then
    fail "API ${path} returned HTML (status=${status}, content-type=${ct:-unknown})"
    return
  fi

  if ! echo "$body" | jq -e . >/dev/null 2>&1; then
    fail "API ${path} body is not valid JSON (status=${status})"
    return
  fi

  if [[ "$expect_status" != "any" && "$status" != "$expect_status" ]]; then
    fail "API ${path} status ${status} (expected ${expect_status})"
    return
  fi

  pass "API ${path} returns JSON (status=${status})"
}

log "=== Record Platform frontend edge routing audit ==="
log "BASE_URL=${BASE_URL}"
log ""

log "--- Page routes (expect HTML) ---"
for path in / /records /records/new /listings /cart /market /auctions /forum /settings /login; do
  check_page_html "$path"
done

log ""
log "--- API routes (expect JSON, never HTML) ---"
for path in \
  /api/records \
  /api/listings/search \
  /api/listings/settings \
  /api/settings \
  /api/cart \
  /api/marketplace/comparables?q=test \
  /api/readyz \
  /api/healthz; do
  check_api_json "$path"
done

log ""
log "--- Client code: forbid ambiguous API paths ---"
AMBIGUOUS_PATTERNS=(
  "apiFetch\\([^)]*['\`]/records"
  "apiFetch\\([^)]*['\`]/listings/search"
  "apiFetch\\([^)]*['\`]/listings/settings"
  "apiFetch\\([^)]*['\`]/shopping/cart"
  "fetch\\([^)]*['\`]/records"
  "fetch\\([^)]*['\`]/listings/search"
)

for pattern in "${AMBIGUOUS_PATTERNS[@]}"; do
  if rg -n "$pattern" "${ROOT}/webapp" --glob '*.{ts,tsx}' --glob '!**/.next/**' 2>/dev/null | grep -v '/api/' >/dev/null; then
    fail "ambiguous client fetch still present: ${pattern}"
    rg -n "$pattern" "${ROOT}/webapp" --glob '*.{ts,tsx}' --glob '!**/.next/**' 2>/dev/null | grep -v '/api/' || true
  else
    pass "no ambiguous client path: ${pattern}"
  fi
done

log ""
if [[ "$failures" -gt 0 ]]; then
  log "=== ${failures} failure(s) ==="
  exit 1
fi

log "=== All routing checks passed ==="
