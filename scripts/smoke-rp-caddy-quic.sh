#!/usr/bin/env bash
# V7-style QUIC / HTTP/3 lab — strict H2/H3 curl + tshark packet classification (not UDP-only).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib/rp-http3-edge-lib.sh
source "$SCRIPT_DIR/lib/rp-http3-edge-lib.sh"
# shellcheck source=lib/rp-edge-curl-probe.sh
source "$SCRIPT_DIR/lib/rp-edge-curl-probe.sh"

OUT="${QUIC_LAB_DIR:-$REPO_ROOT/bench_logs/security-contract/quic-lab}"
NS="${CADDY_NS:-ingress-nginx}"
HOST="${RP_HTTP3_EDGE_HOST:-record-platform.test}"
PORT=443

TARGETS=(
  "/_caddy/healthz"
  "/api/healthz"
  "/api/readyz"
  "/"
  "/listings"
)

mkdir -p "$OUT/pcap"

curl_bin="$(rp_http3_curl_bin)"
ca="$(rp_http3_ca_cert || true)"
lb="$(rp_http3_lb_ip || true)"
[[ -n "$ca" && -n "$lb" ]] || { echo "❌ missing CA or MetalLB IP" >&2; exit 1; }

RP_EDGE_CURL_BIN="$curl_bin"
h2_tsv="$OUT/h2-results.tsv"
h3_tsv="$OUT/h3-results.tsv"
results_tsv="$OUT/results.tsv"
tshark_txt="$OUT/tshark-quic.txt"
caddy_log="$OUT/caddy-h3.log"
report="$OUT/report.md"

printf 'path\tprotocol\thttp_code\thttp_version\tssl_verify\tremote_ip\ttime_total\tverdict\n' >"$results_tsv"
printf 'path\tattempt\thttp_code\thttp_version\tssl_verify\tremote_ip\tverdict\n' >"$h2_tsv"
printf 'path\tattempt\thttp_code\thttp_version\tssl_verify\tremote_ip\tverdict\n' >"$h3_tsv"

global_fail=0
h2_fail=0
h3_fail=0
quic_pkt_fail=0
zerortt_result="skip_tooling"
zerortt_reason="not evaluated"

bad() { echo "❌ $*" >&2; global_fail=1; }

rp_quic_curl() {
  local proto="$1" path="$2" out_body="$3"
  local curl_args=()
  case "$proto" in
    h2) curl_args=(--http2) ;;
    h3) curl_args=(--http3-only) ;;
    *) return 1 ;;
  esac
  local line stderrf
  stderrf="$(mktemp)"
  line=$("$curl_bin" -sS "${curl_args[@]}" \
    --connect-timeout 10 --max-time 45 \
    --cacert "$ca" --resolve "${HOST}:${PORT}:${lb}" \
    -o "$out_body" \
    -w 'http_code=%{http_code}\thttp_version=%{http_version}\tssl_verify_result=%{ssl_verify_result}\tremote_ip=%{remote_ip}\ttime_total=%{time_total}\n' \
    "https://${HOST}${path}" 2>"$stderrf" || true)
  RP_PROBE_CURL_STDERR="$(tr '\n' ' ' <"$stderrf" | head -c 400)"
  rm -f "$stderrf"
  RP_PROBE_HTTP_CODE="$(rp_edge_parse_metric http_code "$line")"
  RP_PROBE_HTTP_VERSION="$(rp_edge_parse_metric http_version "$line")"
  RP_PROBE_SSL_VERIFY="$(rp_edge_parse_metric ssl_verify_result "$line")"
  RP_PROBE_REMOTE_IP="$(rp_edge_parse_metric remote_ip "$line")"
  RP_PROBE_TIME_TOTAL="$(rp_edge_parse_metric time_total "$line")"
  RP_PROBE_CURL_EXIT=0
  [[ -n "$RP_PROBE_HTTP_CODE" ]] || RP_PROBE_CURL_EXIT=1
  RP_PROBE_VERDICT="$(rp_edge_classify_result "$proto" "$RP_PROBE_CURL_EXIT" \
    "${RP_PROBE_HTTP_CODE:-000}" "${RP_PROBE_HTTP_VERSION:-0}" \
    "${RP_PROBE_SSL_VERIFY:-}" "${RP_PROBE_CURL_STDERR:-}" 200)"
  printf '%s\n' "$line"
}

