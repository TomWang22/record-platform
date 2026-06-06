#!/usr/bin/env bash
# Real mTLS edge smoke — deny no/wrong cert, accept valid RP client cert, log evidence.
# Uses certs/mtls-test client (Caddy @mtls_ok fingerprint), never -k / --insecure.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib/edge-test-url.sh
source "$SCRIPT_DIR/lib/edge-test-url.sh"

CERT_DIR="${RP_MTLS_TEST_CERT_DIR:-$REPO_ROOT/certs/mtls-test}"
CA="${RP_MTLS_CLIENT_CA:-$REPO_ROOT/certs/dev-chain.pem}"
[[ -f "$CA" ]] || CA="$REPO_ROOT/certs/dev-root.pem"
BASE="$(edge_normalize_e2e_api_base)"
HOST="${RP_PUBLIC_HOST:-record-platform.test}"
NS="${CADDY_NS:-ingress-nginx}"
LB_IP=""
if command -v kubectl >/dev/null 2>&1; then
  LB_IP="$(kubectl -n "$NS" get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
fi
[[ -n "$LB_IP" ]] || { echo "❌ no caddy-h3 LoadBalancer IP (set LB or start cluster)" >&2; exit 1; }

CURL_RESOLVE=(--resolve "${HOST}:443:${LB_IP}")
# /mtls-healthz trusts mtls-test CA + client fingerprint in Caddyfile (not envoy-client).
CLIENT_CERT="${RP_MTLS_CLIENT_CERT:-$CERT_DIR/client.pem}"
CLIENT_KEY="${RP_MTLS_CLIENT_KEY:-$CERT_DIR/client.key}"
[[ -f "$CLIENT_CERT" && -f "$CLIENT_KEY" ]] || {
  echo "❌ missing $CLIENT_CERT or $CLIENT_KEY — run scripts/generate-rp-mtls-test-certs.sh" >&2
  exit 1
}

_insecure_self_check() {
  local hits
  hits="$(grep -RIn --exclude-dir=bench_logs \
    -E '(\s|^)curl .*\-k\b|(\s|^)curl .*--insecure' \
    "$SCRIPT_DIR"/smoke-rp-mtls-real.sh 2>/dev/null || true)"
  if [[ -n "$hits" ]]; then
    echo "❌ insecure curl invocation in smoke-rp-mtls-real.sh" >&2
    echo "$hits" >&2
    exit 1
  fi
}

OUT="${REPORT_DIR:-$REPO_ROOT/bench_logs/security-contract/mtls-real-smoke}"
REPORT="$OUT/report.md"
TSV="$OUT/results.tsv"
LOG_EXCERPT="$OUT/caddy-access-excerpt.txt"
WRONG_CERT="$OUT/wrong-client.pem"
WRONG_KEY="$OUT/wrong-client.key"

mkdir -p "$OUT"
_insecure_self_check
chmod +x "$SCRIPT_DIR/generate-rp-mtls-test-certs.sh" 2>/dev/null || true
"$SCRIPT_DIR/generate-rp-mtls-test-certs.sh"

no_cert_ok=0
wrong_cert_ok=0
valid_cert_ok=0
edge_ok=0
log_ok=0

openssl req -x509 -newkey rsa:2048 -nodes -keyout "$WRONG_KEY" -out "$WRONG_CERT" \
  -days 1 -subj "/CN=wrong-rp-mtls-smoke" 2>/dev/null

h3_code="skip"
h3_ssl=""
curl_probe() {
  local label="$1"
  shift
  local code ssl errf
  errf="$(mktemp)"
  code=$(curl -sS --http2 "${CURL_RESOLVE[@]}" "$@" -o /dev/null -w "%{http_code}" 2>"$errf" || echo "")
  ssl=$(curl -sS --http2 "${CURL_RESOLVE[@]}" "$@" -o /dev/null -w "%{ssl_verify_result}" 2>/dev/null || echo "")
  if [[ -z "$code" || "$code" == "000" ]]; then
    if grep -qiE 'SSL|certificate|alert|handshake' "$errf" 2>/dev/null; then
      code="tls_fail"
    else
      code="${code:-000}"
    fi
  fi
  rm -f "$errf"
  printf '%s\t%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$label" "$code" "$ssl" >>"$TSV"
  echo "$code|$ssl"
}

: >"$TSV"
printf 'timestamp\tcase\thttp_code\tssl_verify\n' >>"$TSV"

IFS='|' read -r no_code no_ssl <<<"$(curl_probe "no-cert" --cacert "$CA" "https://${HOST}/mtls-healthz")"
if [[ "$no_code" == "401" || "$no_code" == "403" ]]; then
  no_cert_ok=1
fi

