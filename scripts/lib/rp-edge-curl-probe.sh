#!/usr/bin/env bash
# Shared strict-TLS edge curl probe: parse metrics, classify, probe once.
# shellcheck shell=bash

RP_PROBE_ATTEMPT=""
RP_PROBE_PROTOCOL=""
RP_PROBE_PATH=""
RP_PROBE_HOST=""
RP_PROBE_CURL_EXIT=""
RP_PROBE_HTTP_CODE=""
RP_PROBE_HTTP_VERSION=""
RP_PROBE_SSL_VERIFY=""
RP_PROBE_REMOTE_IP=""
RP_PROBE_TIME_CONNECT=""
RP_PROBE_TIME_APPCONNECT=""
RP_PROBE_TIME_STARTTRANSFER=""
RP_PROBE_TIME_TOTAL=""
RP_PROBE_ERRMSG=""
RP_PROBE_VERDICT=""
RP_PROBE_CURL_STDERR=""

rp_edge_expected_http_version() {
  case "${1:-}" in
    h2) echo 2 ;;
    h3) echo 3 ;;
    *) return 1 ;;
  esac
}

rp_edge_parse_metric() {
  local key="$1" line="$2"
  awk -F'\t' -v k="$key" '{
    for (i = 1; i <= NF; i++) {
      split($i, a, "=");
      if (a[1] == k) { print substr($i, length(k) + 2); exit }
    }
  }' <<<"$line"
}

rp_edge_code_accepted() {
  local code="$1"
  shift
  local c
  for c in "$@"; do
    [[ "$code" == "$c" ]] && return 0
  done
  return 1
}

# Args: protocol curl_exit http_code http_version ssl_verify_result curl_stderr code1 [code2...]
rp_edge_classify_result() {
  local protocol="${1:-h3}" curl_exit="${2:-1}" http_code="${3:-000}" http_ver="${4:-0}"
  local ssl_verify="${5:-}" curl_stderr="${6:-}"
  shift 6
  local accepted=("$@")
  local expected_ver
  expected_ver="$(rp_edge_expected_http_version "$protocol")" || { echo FAIL; return 0; }

  if [[ "$curl_exit" -eq 0 && "$ssl_verify" == "0" && "$http_ver" == "$expected_ver" ]] \
    && rp_edge_code_accepted "$http_code" "${accepted[@]}"; then
    echo PASS
    return 0
  fi
  if [[ "$curl_exit" -eq 28 ]]; then
    echo TIMEOUT
    return 0
  fi
  if [[ "$curl_exit" -eq 60 ]] \
    || [[ "$curl_stderr" == *"SSL certificate problem"* ]] \
    || [[ "$curl_stderr" == *"certificate verify failed"* ]] \
    || [[ "$curl_stderr" == *"Certificate verify failed"* ]]; then
    echo CERT_FAIL
    return 0
  fi
  if [[ "$curl_exit" -eq 0 && "$http_ver" != "$expected_ver" ]]; then
    echo NOT_EXPECTED_PROTOCOL
    return 0
  fi
  if [[ "$http_code" == 421 ]]; then
    echo EDGE_MISROUTE
    return 0
  fi
  if [[ "$http_code" =~ ^5 ]]; then
    echo UPSTREAM_5XX
    return 0
  fi
  if [[ "$http_code" == 504 ]]; then
    echo UPSTREAM_TIMEOUT
    return 0
  fi
  if [[ "$http_code" == 502 ]]; then
    echo UPSTREAM_BAD_GATEWAY
    return 0
  fi
  if [[ "$protocol" == "h3" && ( "$http_code" == "000" || "$curl_exit" -eq 55 || "$curl_exit" -eq 56 || "$curl_exit" -eq 92 ) ]]; then
    echo QUIC_CONN_FAIL
    return 0
  fi
  if [[ "$http_code" =~ ^5 ]]; then
    echo UPSTREAM_5XX
    return 0
  fi
  if [[ "$curl_exit" -eq 0 ]]; then
    echo BAD_STATUS
    return 0
  fi
  echo FAIL
}