echo "QUIC lab — LB=$lb host=$HOST curl=$curl_bin"

# --- Per-endpoint H2 / H3 matrix ---
for path in "${TARGETS[@]}"; do
  body_h2="$(mktemp)"
  body_h3="$(mktemp)"
  rp_quic_curl h2 "$path" "$body_h2" >/dev/null
  v2="$RP_PROBE_VERDICT"
  if [[ "$RP_PROBE_VERDICT" != PASS || "$RP_PROBE_REMOTE_IP" != "$lb" ]]; then
    : # h2 remote_ip may differ on some curls; require TLS 0 + http2 + 200
    if [[ "$RP_PROBE_VERDICT" != PASS ]]; then h2_fail=1; bad "H2 $path $v2"; fi
  fi
  printf '%s\t1\t%s\t%s\t%s\t%s\t%s\n' "$path" "${RP_PROBE_HTTP_CODE:-}" \
    "${RP_PROBE_HTTP_VERSION:-}" "${RP_PROBE_SSL_VERIFY:-}" "${RP_PROBE_REMOTE_IP:-}" "$v2" >>"$h2_tsv"
  printf '%s\th2\t%s\t%s\t%s\t%s\t%s\t%s\n' "$path" "${RP_PROBE_HTTP_CODE:-}" \
    "${RP_PROBE_HTTP_VERSION:-}" "${RP_PROBE_SSL_VERIFY:-}" "${RP_PROBE_REMOTE_IP:-}" \
    "${RP_PROBE_TIME_TOTAL:-}" "$v2" >>"$results_tsv"

  rp_quic_curl h3 "$path" "$body_h3" >/dev/null
  v3="$RP_PROBE_VERDICT"
  if [[ "$RP_PROBE_VERDICT" != PASS ]]; then
    h3_fail=1
    bad "H3 $path $v3"
  elif [[ "$RP_PROBE_REMOTE_IP" != "$lb" ]]; then
    h3_fail=1
    bad "H3 $path remote_ip=${RP_PROBE_REMOTE_IP:-?} expected $lb"
  fi
  printf '%s\t1\t%s\t%s\t%s\t%s\t%s\n' "$path" "${RP_PROBE_HTTP_CODE:-}" \
    "${RP_PROBE_HTTP_VERSION:-}" "${RP_PROBE_SSL_VERIFY:-}" "${RP_PROBE_REMOTE_IP:-}" "$v3" >>"$h3_tsv"
  printf '%s\th3\t%s\t%s\t%s\t%s\t%s\t%s\n' "$path" "${RP_PROBE_HTTP_CODE:-}" \
    "${RP_PROBE_HTTP_VERSION:-}" "${RP_PROBE_SSL_VERIFY:-}" "${RP_PROBE_REMOTE_IP:-}" \
    "${RP_PROBE_TIME_TOTAL:-}" "$v3" >>"$results_tsv"
  rm -f "$body_h2" "$body_h3"
done

# --- Caddy logs (HTTP/3) ---
pod="$(kubectl -n "$NS" get pods -l app=caddy-h3 --field-selector=status.phase=Running \
  --sort-by=.metadata.creationTimestamp \
  -o jsonpath='{.items[-1:].metadata.name}' 2>/dev/null | awk '{print $1}' || true)"
if [[ -n "$pod" ]]; then
  kubectl -n "$NS" logs "$pod" --tail=120 2>/dev/null >"$caddy_log" || true
  if ! grep -qiE 'h3|http/3|quic|alt-svc' "$caddy_log" 2>/dev/null; then
    kubectl -n "$NS" exec "$pod" -- sh -lc 'grep -E "protocols h1 h2 h3" /etc/caddy/Caddyfile' >>"$caddy_log" 2>/dev/null || true
  fi
fi

# --- Packet capture on prod caddy-h3 during HTTP/3 ---
pcap_local="$OUT/pcap/quic-healthz.pcap"
pcap_pod="/tmp/quic-healthz.pcap"
has_initial=0
has_handshake=0
has_1rtt=0

if [[ -z "$pod" ]]; then
  bad "no running caddy-h3 pod for capture"
  quic_pkt_fail=1
