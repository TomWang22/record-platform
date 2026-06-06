#!/usr/bin/env bash
# Shared helpers for HTTP/3 edge RCA, audits, and strict smoke tests.
set -euo pipefail

RP_HTTP3_EDGE_NS="${RP_HTTP3_EDGE_NS:-ingress-nginx}"
RP_HTTP3_EDGE_SVC="${RP_HTTP3_EDGE_SVC:-caddy-h3}"
RP_HTTP3_EDGE_HOST="${RP_HTTP3_EDGE_HOST:-record-platform.test}"

rp_http3_repo_root() {
  if [[ -n "${REPO_ROOT:-}" ]]; then
    printf '%s\n' "$REPO_ROOT"
    return 0
  fi
  local here
  here="$(cd "$(dirname "${BASH_SOURCE[1]:-${BASH_SOURCE[0]}}")/../.." && pwd)"
  REPO_ROOT="$here"
  printf '%s\n' "$here"
}

rp_http3_curl_bin() {
  local root shim
  root="$(rp_http3_repo_root)"
  shim="$root/scripts/shims/curl"
  if [[ -x "$shim" ]]; then
    printf '%s\n' "$shim"
    return 0
  fi
  for p in /opt/homebrew/opt/curl/bin/curl /opt/homebrew/bin/curl /usr/local/opt/curl/bin/curl; do
    [[ -x "$p" ]] && { printf '%s\n' "$p"; return 0; }
  done
  command -v curl
}

rp_http3_ca_cert() {
  local root
  root="$(rp_http3_repo_root)"
  if [[ -f "$root/certs/dev-chain.pem" ]]; then
    printf '%s\n' "$root/certs/dev-chain.pem"
  elif [[ -f "$root/certs/dev-root.pem" ]]; then
    printf '%s\n' "$root/certs/dev-root.pem"
  else
    return 1
  fi
}

rp_http3_lb_ip() {
  if [[ -n "${METALLB_IP:-}" ]] && [[ "$METALLB_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    printf '%s\n' "$METALLB_IP"
    return 0
  fi
  kubectl get svc "$RP_HTTP3_EDGE_SVC" -n "$RP_HTTP3_EDGE_NS" \
    -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null | tr -d '\r'
}

rp_http3_svc_nodeport() {
  local proto="$1"
  kubectl get svc "$RP_HTTP3_EDGE_SVC" -n "$RP_HTTP3_EDGE_NS" \
    -o jsonpath="{.spec.ports[?(@.protocol==\"${proto}\" && (@.port==443 || @.name==\"https\" || @.name==\"https-udp\"))].nodePort}" \
    2>/dev/null | tr -d '\r'
}

rp_http3_allocate_lb_nodeports() {
  kubectl get svc "$RP_HTTP3_EDGE_SVC" -n "$RP_HTTP3_EDGE_NS" \
    -o jsonpath='{.spec.allocateLoadBalancerNodePorts}' 2>/dev/null | tr -d '\r'
}

rp_http3_external_traffic_policy() {
  kubectl get svc "$RP_HTTP3_EDGE_SVC" -n "$RP_HTTP3_EDGE_NS" \
    -o jsonpath='{.spec.externalTrafficPolicy}' 2>/dev/null | tr -d '\r'
}

rp_http3_any_nodeport_set() {
  local np
  np="$(kubectl get svc "$RP_HTTP3_EDGE_SVC" -n "$RP_HTTP3_EDGE_NS" \
    -o jsonpath='{range .spec.ports[*]}{.nodePort}{" "}{end}' 2>/dev/null | tr -d '\r' || true)"
  for n in $np; do
    [[ -n "$n" && "$n" != "null" && "$n" != "0" ]] && return 0
  done
  return 1
}

rp_http3_print_nodeports() {
  kubectl get svc "$RP_HTTP3_EDGE_SVC" -n "$RP_HTTP3_EDGE_NS" \
    -o jsonpath='{range .spec.ports[*]}{.name} {.protocol} nodePort={.nodePort}{"\n"}{end}' 2>/dev/null
}

rp_http3_tcp_nodeport() {
  kubectl get svc "$RP_HTTP3_EDGE_SVC" -n "$RP_HTTP3_EDGE_NS" \
    -o jsonpath='{.spec.ports[?(@.name=="https")].nodePort}' 2>/dev/null | tr -d '\r'
}

rp_http3_udp_nodeport() {
  kubectl get svc "$RP_HTTP3_EDGE_SVC" -n "$RP_HTTP3_EDGE_NS" \
    -o jsonpath='{.spec.ports[?(@.name=="https-udp")].nodePort}' 2>/dev/null | tr -d '\r'
}

rp_http3_nodeports_collide() {
  local tcp udp
  tcp="$(rp_http3_tcp_nodeport || true)"
  udp="$(rp_http3_udp_nodeport || true)"
  [[ -n "$tcp" && -n "$udp" && "$tcp" == "$udp" ]]
}

rp_http3_svclb_active() {
  kubectl get ds -n kube-system 2>/dev/null | grep -qE 'svclb-.*caddy-h3|svclb-caddy-h3' \
    || kubectl get pods -n kube-system 2>/dev/null | grep -qE 'svclb-.*caddy-h3'
}

rp_http3_metallb_active() {
  kubectl get pods -n metallb-system --request-timeout=5s 2>/dev/null \
    | awk 'NR>1 && $3=="Running" {found=1} END {exit !found}'
}

rp_http3_session_affinity() {
  kubectl get svc "$RP_HTTP3_EDGE_SVC" -n "$RP_HTTP3_EDGE_NS" \
    -o jsonpath='{.spec.sessionAffinity}' 2>/dev/null | tr -d '\r'
}

rp_http3_curl_strict() {
  # rp_http3_curl_strict <path> — returns via stdout: status,exit,time,ver,tls_ok
  local path="${1:-/api/readyz}"
  local host lb curl_bin ca tmp
  host="${RP_HTTP3_EDGE_HOST}"
  lb="$(rp_http3_lb_ip || true)"
  curl_bin="$(rp_http3_curl_bin)"
  ca="$(rp_http3_ca_cert || true)"
  [[ -n "$lb" ]] || { echo "000,1,0,0,0"; return 1; }
  [[ -n "$ca" ]] || { echo "000,1,0,0,0"; return 1; }
  tmp="$(mktemp)"
  local code ver time exit_code tls_ok=1
  set +e
  "$curl_bin" -sfS \
    --cacert "$ca" \
    --resolve "${host}:443:${lb}" \
    --http3-only \
    --connect-timeout 10 \
    --max-time 30 \
    -o "$tmp" \
    -w '%{http_code} %{http_version} %{time_total}' \
    "https://${host}${path}" 2>/dev/null
  exit_code=$?
  set -e
  read -r code ver time _ <<<"$(tail -1 "$tmp" 2>/dev/null || true)"
  rm -f "$tmp"
  if [[ "$exit_code" -ne 0 ]]; then
    code="${code:-000}"
    ver="${ver:-0}"
    time="${time:-0}"
  fi
  echo "${code},${exit_code},${time},${ver},${tls_ok}"
}