# rp_edge_probe_once protocol path attempt host lb_ip ca port accepted_codes...
# Sets RP_PROBE_* globals. Returns 0 only for PASS.
rp_edge_probe_once() {
  local protocol="$1" path="$2" attempt="$3" host="$4" lb_ip="$5" ca="$6" port="${7:-443}"
  shift 7
  local accepted=("$@")

  local curl_bin="${RP_EDGE_CURL_BIN:-curl}"
  local connect_timeout="${RP_EDGE_CONNECT_TIMEOUT:-10}"
  local max_time="${RP_EDGE_MAX_TIME:-45}"
  local tmp err write_line curl_exit http_code http_ver ssl_verify remote_ip
  local time_connect time_appconnect time_starttransfer time_total errormsg curl_stderr verdict
  local proto_flag=()

  case "$protocol" in
    h2) proto_flag=(--http2) ;;
    h3) proto_flag=(--http3-only) ;;
    *) echo "unknown protocol: $protocol" >&2; return 1 ;;
  esac

  tmp="$(mktemp)"
  err="$(mktemp)"

  set +e
  write_line="$("$curl_bin" -sS -o "$tmp" \
    --cacert "$ca" \
    --resolve "${host}:${port}:${lb_ip}" \
    "${proto_flag[@]}" \
    --connect-timeout "$connect_timeout" \
    --max-time "$max_time" \
    -w $'attempt='"${attempt}"$'\tprotocol='"${protocol}"$'\tcurl_exit=%{exitcode}\thttp_code=%{http_code}\thttp_version=%{http_version}\tssl_verify_result=%{ssl_verify_result}\tremote_ip=%{remote_ip}\ttime_connect=%{time_connect}\ttime_appconnect=%{time_appconnect}\ttime_starttransfer=%{time_starttransfer}\ttime_total=%{time_total}\terrormsg=%{errormsg}\n' \
    "https://${host}${path}" 2>"$err")"
  curl_exit=$?
  set -e

  http_code="$(rp_edge_parse_metric http_code "$write_line")"
  http_ver="$(rp_edge_parse_metric http_version "$write_line")"
  ssl_verify="$(rp_edge_parse_metric ssl_verify_result "$write_line")"
  remote_ip="$(rp_edge_parse_metric remote_ip "$write_line")"
  time_connect="$(rp_edge_parse_metric time_connect "$write_line")"
  time_appconnect="$(rp_edge_parse_metric time_appconnect "$write_line")"
  time_starttransfer="$(rp_edge_parse_metric time_starttransfer "$write_line")"
  time_total="$(rp_edge_parse_metric time_total "$write_line")"
  errormsg="$(rp_edge_parse_metric errormsg "$write_line")"
  local parsed_exit
  parsed_exit="$(rp_edge_parse_metric curl_exit "$write_line")"
  [[ -n "$parsed_exit" ]] && curl_exit="$parsed_exit"
  [[ -z "$http_code" ]] && http_code="000"
  [[ -z "$http_ver" ]] && http_ver="0"
  curl_stderr="$(head -3 "$err" 2>/dev/null | tr '\n' ' ' | sed 's/[[:space:]]*$//' || true)"

  verdict="$(rp_edge_classify_result "$protocol" "$curl_exit" "$http_code" "$http_ver" "$ssl_verify" "$curl_stderr" "${accepted[@]}")"

  RP_PROBE_ATTEMPT="$attempt"
  RP_PROBE_PROTOCOL="$protocol"
  RP_PROBE_PATH="$path"
  RP_PROBE_HOST="$host"
  RP_PROBE_CURL_EXIT="$curl_exit"
  RP_PROBE_HTTP_CODE="$http_code"
  RP_PROBE_HTTP_VERSION="$http_ver"
  RP_PROBE_SSL_VERIFY="${ssl_verify:-}"
  RP_PROBE_REMOTE_IP="$remote_ip"
  RP_PROBE_TIME_CONNECT="$time_connect"
  RP_PROBE_TIME_APPCONNECT="$time_appconnect"
  RP_PROBE_TIME_STARTTRANSFER="$time_starttransfer"
  RP_PROBE_TIME_TOTAL="$time_total"
  RP_PROBE_ERRMSG="$errormsg"
  RP_PROBE_VERDICT="$verdict"
  RP_PROBE_CURL_STDERR="$curl_stderr"

  rm -f "$tmp" "$err"
  [[ "$verdict" == PASS ]]
}