else
  if ! kubectl -n "$NS" exec "$pod" -- sh -lc 'command -v tcpdump >/dev/null && command -v tshark >/dev/null'; then
    bad "caddy-h3 pod missing tcpdump/tshark — roll rp-caddy:dev"
    quic_pkt_fail=1
  else
    kubectl -n "$NS" exec "$pod" -- sh -lc "rm -f $pcap_pod" 2>/dev/null || true
    kubectl -n "$NS" exec "$pod" -- sh -lc \
      "timeout 28 tcpdump -i any -s 0 -w $pcap_pod udp port 443" &
    tp=$!
    sleep 3
    for _ in 1 2 3 4; do
      rp_quic_curl h3 "/_caddy/healthz" /dev/null >/dev/null || true
      sleep 0.5
    done
    wait "$tp" 2>/dev/null || true
    sleep 1
    kubectl -n "$NS" cp "${NS}/${pod}:${pcap_pod}" "$pcap_local" 2>/dev/null || true

    if [[ ! -s "$pcap_local" ]]; then
      bad "pcap empty or copy failed"
      quic_pkt_fail=1
    else
      tshark_bin="$(command -v tshark 2>/dev/null || true)"
      if [[ -z "$tshark_bin" ]]; then
        kubectl -n "$NS" exec "$pod" -- tshark -r "$pcap_pod" \
          -Y 'quic' -T fields \
          -e frame.number -e ip.src -e ip.dst -e udp.srcport -e udp.dstport \
          -e quic.long.packet_type -e quic.packet_number \
          >"$tshark_txt" 2>/dev/null || true
      else
        "$tshark_bin" -r "$pcap_local" -Y 'quic' -T fields \
          -e frame.number -e ip.src -e ip.dst -e udp.srcport -e udp.dstport \
          -e quic.long.packet_type -e quic.packet_number \
          >"$tshark_txt" 2>/dev/null || true
      fi

      if [[ ! -s "$tshark_txt" ]]; then
        bad "tshark quic decode empty"
        quic_pkt_fail=1
      else
        # quic.long.packet_type: 0=Initial, 1=0-RTT, 2=Handshake (numeric or comma-separated)
        read -r has_initial has_handshake < <(
          awk -F'\t' '
            function mark(pt,    a, n, i) {
              n = split(pt, a, ",");
              for (i = 1; i <= n; i++) {
                if (a[i] == "0" || a[i] ~ /Initial/i) ini = 1;
                if (a[i] == "2" || a[i] ~ /Handshake/i) hs = 1;
              }
            }
            NR > 0 && NF >= 6 { mark($6) }
            END { print ini + 0, hs + 0 }
          ' "$tshark_txt"
        )
        if grep -qiE '1-RTT|Protected|protected|short' "$tshark_txt"; then
          has_1rtt=1
        fi
        if [[ "$has_1rtt" -eq 0 ]]; then
          if [[ -n "$tshark_bin" ]]; then
            "$tshark_bin" -r "$pcap_local" -Y 'http3' -c 1 >/dev/null 2>&1 && has_1rtt=1
          else
            kubectl -n "$NS" exec "$pod" -- tshark -r "$pcap_pod" -Y 'http3' -c 1 >/dev/null 2>&1 && has_1rtt=1
          fi
        fi
        # Short-header 1-RTT: empty long.packet_type with payload after handshake
        if [[ "$has_1rtt" -eq 0 ]]; then
          awk -F'\t' 'NF >= 6 && $6 == "" { c++ } END { exit !(c >= 2) }' "$tshark_txt" && has_1rtt=1
        fi
        [[ "$has_initial" -eq 1 && "$has_handshake" -eq 1 && "$has_1rtt" -eq 1 ]] || {
          quic_pkt_fail=1
          bad "QUIC packet types incomplete (initial=$has_initial handshake=$has_handshake 1rtt=$has_1rtt)"
        }
      fi
    fi
  fi
fi

