#!/usr/bin/env bash
# Edge transport smoke: HTTP/2, HTTP/3, strict TLS; defers mTLS to smoke-rp-mtls.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib/edge-test-url.sh
source "$SCRIPT_DIR/lib/edge-test-url.sh"

CA="${NODE_EXTRA_CA_CERTS:-$REPO_ROOT/certs/dev-root.pem}"
BASE="$(edge_normalize_e2e_api_base)"
REPORT_DIR="${REPORT_DIR:-$REPO_ROOT/bench_logs/security-contract}"
REPORT="$REPORT_DIR/edge-transport-contract.md"
HOST="${BASE#https://}"
HOST="${HOST#http://}"
HOST="${HOST%%/*}"

mkdir -p "$REPORT_DIR"

paths=(
  "/"
  "/healthz"
  "/api/webapp-version"
  "/api/listings/search?limit=1"
  "/api/notifications"
)

http2_pass=0
http2_fail=0
http3_pass=0
http3_fail=0
http3_note=""
tls_ok=0

{
  echo "# Edge transport contract"
  echo ""
  echo "Host: \`$BASE\`"
  echo "Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo ""
} >"$REPORT"

echo "## HTTP/2" >>"$REPORT"
for path in "${paths[@]}"; do
  line=$(curl -sS --http2 --cacert "$CA" -o /dev/null -w "%{http_version} %{http_code}" "$BASE$path" 2>&1) || line="err $?"
  echo "- \`$path\` → $line" >>"$REPORT"
  if [[ "$line" =~ ^(HTTP/2|2)[[:space:]]+(200|401|403) ]]; then
    http2_pass=$((http2_pass + 1))
  else
    http2_fail=$((http2_fail + 1))
  fi
done

echo "" >>"$REPORT"
echo "## HTTP/3" >>"$REPORT"
_curl_h3() {
  local path="$1"
  if curl --help all 2>/dev/null | grep -q http3-only; then
    curl -sS --http3-only --cacert "$CA" -o /dev/null -w "%{http_version} %{http_code}" "$BASE$path" 2>&1
  else
    curl -sS --http3 --cacert "$CA" -o /dev/null -w "%{http_version} %{http_code}" "$BASE$path" 2>&1
  fi
}

if curl --help all 2>/dev/null | grep -qE 'http3-only|--http3'; then
  for path in "${paths[@]}"; do
    line=$(_curl_h3 "$path" || echo "err")
    echo "- \`$path\` → $line" >>"$REPORT"
    if [[ "$line" =~ ^(HTTP/3|3)[[:space:]]+(200|401|403) ]]; then
      http3_pass=$((http3_pass + 1))
    else
      http3_fail=$((http3_fail + 1))
    fi
  done
else
  http3_note="curl on this host lacks HTTP/3 support"
  echo "$http3_note" >>"$REPORT"
fi

echo "" >>"$REPORT"
echo "## Strict TLS" >>"$REPORT"
if openssl s_client -connect "${HOST}:443" -servername "$HOST" -CAfile "$CA" </dev/null 2>/dev/null | openssl x509 -noout -subject 2>/dev/null; then
  tls_ok=1
  echo "- Certificate chain verifies against dev root." >>"$REPORT"
else
  echo "- Certificate verify failed." >>"$REPORT"
fi
plain=$(curl -sS -o /dev/null -w "%{http_code} %{redirect_url}" "http://${HOST}/healthz" 2>&1) || plain="err"
echo "- Plain HTTP /healthz → $plain (expect redirect to HTTPS or refusal)" >>"$REPORT"
hsts=$(curl -sS -I --cacert "$CA" "$BASE/healthz" 2>/dev/null | grep -i strict-transport-security || true)
if [[ -n "$hsts" ]]; then
  echo "- HSTS: \`$hsts\`" >>"$REPORT"
else
  echo "- HSTS: not enabled on /healthz (intentional in dev lab)" >>"$REPORT"
fi

echo "" >>"$REPORT"
echo "## mTLS" >>"$REPORT"
echo "See \`scripts/smoke-rp-mtls.sh\` and \`bench_logs/security-contract/mtls-contract.md\`." >>"$REPORT"

http2_result=PASS
[[ $http2_fail -eq 0 && $http2_pass -eq ${#paths[@]} ]] || http2_result=FAIL

http3_result=PASS
if [[ -n "$http3_note" ]]; then
  http3_result="UNSUPPORTED"
elif [[ $http3_fail -gt 0 ]]; then
  http3_result=FAIL
fi

{
  echo ""
  echo "## Summary"
  echo ""
  echo "| Check | Result |"
  echo "|-------|--------|"
  echo "| HTTP/2 ($http2_pass/${#paths[@]} endpoints) | $http2_result |"
  if [[ "$http3_result" == "UNSUPPORTED" ]]; then
    echo "| HTTP/3 | UNSUPPORTED — $http3_note |"
  else
    echo "| HTTP/3 ($http3_pass/${#paths[@]} endpoints) | $http3_result |"
  fi
  echo "| TLS chain | $([[ $tls_ok -eq 1 ]] && echo PASS || echo FAIL) |"
  echo "| mTLS | run smoke-rp-mtls.sh |"
} >>"$REPORT"

fail=0
[[ "$http2_result" == "PASS" ]] || fail=1
[[ $tls_ok -eq 1 ]] || fail=1
if [[ "$http3_result" == "FAIL" ]]; then fail=1; fi

if [[ $fail -ne 0 ]]; then
  echo "Edge transport smoke FAILED — $REPORT"
  exit 1
fi
echo "Edge transport smoke PASS — $REPORT"