IFS='|' read -r wrong_code wrong_ssl <<<"$(curl_probe "wrong-cert" --cacert "$CA" --cert "$WRONG_CERT" --key "$WRONG_KEY" \
  "https://${HOST}/mtls-healthz")"
if [[ "$wrong_code" == "401" || "$wrong_code" == "403" || "$wrong_code" == "000" || "$wrong_code" == "tls_fail" ]]; then
  wrong_cert_ok=1
fi

IFS='|' read -r valid_code valid_ssl <<<"$(curl_probe "valid-cert" --cacert "$CA" \
  --cert "$CLIENT_CERT" --key "$CLIENT_KEY" "https://${HOST}/mtls-healthz")"
[[ "$valid_code" == "200" && "$valid_ssl" == "0" ]] && valid_cert_ok=1

IFS='|' read -r edge_code edge_ssl <<<"$(curl_probe "edge-health-h2" --cacert "$CA" "https://${HOST}/healthz")"
[[ "$edge_code" == "200" && "$edge_ssl" == "0" ]] && edge_ok=1

h3_health_ok=0
if curl --version 2>/dev/null | grep -qi http3; then
  h3_code="$(curl -sS --http3-only "${CURL_RESOLVE[@]}" --cacert "$CA" \
    -o /dev/null -w "%{http_code}" "https://${HOST}/healthz" 2>/dev/null || echo 000)"
  h3_ssl="$(curl -sS --http3-only "${CURL_RESOLVE[@]}" --cacert "$CA" \
    -o /dev/null -w "%{ssl_verify_result}" "https://${HOST}/healthz" 2>/dev/null || echo "")"
  [[ "$h3_code" == "200" && "$h3_ssl" == "0" ]] && h3_health_ok=1
  printf '%s\t%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "h3-health-no-mtls" "$h3_code" "$h3_ssl" >>"$TSV"
fi

pod="$(kubectl -n "$NS" get pods -l app=caddy-h3 --field-selector=status.phase=Running \
  --sort-by=.metadata.creationTimestamp \
  -o jsonpath='{.items[-1:].metadata.name}' 2>/dev/null | awk '{print $1}' || true)"
if [[ -n "$pod" ]]; then
  curl -sS --http2 "${CURL_RESOLVE[@]}" --cacert "$CA" --cert "$CLIENT_CERT" --key "$CLIENT_KEY" \
    -o /dev/null "https://${HOST}/mtls-healthz" 2>/dev/null || true
  sleep 1
  kubectl -n "$NS" logs "$pod" --tail=80 2>/dev/null | grep -E 'mtls-healthz|healthz' >"$LOG_EXCERPT" || true
  [[ -s "$LOG_EXCERPT" ]] && log_ok=1
fi

overall=FAIL
if [[ $no_cert_ok -eq 1 && $wrong_cert_ok -eq 1 && $valid_cert_ok -eq 1 && $edge_ok -eq 1 ]]; then
  overall=PASS
fi

{
  echo "# REAL mTLS smoke"
  echo ""
  echo "Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Host: \`https://${HOST}\`"
  echo "LB: \`${LB_IP}\` (--resolve)"
  echo "CA: \`$CA\`"
  echo "Client cert: \`$CLIENT_CERT\`"
  echo ""
  echo "## Results"
  echo ""
  echo "| Case | HTTP | ssl_verify | Pass |"
  echo "|------|------|------------|------|"
  echo "| No client cert | $no_code | $no_ssl | $([[ $no_cert_ok -eq 1 ]] && echo yes || echo no) |"
  echo "| Wrong client cert | $wrong_code | $wrong_ssl | $([[ $wrong_cert_ok -eq 1 ]] && echo yes || echo no) |"
  echo "| Valid RP client cert (mtls-test) | $valid_code | $valid_ssl | $([[ $valid_cert_ok -eq 1 ]] && echo yes || echo no) |"
  echo "| /healthz without mTLS (H2) | $edge_code | $edge_ssl | $([[ $edge_ok -eq 1 ]] && echo yes || echo no) |"
  echo "| /healthz without mTLS (H3) | ${h3_code:-skip} | ${h3_ssl:-skip} | $([[ $h3_health_ok -eq 1 ]] && echo yes || echo skip) |"
  echo "| Caddy log excerpt | — | — | $([[ $log_ok -eq 1 ]] && echo yes || echo warn) |"
  echo ""
  if [[ "$overall" == PASS ]]; then
    echo "**REAL mTLS smoke PASS** — no-cert denied, wrong-cert denied, valid-cert 200 with ssl_verify=0."
  else
    echo "**REAL mTLS smoke FAIL** — see table above."
  fi
} >"$REPORT"

if [[ "$overall" != PASS ]]; then
  echo "mTLS real smoke FAILED — $REPORT" >&2
  exit 1
fi
echo "mTLS real smoke PASS — $REPORT"
exit 0
