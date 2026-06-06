#!/usr/bin/env bash
# Frontend page contract smoke via Caddy edge (record-platform.test), not localhost.
# Runs Playwright frontend-contract + ui-screenshots; writes bench_logs/frontend-contract/report.md
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=lib/edge-test-url.sh
source "$SCRIPT_DIR/lib/edge-test-url.sh"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
fail() { echo "❌ $*" >&2; }

CA="${NODE_EXTRA_CA_CERTS:-$REPO_ROOT/certs/dev-root.pem}"
export NODE_EXTRA_CA_CERTS="$CA"
export E2E_API_BASE="$(edge_normalize_e2e_api_base)" || exit 1
edge_require_host_resolves "$E2E_API_BASE" || exit 1

REPORT_DIR="$REPO_ROOT/bench_logs/frontend-contract"
mkdir -p "$REPORT_DIR"

say "Frontend smoke — edge ${E2E_API_BASE}"

if [[ ! -s "$CA" ]]; then
  fail "Missing CA: $CA"
  exit 1
fi

say "Edge readiness"
curl -fsS --cacert "$CA" "${E2E_API_BASE}/api/readyz" >/dev/null
ok "/api/readyz"

say "Playwright frontend contract"
(
  cd "$REPO_ROOT/webapp"
  pnpm exec playwright test \
    e2e/frontend-contract.spec.ts \
    e2e/route-identity.spec.ts \
    e2e/ui-screenshots.spec.ts \
    --reporter=list
) | tee "$REPORT_DIR/playwright.log"

say "Curl page matrix (status codes)"
{
  echo "# Frontend edge curl matrix"
  echo ""
  echo "Host: ${E2E_API_BASE}"
  echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo ""
  echo "| Path | HTTP |"
  echo "|------|------|"
  for path in / /login /register /records /listings /cart /market /messages /insights \
    /integrations /observation-deck /settings /privacy /terms /about /dashboard; do
  code=$(curl -sk -o /dev/null -w "%{http_code}" --cacert "$CA" "${E2E_API_BASE}${path}" || echo "err")
  echo "| \`${path}\` | ${code} |"
  done
} > "$REPORT_DIR/curl-matrix.md"

ok "Report artifacts: $REPORT_DIR/"
echo "  - playwright.log"
echo "  - curl-matrix.md"
echo "  - report.md (update via agent or re-run generator)"
