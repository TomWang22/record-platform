#!/usr/bin/env bash
# Release image freshness: local :dev labels + pod images + webapp buildSha + strict TLS /api/readyz.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=scripts/lib/edge-test-url.sh
source "$SCRIPT_DIR/lib/edge-test-url.sh"

NS="${RP_K8S_NS:-record-platform}"
REPORT_DIR="${REPORT_DIR:-$REPO_ROOT/bench_logs/release-contract}"
REPORT="${REPORT:-$REPORT_DIR/t14-image-freshness.md}"
FAIL=0

mkdir -p "$REPORT_DIR"
EXPECTED_SHA="$(git -C "$REPO_ROOT" rev-parse --short=12 HEAD)"

CA="${RP_EDGE_CA:-$REPO_ROOT/certs/dev-chain.pem}"
[[ -f "$CA" ]] || CA="$REPO_ROOT/certs/dev-root.pem"

{
  echo "# Release image freshness"
  echo ""
  echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Expected source SHA (short): \`$EXPECTED_SHA\`"
  echo ""
} >"$REPORT"

echo "=== rp-release-image-freshness ==="

echo "▶ audit-rp-image-freshness.sh"
if bash "$SCRIPT_DIR/audit-rp-image-freshness.sh" >>"$REPORT" 2>&1; then
  echo "  OK audit-rp-image-freshness" | tee -a "$REPORT"
else
  echo "  FAIL audit-rp-image-freshness" | tee -a "$REPORT" >&2
  FAIL=1
fi

echo "" >>"$REPORT"
echo "## Edge /api/readyz (strict TLS)" >>"$REPORT"

BASE="$(edge_normalize_e2e_api_base 2>/dev/null || echo "https://record-platform.test")"
HOST="$(edge_hostname_from_https_url "$BASE")"
IP="$(kubectl -n "${RP_INGRESS_NS:-ingress-nginx}" get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
if [[ -z "$IP" ]]; then
  echo "FAIL: no Caddy LoadBalancer IP" | tee -a "$REPORT" >&2
  FAIL=1
else
  code="$(curl -sS -o /dev/null -w '%{http_code}' --cacert "$CA" --resolve "${HOST}:443:${IP}" "${BASE}/api/readyz" 2>/dev/null || echo 000)"
  echo "  GET /api/readyz → HTTP $code (strict TLS)" | tee -a "$REPORT"
  [[ "$code" == "200" ]] || FAIL=1
fi

echo "" >>"$REPORT"
echo "## webapp buildSha" >>"$REPORT"

if [[ -n "${IP:-}" ]]; then
  version_json="$(curl -sS --cacert "$CA" --resolve "${HOST}:443:${IP}" "${BASE}/api/webapp-version" 2>/dev/null || echo '{}')"
  edge_sha="$(printf '%s' "$version_json" | tr -d '\n' | sed -n 's/.*"buildSha"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  echo "  edge buildSha: \`${edge_sha:-unknown}\`" | tee -a "$REPORT"
  if [[ "$edge_sha" == "$EXPECTED_SHA" ]]; then
    echo "  OK buildSha matches HEAD" | tee -a "$REPORT"
  else
    echo "  FAIL buildSha '$edge_sha' != expected '$EXPECTED_SHA'" | tee -a "$REPORT" >&2
    FAIL=1
  fi
fi

if [[ "$FAIL" -eq 0 ]]; then
  echo "rp-release-image-freshness PASS — $REPORT"
  exit 0
fi
echo "rp-release-image-freshness FAIL — $REPORT" >&2
exit 1
