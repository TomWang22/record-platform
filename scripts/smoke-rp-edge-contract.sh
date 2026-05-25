#!/usr/bin/env bash
# Contract-driven edge smoke: every endpoint × h2 + h3 (strict TLS, MetalLB --resolve).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=scripts/lib/rp-http3-edge-lib.sh
source "$SCRIPT_DIR/lib/rp-http3-edge-lib.sh"
# shellcheck source=scripts/lib/rp-edge-curl-probe.sh
source "$SCRIPT_DIR/lib/rp-edge-curl-probe.sh"

CONTRACT="${RP_EDGE_CONTRACT:-$REPO_ROOT/infra/contracts/rp-edge-endpoint-contract.json}"
[[ -r "$CONTRACT" ]] || { echo "❌ contract not readable: $CONTRACT" >&2; exit 1; }
REPORT_DIR="${RP_EDGE_CONTRACT_REPORT_DIR:-$REPO_ROOT/bench_logs/edge-contract}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$REPORT_DIR"

TSV="$REPORT_DIR/results.tsv"
MD="$REPORT_DIR/report.md"
FAILURES_MD="$REPORT_DIR/failures.md"

CURL_BIN="$(rp_http3_curl_bin)"
CA="$(rp_http3_ca_cert || true)"
LB="$(rp_http3_lb_ip || true)"
HOST="${RP_HTTP3_EDGE_HOST:-record-platform.test}"
PORT="443"
FAIL=0

RP_EDGE_CURL_BIN="$CURL_BIN"

bad() { echo "❌ $*" >&2; FAIL=1; }
ok() { echo "✅ $*"; }

[[ -f "$CONTRACT" ]] || { bad "missing $CONTRACT"; exit 1; }
[[ -n "$CA" ]] || { bad "missing certs/dev-chain.pem"; exit 1; }
[[ -n "$LB" ]] || { bad "no caddy-h3 LoadBalancer EXTERNAL-IP"; exit 1; }

: >"$TSV"
: >"$FAILURES_MD"
printf 'timestamp\tsection\tprotocol\thost\tpath\tattempt\tverdict\texit\thttp_code\thttp_version\tssl_verify\tremote_ip\ttime_total\tlb_ip\n' >>"$TSV"

{
  echo "# Edge endpoint contract smoke"
  echo ""
  echo "Generated: $TS (UTC)"
  echo "Contract: \`$CONTRACT\`"
  echo ""
  echo "| section | protocol | path | attempts | pass | fail |"
  echo "|---------|----------|------|----------|------|------|"
} >"$MD"

{
  echo "# Edge contract smoke — failures"
  echo ""
  echo "Generated: $TS (UTC)"
  echo ""
} >"$FAILURES_MD"

echo "smoke-rp-edge-contract"
echo "  LB IP: $LB (via --resolve)"
echo "  CA: $CA"
echo "  host: $HOST"

mapfile -t PLAN < <(python3 - "$CONTRACT" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    c = json.load(f)
host = c.get("host", "record-platform.test")
for section in ("critical", "api", "observability"):
    for ep in c.get(section, []):
        path = ep["path"]
        codes = " ".join(str(x) for x in ep.get("codes", [200]))
        verdicts = ""
        critical = "1" if ep.get("critical", section != "observability") else "0"
        for proto in c.get("protocols", ["h2", "h3"]):
            attempts = ep.get("attempts", {}).get(proto, 1)
            print(f"{section}\t{proto}\t{host}\t{path}\t{attempts}\t{critical}\t{codes}\t{verdicts}")
for ep in c.get("negative", []):
    path = ep["path"]
    codes = " ".join(str(x) for x in ep.get("codes", [404]))
    verdicts = " ".join(str(x) for x in ep.get("verdicts", []))
    neg_host = ep.get("host", host)
    critical = "1" if ep.get("critical", False) else "0"
    for proto in ep.get("protocols", c.get("protocols", ["h2", "h3"])):
        print(f"negative\t{proto}\t{neg_host}\t{path}\t1\t{critical}\t{codes}\t{verdicts}")
PY
)

for line in "${PLAN[@]}"; do
  [[ -z "$line" ]] && continue
  IFS=$'\t' read -r section protocol probe_host path attempts critical codes_str verdicts_str <<<"$line"
  read -ra codes_arr <<<"$codes_str"
  read -ra verdicts_arr <<<"$verdicts_str"

  pass=0
  fail=0
  verdict_summary=""
  echo ""
  echo "▶ [$section] $path ($attempts x $protocol, host=$probe_host)"
  for i in $(seq 1 "$attempts"); do
    probe_ok=0
    if rp_edge_probe_once "$protocol" "$path" "$i" "$probe_host" "$LB" "$CA" "$PORT" "${codes_arr[@]}"; then
      probe_ok=1
    elif [[ ${#verdicts_arr[@]} -gt 0 ]]; then
      for v in "${verdicts_arr[@]}"; do
        [[ "$RP_PROBE_VERDICT" == "$v" ]] && probe_ok=1 && break
      done
    fi
    if [[ "$probe_ok" -eq 1 ]]; then
      pass=$((pass + 1))
    else
      fail=$((fail + 1))
      verdict_summary="${verdict_summary}${RP_PROBE_VERDICT} "
      if [[ "$fail" -le 2 ]]; then
        printf '  fail attempt=%s curl_exit=%s http_code=%s http_version=%s ssl_verify=%s verdict=%s\n' \
          "$RP_PROBE_ATTEMPT" "$RP_PROBE_CURL_EXIT" "$RP_PROBE_HTTP_CODE" "$RP_PROBE_HTTP_VERSION" \
          "$RP_PROBE_SSL_VERIFY" "$RP_PROBE_VERDICT" >&2
      fi
      if [[ "$RP_PROBE_VERDICT" != PASS ]]; then
        {
          echo "### \`$path\` [$section] $protocol attempt $i — ${RP_PROBE_VERDICT}"
          echo "- host: $probe_host"
          echo "- http_code: ${RP_PROBE_HTTP_CODE}"
          echo "- http_version: ${RP_PROBE_HTTP_VERSION}"
          echo "- ssl_verify: ${RP_PROBE_SSL_VERIFY}"
          echo ""
        } >>"$FAILURES_MD"
      fi
    fi
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
      "$TS" "$section" "$protocol" "$probe_host" "$path" "$i" "$RP_PROBE_VERDICT" \
      "$RP_PROBE_CURL_EXIT" "$RP_PROBE_HTTP_CODE" "$RP_PROBE_HTTP_VERSION" "$RP_PROBE_SSL_VERIFY" \
      "$RP_PROBE_REMOTE_IP" "$RP_PROBE_TIME_TOTAL" "$LB" >>"$TSV"
  done
  echo "  → $pass/$attempts passed"
  echo "| $section | $protocol | \`$path\` | $attempts | $pass | $fail |" >>"$MD"

  if [[ "$critical" == "1" && "$pass" -lt "$attempts" ]]; then
    bad "$section $path $protocol failed ($verdict_summary)"
  elif [[ "$fail" -gt 0 ]]; then
    echo "⚠️  $section $path $protocol: $fail/$attempts failed ($verdict_summary)" >&2
  else
    ok "$section $path $protocol"
  fi
done

echo ""
echo "Report: $MD"
echo "Failures: $FAILURES_MD"
echo "TSV: $TSV"

[[ "$FAIL" -eq 0 ]] || exit 1
echo "✅ smoke-rp-edge-contract passed"
