#!/usr/bin/env bash
# Fail if edge HTML shows stale RP/housing/dev-provider UI.
set -euo pipefail

BASE="${RP_EDGE_BASE:-https://record-platform.test}"
REPORT_DIR="${REPORT_DIR:-bench_logs/frontend-contract}"
mkdir -p "$REPORT_DIR"
REPORT="$REPORT_DIR/webapp-edge-staleness-proof.md"
JSON_OUT="${REPORT_DIR}/webapp-edge-staleness.json"

fail=0
results=()

curl_k() {
  curl -sk --max-time 25 "$@"
}

check_stale() {
  local path="$1"
  local html
  html="$(curl_k "$BASE$path" 2>/dev/null || true)"
  local issues=()
  if echo "$html" | grep -qiE 'Provider:\s*dev|Provider dev'; then
    issues+=('provider-dev')
  fi
  if echo "$html" | grep -qi 'Off-Campus'; then issues+=('off-campus'); fi
  if echo "$html" | grep -qiE '\bHousing\b'; then issues+=('housing'); fi
  if echo "$html" | grep -q 'RP'; then issues+=('och'); fi
  if echo "$html" | grep -qiE '\bbooking\b'; then issues+=('booking'); fi
  if echo "$html" | grep -qiE '\blandlord\b'; then issues+=('landlord'); fi
  if echo "$html" | grep -qiE '\blease\b'; then issues+=('lease'); fi
  if [[ ${#issues[@]} -gt 0 ]]; then
    fail=1
    results+=("FAIL $path stale=${issues[*]}")
    return 1
  fi
  results+=("OK $path")
  return 0
}

check_positive() {
  local path="$1"
  local pattern="$2"
  local html
  html="$(curl_k "$BASE$path" 2>/dev/null || true)"
  if echo "$html" | grep -qiE "$pattern"; then
    results+=("OK $path contains expected")
    return 0
  fi
  fail=1
  results+=("FAIL $path missing pattern: $pattern")
  return 1
}

version_json="$(curl_k "$BASE/api/webapp-version" 2>/dev/null || echo '{}')"
build_sha="$(echo "$version_json" | sed -n 's/.*"buildSha"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
build_at="$(echo "$version_json" | sed -n 's/.*"buildAt"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"

{
  echo "# Webapp edge staleness proof"
  echo ""
  echo "- Base: \`$BASE\`"
  echo "- Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "- buildSha: \`${build_sha:-unknown}\`"
  echo "- buildAt: \`${build_at:-unknown}\`"
  echo ""
  echo "## Checks"
} >"$REPORT"

for path in / /profile /listings /sell /watchlist /recently-viewed /profile/feedback; do
  check_stale "$path" || true
done

check_positive /listings 'Marketplace|page size|24|Watchlist|OBO' || true
check_positive /sell 'Create listing|Sale type|Shipping|Publish|Comparables' || true
check_positive /profile 'Signed in with|Test account|Google|Discogs|Email' || true

readyz="$(curl_k -o /dev/null -w '%{http_code}' "$BASE/api/readyz" 2>/dev/null || echo 000)"
if [[ "$readyz" != "200" && "$readyz" != "204" ]]; then
  results+=("WARN /api/readyz http=$readyz")
else
  results+=("OK /api/readyz http=$readyz")
fi

for line in "${results[@]}"; do
  echo "- $line" >>"$REPORT"
done

printf '%s\n' "${results[@]}" | jq -R -s 'split("\n") | map(select(length>0))' >"$JSON_OUT" 2>/dev/null || true

if [[ "$fail" -ne 0 ]]; then
  echo "❌ Stale UI detected — see $REPORT" >&2
  exit 1
fi
if [[ -z "$build_sha" || "$build_sha" == "unknown" ]]; then
  echo "❌ /api/webapp-version buildSha missing or unknown" >&2
  exit 1
fi
echo "✅ Edge staleness guard passed — $REPORT"
