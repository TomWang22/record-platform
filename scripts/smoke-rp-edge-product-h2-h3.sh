#!/usr/bin/env bash
# Product-critical routes over HTTP/2 and HTTP/3 with strict TLS (RCA-8).
# Uses --cacert certs/dev-chain.pem and --resolve only (never -k).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib/rp-http3-edge-lib.sh
source "$SCRIPT_DIR/lib/rp-http3-edge-lib.sh"
# shellcheck source=lib/rp-dev-ca.sh
source "$SCRIPT_DIR/lib/rp-dev-ca.sh"
# shellcheck source=lib/edge-test-url.sh
source "$SCRIPT_DIR/lib/edge-test-url.sh"

REPORT_DIR="${REPORT_DIR:-$REPO_ROOT/bench_logs/security-contract}"
REPORT="${REPORT_DIR}/edge-product-h2-h3-contract.md"
FAIL=0

ca="$(rp_http3_ca_cert)"
lb="$(rp_http3_lb_ip)"
host="${RP_HTTP3_EDGE_HOST:-record-platform.test}"
base="$(edge_normalize_e2e_api_base 2>/dev/null || echo "https://${host}")"
pass="${RP_COMB_PASSWORD:-ContractPass123!}"
email="${RP_COMB_EMAIL:-e2e-contract@record-platform.local}"

[[ -n "$ca" && -n "$lb" ]] || { echo "❌ missing CA or LB IP" >&2; exit 1; }

curl_bin="$(rp_http3_curl_bin)"
CURL_RESOLVE=(--resolve "${host}:443:${lb}")

_allowed_status() {
  local code="$1"
  [[ "$code" =~ ^(200|201|204|301|302|307|308|401|403|404)$ ]]
}

_probe() {
  local proto="$1" path="$2" auth="${3:-0}"
  local curl_args=()
  case "$proto" in
    h2) curl_args=(--http2) ;;
    h3)
      if ! "$curl_bin" --version 2>/dev/null | grep -qiE 'http3|ngtcp2|nghttp3'; then
        echo "FAIL	missing-http3-curl"
        return 1
      fi
      curl_args=(--http3-only) ;;
    *) return 1 ;;
  esac
  local hdr=(-H 'X-RP-E2E-Contract: 1')
  if [[ "$auth" == "1" && -n "${TOKEN:-}" ]]; then
    hdr+=(-H "Authorization: Bearer $TOKEN")
  fi
  local errf out code ver ssl total
  errf="$(mktemp)"
  out="$("$curl_bin" -sS "${curl_args[@]}" -o /dev/null \
    --connect-timeout 12 --max-time 45 \
    --cacert "$ca" "${CURL_RESOLVE[@]}" \
    "${hdr[@]}" \
    -w 'code=%{http_code} version=%{http_version} ssl=%{ssl_verify_result} total=%{time_total}' \
    "${base}${path}" 2>"$errf" || true)"
  code="$(echo "$out" | sed -n 's/.*code=\([0-9]*\).*/\1/p')"
  ver="$(echo "$out" | sed -n 's/.*version=\([^ ]*\).*/\1/p')"
  ssl="$(echo "$out" | sed -n 's/.*ssl=\([0-9]*\).*/\1/p')"
  total="$(echo "$out" | sed -n 's/.*total=\([^ ]*\).*/\1/p')"
  code="${code:-000}"
  ver="${ver:-0}"
  ssl="${ssl:-?}"
  total="${total:-?}"
  local expect_ver=2
  [[ "$proto" == "h3" ]] && expect_ver=3
  if [[ "$ssl" != "0" ]]; then
    echo "FAIL	ssl=$ssl $out $(head -c 80 "$errf")"
    rm -f "$errf"
    return 1
  fi
  if [[ "$ver" != "$expect_ver" ]]; then
    echo "FAIL	version=$ver expected=$expect_ver $out"
    rm -f "$errf"
    return 1
  fi
  if ! _allowed_status "$code"; then
    echo "FAIL	http=$code $out"
    rm -f "$errf"
    return 1
  fi
  rm -f "$errf"
  echo "PASS	code=$code version=$ver ssl=$ssl total=${total}s"
  return 0
}

mkdir -p "$REPORT_DIR"

echo "=== Product H2/H3 edge smoke (RCA-8) ==="

TOKEN="$(curl -sfS --max-time 15 --cacert "$ca" "${CURL_RESOLVE[@]}" -X POST "${base}/api/auth/login" \
  -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
  -d "{\"email\":\"$email\",\"password\":\"$pass\"}" 2>/dev/null \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("token") or "")' 2>/dev/null || true)"

