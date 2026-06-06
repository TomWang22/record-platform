#!/usr/bin/env bash
# Phase 2: generate frontend → API contract matrix (static scan + edge curl probes).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$REPO_ROOT/bench_logs/frontend-contract"
OUT_FILE="$OUT_DIR/api-route-schema-matrix.md"
mkdir -p "$OUT_DIR"

# shellcheck source=scripts/lib/edge-test-url.sh
source "$REPO_ROOT/scripts/lib/edge-test-url.sh"
EDGE="$(edge_normalize_e2e_api_base)"

{
  echo "# API route / schema matrix"
  echo ""
  echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Edge base: \`$EDGE\`"
  echo ""
  echo "| Frontend | Method | Path | Auth | Edge probe |"
  echo "|----------|--------|------|------|------------|"

  if command -v rg >/dev/null 2>&1; then
    rg -n "apiFetch\(['\`]/api/" webapp --glob '*.{ts,tsx}' -o \
      | sed -E "s/^([^:]+):[0-9]+:apiFetch\(['\`]([^'\`]+)/\1|\2/" \
      | sort -u \
      | while IFS='|' read -r file path; do
        echo "| \`$file\` | GET | \`$path\` | optional | pending |"
      done
  else
    grep -RIn "apiFetch('/api/" webapp --include='*.ts' --include='*.tsx' \
      | sed -E "s/^([^:]+):[0-9]+:.*apiFetch\(['\`]([^'\`]+).*/\1|\2/" \
      | sort -u \
      | while IFS='|' read -r file path; do
        echo "| \`$file\` | GET | \`$path\` | optional | pending |"
      done
  fi

  echo ""
  echo "## Gateway routes (api-gateway/src/app.ts)"
  echo ""
  echo '```'
  if command -v rg >/dev/null 2>&1; then
    rg -n "app\.(get|post|put|patch|delete)\(" services/api-gateway/src/app.ts \
      | sed -n '1,120p' || true
  else
    grep -En "app\.(get|post|put|patch|delete)\(" services/api-gateway/src/app.ts \
      | sed -n '1,120p' || true
  fi
  echo '```'

  echo ""
  echo "## Edge curl probes (unauthenticated)"
  echo ""
  for path in \
    "/api/records" \
    "/api/listings/search?q=test" \
    "/api/cart" \
    "/api/settings" \
    "/api/marketplace/comparables?q=test" \
    "/api/auctions/monitor" \
    ; do
    code="$(curl -sk -o /tmp/rp-matrix-body.txt -w '%{http_code}' "$EDGE$path" || echo "000")"
    ctype="$(curl -skI "$EDGE$path" 2>/dev/null | awk -F': ' 'tolower($1)=="content-type"{print $2}' | tr -d '\r' | sed -n '1p')"
    snippet="$(tr '\n' ' ' < /tmp/rp-matrix-body.txt | cut -c1-80)"
    echo "- \`GET $path\` → HTTP $code, Content-Type: ${ctype:-unknown}, body: \`${snippet}\`"
  done

  echo ""
  echo "## Rules"
  echo "- \`/api/*\` must return JSON (never HTML)."
  echo "- UI pages must return HTML (never raw JSON auth errors)."
  echo "- Search routes must not hit UUID detail handlers."
} > "$OUT_FILE"

echo "Wrote $OUT_FILE"
