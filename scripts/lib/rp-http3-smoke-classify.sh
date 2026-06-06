#!/usr/bin/env bash
# Backward-compatible aliases for HTTP/3 smoke (delegates to rp-edge-curl-probe.sh).
# shellcheck shell=bash
# shellcheck source=rp-edge-curl-probe.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/rp-edge-curl-probe.sh"

rp_http3_smoke_accept_code() {
  rp_edge_code_accepted "$1" 200 301 302 308 401
}

rp_http3_smoke_classify_verdict() {
  local curl_exit="${1:-1}" http_code="${2:-000}" http_ver="${3:-0}" ssl_verify="${4:-}" curl_stderr="${5:-}"
  rp_edge_classify_result h3 "$curl_exit" "$http_code" "$http_ver" "$ssl_verify" "$curl_stderr" \
    200 301 302 308 401
}

rp_http3_smoke_parse_metric() {
  rp_edge_parse_metric "$1" "$2"
}
