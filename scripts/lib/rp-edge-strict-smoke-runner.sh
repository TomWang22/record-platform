#!/usr/bin/env bash
# Shared runner for strict h2/h3 edge smoke (MetalLB --resolve, dev-chain.pem, no -k).
set -euo pipefail

rp_edge_strict_smoke_run() {
  local protocol="$1"
  local report_name="$2"
  local curl_label="$3"
  local stress_attempts="${4:-10}"
  local stress_min_pass="${5:-10}"

  local _lib_dir _script_dir repo_root
  _lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  _script_dir="$(cd "$_lib_dir/.." && pwd)"
  repo_root="$(cd "$_script_dir/.." && pwd)"

  # shellcheck source=scripts/lib/rp-http3-edge-lib.sh
  source "$_lib_dir/rp-http3-edge-lib.sh"
  # shellcheck source=scripts/lib/rp-edge-curl-probe.sh
  source "$_lib_dir/rp-edge-curl-probe.sh"

  local contract="${RP_EDGE_CONTRACT:-$repo_root/infra/contracts/rp-edge-endpoint-contract.json}"
  local report_dir="${RP_EDGE_STRICT_REPORT_DIR:-$repo_root/bench_logs/edge-${protocol}-strict}"
  local ts global_fail=0
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$report_dir"

  local tsv="$report_dir/results.tsv"
  local md="$report_dir/report.md"
  local failures_md="$report_dir/failures.md"

  local curl_bin ca lb host port=443
  curl_bin="$(rp_http3_curl_bin)"
  ca="$(rp_http3_ca_cert || true)"
  lb="$(rp_http3_lb_ip || true)"
  host="${RP_HTTP3_EDGE_HOST:-record-platform.test}"

  RP_EDGE_CURL_BIN="$curl_bin"

  bad() { echo "❌ $*" >&2; global_fail=1; }
  ok() { echo "✅ $*"; }

  [[ -n "$ca" ]] || { bad "missing certs/dev-chain.pem"; return 1; }
  [[ -n "$lb" ]] || { bad "no caddy-h3 LoadBalancer EXTERNAL-IP"; return 1; }
  [[ -f "$contract" ]] || { bad "missing contract: $contract"; return 1; }

  if [[ "$protocol" == "h3" ]] && ! "$curl_bin" --version 2>/dev/null | grep -qiE 'http3|ngtcp2|nghttp3'; then
    bad "curl lacks HTTP/3: $curl_bin"
    return 1
  fi

  local caddy_pods svclb session_affinity etp alloc_np nodeports
  caddy_pods="$(kubectl -n "$RP_HTTP3_EDGE_NS" get pods -l app=caddy-h3 \
    --field-selector=status.phase=Running --no-headers 2>/dev/null \
    | awk '$2 ~ /^[0-9]+\/[0-9]+$/ && $2 !~ /0\// { c++ } END { print c+0 }')"
  svclb="$(rp_http3_svclb_active && echo yes || echo no)"
  session_affinity="$(rp_http3_session_affinity 2>/dev/null || echo None)"
  etp="$(rp_http3_external_traffic_policy 2>/dev/null || echo ?)"
  alloc_np="$(rp_http3_allocate_lb_nodeports 2>/dev/null || echo ?)"
  nodeports="$(rp_http3_print_nodeports 2>/dev/null | tr '\n' ' ' | tr -s ' ' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"

  : >"$tsv"
  : >"$failures_md"
  printf 'timestamp\tprotocol\tpath\tattempt\tverdict\texit\thttp_code\thttp_version\tssl_verify\tremote_ip\ttime_total\terrormsg\tcurl_stderr\tcaddy_pods\tlb_ip\tsvclb\n' >>"$tsv"

  {
    echo "# Edge HTTP/${protocol#h} strict smoke"
    echo ""
    echo "Generated: $ts (UTC)"
    echo ""
    echo "## Canonical strict curl"
    echo '```bash'
    echo "LB_IP=\"$lb\""
    echo "curl ${curl_label} -sS -o /tmp/rp-edge-body.out \\"
    echo "  --connect-timeout 10 --max-time 45 \\"
    echo "  --cacert certs/dev-chain.pem \\"
    echo "  --resolve \"${host}:443:\${LB_IP}\" \\"
    echo "  \"https://${host}/api/readyz\""
    echo '```'
    echo ""
    echo "| caddy pods | $caddy_pods |"
    echo "| LB IP | $lb |"
    echo "| svclb | $svclb |"
    echo ""
    echo "| path | attempts | pass | fail | critical |"
    echo "|------|----------|------|------|----------|"
  } >"$md"

  {
    echo "# Edge ${protocol} strict smoke — failures"
    echo ""
    echo "Generated: $ts (UTC)"
    echo ""
  } >"$failures_md"

  echo "smoke-rp-edge-${protocol}-strict"
  echo "  LB IP: $lb (via --resolve)"
  echo "  CA: $ca"
  echo "  stress min pass: ${stress_min_pass}/${stress_attempts} for / and /api/readyz"
  echo "  caddy pods: $caddy_pods | svclb: $svclb"

  if [[ "$protocol" == "h3" ]]; then
    "$curl_bin" -sS --cacert "$ca" --resolve "${host}:${port}:${lb}" --http3-only \
      --connect-timeout 10 --max-time 20 -o /dev/null \
      "https://${host}/_caddy/healthz" >/dev/null 2>&1 || true
    sleep "${RP_HTTP3_STRICT_WARMUP_SLEEP:-1}"
  fi

  mapfile -t rows < <(python3 - "$contract" "$protocol" "$stress_attempts" <<'PY'
import json, sys
contract_path, protocol, stress = sys.argv[1], sys.argv[2], int(sys.argv[3])
with open(contract_path, encoding="utf-8") as f:
    c = json.load(f)
rows = []
for section in ("critical", "api", "observability"):
    for ep in c.get(section, []):
        path = ep["path"]
        codes_str = " ".join(str(x) for x in ep.get("codes", [200]))
        attempts = ep.get("attempts", {}).get(protocol, 1)
        if path in ("/", "/api/readyz"):
            attempts = stress
        critical = ep.get("critical", section != "observability")
        rows.append(f"{path}\t{attempts}\t{'1' if critical else '0'}\t{codes_str}")
print("\n".join(rows))
PY
)

  local entry path attempts critical codes_arr path_pass path_fail verdict_summary required_pass i
  for entry in "${rows[@]}"; do
    [[ -z "$entry" ]] && continue
    IFS=$'\t' read -r path attempts critical codes_rest <<<"$entry"
    read -ra codes_arr <<<"$codes_rest"

    path_pass=0
    path_fail=0
    verdict_summary=""
    echo ""
    echo "▶ $path ($attempts x ${curl_label})"
    for i in $(seq 1 "$attempts"); do
      [[ "$critical" == "1" && "$i" -gt 1 ]] && sleep "${RP_EDGE_INTER_ATTEMPT_SLEEP:-1.5}"
      if rp_edge_probe_once "$protocol" "$path" "$i" "$host" "$lb" "$ca" "$port" "${codes_arr[@]}"; then
        path_pass=$((path_pass + 1))
      else
        path_fail=$((path_fail + 1))
        verdict_summary="${verdict_summary}${RP_PROBE_VERDICT} "
        if [[ "$path_fail" -le 3 ]]; then
          printf '  fail attempt=%s curl_exit=%s http_code=%s http_version=%s ssl_verify_result=%s remote_ip=%s time_total=%s verdict=%s\n' \
            "$RP_PROBE_ATTEMPT" "$RP_PROBE_CURL_EXIT" "$RP_PROBE_HTTP_CODE" "$RP_PROBE_HTTP_VERSION" \
            "$RP_PROBE_SSL_VERIFY" "$RP_PROBE_REMOTE_IP" "$RP_PROBE_TIME_TOTAL" "$RP_PROBE_VERDICT" >&2
          [[ -n "${RP_PROBE_CURL_STDERR:-}" ]] && printf '       curl_stderr: %s\n' "$RP_PROBE_CURL_STDERR" >&2
        fi
      fi
      printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
        "$ts" "$protocol" "$path" "$i" "$RP_PROBE_VERDICT" "$RP_PROBE_CURL_EXIT" "$RP_PROBE_HTTP_CODE" \
        "$RP_PROBE_HTTP_VERSION" "$RP_PROBE_SSL_VERIFY" "$RP_PROBE_REMOTE_IP" "$RP_PROBE_TIME_TOTAL" \
        "${RP_PROBE_ERRMSG:-}" "${RP_PROBE_CURL_STDERR:-}" "$caddy_pods" "$lb" "$svclb" >>"$tsv"
    done
    echo "  → $path_pass/$attempts passed"
    crit_label="$([[ "$critical" == "1" ]] && echo yes || echo no)"
    echo "| \`$path\` | $attempts | $path_pass | $path_fail | $crit_label |" >>"$md"

    required_pass="$attempts"
    if [[ "$critical" == "1" && ( "$path" == "/" || "$path" == "/api/readyz" ) ]] && [[ "$attempts" -ge "$stress_attempts" ]]; then
      required_pass="$stress_min_pass"
    fi
    if [[ "$critical" == "1" && "$path_pass" -lt "$required_pass" ]]; then
      bad "$path failed $path_fail/$attempts (critical; need $required_pass/$attempts) — $verdict_summary"
    elif [[ "$path_fail" -gt 0 ]]; then
      echo "⚠️  $path non-critical: $path_fail/$attempts failed ($verdict_summary)" >&2
    else
      ok "$path $path_pass/$attempts"
    fi
  done

  echo ""
  echo "Report: $md"
  echo "Failures: $failures_md"
  echo "TSV: $tsv"

  [[ "$global_fail" -eq 0 ]] || return 1
  echo "✅ smoke-rp-edge-${protocol}-strict passed"
}