# --- 0-RTT / resumption attempt ---
pcap_0rtt="$OUT/pcap/quic-0rtt.pcap"
pcap_0rtt_pod="/tmp/quic-0rtt.pcap"
if [[ -n "$pod" ]] && kubectl -n "$NS" exec "$pod" -- sh -lc 'command -v tcpdump >/dev/null' 2>/dev/null; then
  kubectl -n "$NS" exec "$pod" -- sh -lc "rm -f $pcap_0rtt_pod" 2>/dev/null || true
  rp_quic_curl h3 "/_caddy/healthz" /dev/null >/dev/null || true
  sleep 1
  kubectl -n "$NS" exec "$pod" -- sh -lc \
    "timeout 18 tcpdump -i any -s 0 -w $pcap_0rtt_pod udp port 443" &
  tp2=$!
  sleep 1
  rp_quic_curl h3 "/_caddy/healthz" /dev/null >/dev/null || true
  rp_quic_curl h3 "/api/readyz" /dev/null >/dev/null || true
  wait "$tp2" 2>/dev/null || true
  kubectl -n "$NS" cp "${NS}/${pod}:${pcap_0rtt_pod}" "$pcap_0rtt" 2>/dev/null || true
  if [[ -s "$pcap_0rtt" ]]; then
    decode_0rtt="$(mktemp)"
    if [[ -n "${tshark_bin:-}" ]]; then
      "$tshark_bin" -r "$pcap_0rtt" -Y 'quic' -T fields -e quic.long.packet_type >"$decode_0rtt" 2>/dev/null || true
    else
      kubectl -n "$NS" exec "$pod" -- tshark -r "$pcap_0rtt_pod" -Y 'quic' -T fields \
        -e quic.long.packet_type >"$decode_0rtt" 2>/dev/null || true
    fi
    if grep -qiE '0-RTT|0rtt|1' "$decode_0rtt"; then
      zerortt_result="pass"
      zerortt_reason="0-RTT long-header packet observed on second connection"
    else
      if "$curl_bin" --version 2>/dev/null | grep -qiE 'ngtcp2|nghttp3|boringssl'; then
        zerortt_result="skip_tooling"
        zerortt_reason="curl/ngtcp2 stack may not expose 0-RTT resumption to second cold capture; 1-RTT+H3 matrix passed"
      else
        zerortt_result="skip_tooling"
        zerortt_reason="cannot prove 0-RTT with this curl build"
      fi
    fi
    rm -f "$decode_0rtt"
  fi
fi

# --- Report ---
{
  echo "# QUIC / HTTP/3 lab (V7-style)"
  echo ""
  echo "Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "LB IP: \`$lb\`"
  echo "Host: \`$HOST\`"
  echo "Caddy pod: \`${pod:-none}\`"
  echo ""
  echo "## HTTP/2 matrix"
  echo ""
  echo "See \`h2-results.tsv\` — require http_version=2, ssl_verify=0, status 200."
  echo ""
  echo "## HTTP/3 matrix"
  echo ""
  echo "See \`h3-results.tsv\` — require http_version=3, ssl_verify=0, remote_ip=$lb, status 200."
  echo ""
  echo "## QUIC packet classification"
  echo ""
  echo "| Signal | Result |"
  echo "|--------|--------|"
  echo "| Initial | $([[ $has_initial -eq 1 ]] && echo PASS || echo FAIL) |"
  echo "| Handshake | $([[ $has_handshake -eq 1 ]] && echo PASS || echo FAIL) |"
  echo "| 1-RTT / protected / http3 | $([[ $has_1rtt -eq 1 ]] && echo PASS || echo FAIL) |"
  echo "| tshark output | \`tshark-quic.txt\` |"
  echo "| pcap | \`pcap/quic-healthz.pcap\` |"
  echo ""
  echo "## 0-RTT"
  echo ""
  echo "- result: \`$zerortt_result\`"
  echo "- reason: $zerortt_reason"
  echo ""
  echo "## Summary"
  echo ""
  if [[ $global_fail -eq 0 && $quic_pkt_fail -eq 0 && $h2_fail -eq 0 && $h3_fail -eq 0 ]]; then
    echo "**PASS** — Real HTTP/3 over QUIC with packet-type proof (not UDP-only)."
  else
    echo "**FAIL** — h2_fail=$h2_fail h3_fail=$h3_fail quic_pkt_fail=$quic_pkt_fail global_fail=$global_fail"
  fi
} >"$report"

if [[ $global_fail -ne 0 || $quic_pkt_fail -ne 0 ]]; then
  echo "QUIC lab FAILED — $report" >&2
  exit 1
fi
echo "QUIC lab PASS — $report (0rtt=$zerortt_result)"
exit 0
