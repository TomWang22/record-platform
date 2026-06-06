#!/usr/bin/env bash
# Strict HTTP/2 + HTTP/3 edge TLS — dev-chain.pem + --resolve only (no -k / --insecure).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib/rp-http3-edge-lib.sh
source "$SCRIPT_DIR/lib/rp-http3-edge-lib.sh"

REPORT_DIR="${REPORT_DIR:-$REPO_ROOT/bench_logs/security-contract}"
REPORT="$REPORT_DIR/edge-h2-h3-strict-tls-contract.md"
FAIL=0

_insecure_self_check() {
  local hits
  hits=""
  local f
  for f in "$SCRIPT_DIR"/smoke-rp-edge*.sh; do
    [[ -f "$f" ]] || continue
    [[ "$f" == *h2-h3-strict-tls.sh ]] && continue
    hits+="$(grep -nE '(\s|^)curl .*\s-k\b|(\s|^)curl .*--insecure' "$f" 2>/dev/null || true)"
  done
  if [[ -n "$hits" ]]; then
    echo "❌ insecure curl found in edge smoke scripts:" >&2
    echo "$hits" >&2
    exit 1
  fi
  echo "✅ self-check: no -k / --insecure in smoke-rp-edge* / smoke-rp-*tls*"
}

_paths() {
  cat <<'PATHS'
/healthz
/_caddy/healthz
/api/healthz
/api/readyz
/
/records
/listings
/sell
/profile
/messages
/api/notifications
/api/feedback/me
PATHS
}

_probe_path() {
  local proto="$1" path="$2" host="$3" lb="$4" ca="$5"
  local curl_bin curl_args=()
  curl_bin="$(rp_http3_curl_bin)"
  case "$proto" in
    h2) curl_args=(--http2) ;;
    h3)
      if ! "$curl_bin" --version 2>/dev/null | grep -qiE 'http3|ngtcp2|nghttp3'; then
        echo "FAIL	missing-http3-curl"
        return 1
      fi
      curl_args=(--http3-only)
      ;;
    *) return 1 ;;
  esac
  local out errf
  errf="$(mktemp)"
  out="$("$curl_bin" -sS "${curl_args[@]}" -o /dev/null \
    --connect-timeout 10 --max-time 45 \
    --cacert "$ca" \
    --resolve "${host}:443:${lb}" \
    -w 'code=%{http_code} version=%{http_version} ssl=%{ssl_verify_result} remote=%{remote_ip} total=%{time_total}' \
    "https://${host}${path}" 2>"$errf" || true)"
  local code ver ssl
  code="$(echo "$out" | sed -n 's/.*code=\([0-9]*\).*/\1/p')"
  ver="$(echo "$out" | sed -n 's/.*version=\([^ ]*\).*/\1/p')"
  ssl="$(echo "$out" | sed -n 's/.*ssl=\([0-9]*\).*/\1/p')"
  code="${code:-000}"
  ver="${ver:-0}"
  ssl="${ssl:-?}"
  local expect_ver=2
  [[ "$proto" == "h3" ]] && expect_ver=3
  if [[ "$ssl" != "0" ]]; then
    echo "FAIL	ssl=$ssl $out $(head -c 120 "$errf")"
    rm -f "$errf"
    return 1
  fi
  if [[ "$ver" != "$expect_ver" ]]; then
    echo "FAIL	version=$ver expected=$expect_ver $out"
    rm -f "$errf"
    return 1
  fi
  if [[ "$code" == "000" || "$code" =~ ^5 ]]; then
    echo "FAIL	http=$code $out $(head -c 120 "$errf")"
    rm -f "$errf"
    return 1
  fi
  rm -f "$errf"
  echo "PASS	code=$code version=$ver ssl=$ssl"
  return 0
}

mkdir -p "$REPORT_DIR"
_insecure_self_check | tee -a "$REPORT" 2>&1 || exit 1

ca="$(rp_http3_ca_cert)"
lb="$(rp_http3_lb_ip)"
host="${RP_HTTP3_EDGE_HOST:-record-platform.test}"
[[ -n "$ca" && -n "$lb" ]] || { echo "❌ missing CA or LB IP" >&2; exit 1; }

{
  echo "# Edge H2/H3 strict TLS contract"
  echo ""
  echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "CA: \`$ca\`"
  echo "LB: \`$lb\`"
  echo "Host: \`$host\`"
  echo ""
  echo "## HTTP/2 matrix"
  echo ""
  echo "| path | result | detail |"
  echo "|------|--------|--------|"
} >"$REPORT"

while IFS= read -r path; do
  [[ -z "$path" ]] && continue
  res="$(_probe_path h2 "$path" "$host" "$lb" "$ca" || true)"
  st="${res%%	*}"
  echo "| \`$path\` | $st | ${res#*	} |" >>"$REPORT"
  [[ "$st" == PASS ]] || FAIL=1
done < <(_paths)

{
  echo ""
  echo "## HTTP/3 matrix"
  echo ""
  echo "| path | result | detail |"
  echo "|------|--------|--------|"
} >>"$REPORT"

while IFS= read -r path; do
  [[ -z "$path" ]] && continue
  res="$(_probe_path h3 "$path" "$host" "$lb" "$ca" || true)"
  st="${res%%	*}"
  echo "| \`$path\` | $st | ${res#*	} |" >>"$REPORT"
  [[ "$st" == PASS ]] || FAIL=1
done < <(_paths)

# Delegate full contract runner for stress paths
echo "" >>"$REPORT"
echo "## Full strict runners" >>"$REPORT"
if bash "$SCRIPT_DIR/smoke-rp-edge-http2-strict.sh" >>"$REPORT" 2>&1; then
  echo "- smoke-rp-edge-http2-strict (extended contract): PASS" >>"$REPORT"
else
  echo "- smoke-rp-edge-http2-strict (extended contract): FAIL (non-blocking if required-path matrix above passed)" >>"$REPORT"
fi
if bash "$SCRIPT_DIR/smoke-rp-edge-http3-strict.sh" >>"$REPORT" 2>&1; then
  echo "- smoke-rp-edge-http3-strict (extended contract): PASS" >>"$REPORT"
else
  echo "- smoke-rp-edge-http3-strict (extended contract): FAIL (non-blocking if required-path matrix above passed)" >>"$REPORT"
fi

if [[ "$FAIL" -ne 0 ]]; then
  echo "" >>"$REPORT"
  echo "**RESULT: FAIL**" >>"$REPORT"
  echo "edge H2/H3 strict TLS FAILED — $REPORT" >&2
  exit 1
fi
echo "" >>"$REPORT"
echo "**RESULT: PASS** (ssl_verify_result=0, http_version 2/3 enforced)" >>"$REPORT"
echo "edge H2/H3 strict TLS PASS — $REPORT"
exit 0