LISTING_ID="$(curl -sfS --max-time 15 --cacert "$ca" "${CURL_RESOLVE[@]}" "${base}/api/listings/search?limit=5" \
  -H 'X-RP-E2E-Contract: 1' 2>/dev/null \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); items=d.get("items") or []; print(str((items[0] or {}).get("id") or "").strip())' 2>/dev/null || true)"
[[ -n "$LISTING_ID" ]] || { echo "❌ could not resolve listing id from search API" >&2; exit 1; }

declare -a ROUTES=(
  "/healthz|0"
  "/api/readyz|0"
  "/api/auth/healthz|0"
  "/api/listings/search?limit=5|0"
  "/api/listings/${LISTING_ID}|0"
  "/api/records|1"
  "/api/profile/feedback|1"
  "/api/notifications|1"
  "/api/messages/conversations|1"
  "/watchlist|1"
  "/recently-viewed|1"
  "/records|1"
  "/profile|1"
  "/listings/${LISTING_ID}|0"
)

ALTSVC="$("$curl_bin" -sSI --http2 --cacert "$ca" "${CURL_RESOLVE[@]}" "https://${host}/healthz" 2>/dev/null | grep -i '^alt-svc:' | head -1 || true)"

{
  echo "# Edge product H2/H3 contract (RCA-8)"
  echo ""
  echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "CA: \`$ca\`"
  echo "LB: \`$lb\`"
  echo "Host: \`$host\`"
  echo "Listing id (probe): \`$LISTING_ID\`"
  echo "Alt-Svc: \`${ALTSVC:-missing}\`"
  echo ""
  echo "## HTTP/2 matrix"
  echo ""
  echo "| route | status | http_version | ssl_verify_result | timing | result |"
  echo "|-------|--------|--------------|-------------------|--------|--------|"
} >"$REPORT"

for entry in "${ROUTES[@]}"; do
  path="${entry%%|*}"
  auth="${entry##*|}"
  res="$(_probe h2 "$path" "$auth" || true)"
  st="${res%%	*}"
  detail="${res#*	}"
  code="$(echo "$detail" | sed -n 's/.*code=\([0-9]*\).*/\1/p')"
  ver="$(echo "$detail" | sed -n 's/.*version=\([^ ]*\).*/\1/p')"
  ssl="$(echo "$detail" | sed -n 's/.*ssl=\([0-9]*\).*/\1/p')"
  total="$(echo "$detail" | sed -n 's/.*total=\([^ ]*\).*/\1/p')"
  echo "| \`$path\` | $code | $ver | $ssl | ${total}s | $st |" >>"$REPORT"
  [[ "$st" == PASS ]] || FAIL=1
done

{
  echo ""
  echo "## HTTP/3 matrix"
  echo ""
  echo "| route | status | http_version | ssl_verify_result | timing | result |"
  echo "|-------|--------|--------------|-------------------|--------|--------|"
} >>"$REPORT"

for entry in "${ROUTES[@]}"; do
  path="${entry%%|*}"
  auth="${entry##*|}"
  res="$(_probe h3 "$path" "$auth" || true)"
  st="${res%%	*}"
  detail="${res#*	}"
  code="$(echo "$detail" | sed -n 's/.*code=\([0-9]*\).*/\1/p')"
  ver="$(echo "$detail" | sed -n 's/.*version=\([^ ]*\).*/\1/p')"
  ssl="$(echo "$detail" | sed -n 's/.*ssl=\([0-9]*\).*/\1/p')"
  total="$(echo "$detail" | sed -n 's/.*total=\([^ ]*\).*/\1/p')"
  echo "| \`$path\` | $code | $ver | $ssl | ${total}s | $st |" >>"$REPORT"
  [[ "$st" == PASS ]] || FAIL=1
done

if echo "$ALTSVC" | grep -qi 'h3'; then
  echo "" >>"$REPORT"
  echo "Alt-Svc advertises HTTP/3: **yes**" >>"$REPORT"
else
  echo "" >>"$REPORT"
  echo "Alt-Svc advertises HTTP/3: **no**" >>"$REPORT"
  FAIL=1
fi

if [[ "$FAIL" -ne 0 ]]; then
  echo "" >>"$REPORT"
  echo "**RESULT: FAIL**" >>"$REPORT"
  echo "product H2/H3 smoke FAILED — $REPORT" >&2
  exit 1
fi
echo "" >>"$REPORT"
echo "**RESULT: PASS** (ssl_verify_result=0; http_version 2/3 enforced)" >>"$REPORT"
echo "product H2/H3 smoke PASS — $REPORT"
exit 0
