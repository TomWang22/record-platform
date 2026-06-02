#!/usr/bin/env bash
# Record Platform network contract — MetalLB + SNI record-platform.test (no localhost/NodePort edge).
# shellcheck shell=bash

RP_PUBLIC_HOST="${RP_PUBLIC_HOST:-record-platform.test}"
RP_PUBLIC_ORIGIN="${RP_PUBLIC_ORIGIN:-https://record-platform.test}"
RP_INGRESS_HOST="${RP_INGRESS_HOST:-record-platform.test}"
RP_TLS_SNI="${RP_TLS_SNI:-record-platform.test}"
RP_REQUIRE_METALLB="${RP_REQUIRE_METALLB:-1}"
RP_FORBID_NODEPORT="${RP_FORBID_NODEPORT:-1}"
RP_FORBID_LOCALHOST_ENTRYPOINT="${RP_FORBID_LOCALHOST_ENTRYPOINT:-1}"

# Legacy OCH names — prefer RP_*; scripts may read these only as fallback.
RP_EDGE_HOSTNAME="${RP_EDGE_HOSTNAME:-$RP_PUBLIC_HOST}"
OCH_EDGE_HOSTNAME="${OCH_EDGE_HOSTNAME:-$RP_EDGE_HOSTNAME}"

RP_CADDY_NAMESPACE="${RP_CADDY_NAMESPACE:-ingress-nginx}"
RP_CADDY_SERVICE="${RP_CADDY_SERVICE:-caddy-h3}"
RP_SMOKE_HEALTH_PATH="${RP_SMOKE_HEALTH_PATH:-/api/healthz}"
# Edge TLS: leaf is intermediate-signed; trust dev-chain.pem (not dev-root.pem alone).
if [[ -z "${RP_CA_CERT:-}" ]] && [[ -f "${REPO_ROOT:-}/certs/dev-chain.pem" ]]; then
  RP_CA_CERT="${REPO_ROOT}/certs/dev-chain.pem"
fi
RP_CA_CERT="${RP_CA_CERT:-${REPO_ROOT:-}/certs/dev-root.pem}"

rp_repo_root() {
  if [[ -n "${REPO_ROOT:-}" ]]; then
    printf '%s\n' "$REPO_ROOT"
    return 0
  fi
  local here
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  REPO_ROOT="$here"
  printf '%s\n' "$here"
}

rp_discover_metallb_ip() {
  local ip=""
  if [[ -n "${METALLB_IP:-}" ]]; then
    printf '%s\n' "$METALLB_IP"
    return 0
  fi
  if [[ -n "${EXTERNAL_IP:-}" ]] && [[ "$EXTERNAL_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    printf '%s\n' "$EXTERNAL_IP"
    return 0
  fi
  if command -v kubectl >/dev/null 2>&1; then
    ip="$(kubectl get svc "$RP_CADDY_SERVICE" -n "$RP_CADDY_NAMESPACE" \
      -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null | tr -d '\r' || true)"
    if [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      printf '%s\n' "$ip"
      return 0
    fi
  fi
  return 1
}

rp_curl_edge_resolve_args() {
  local ip="${1:-}"
  [[ -z "$ip" ]] && ip="$(rp_discover_metallb_ip || true)"
  if [[ ! "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "rp_curl_edge_resolve_args: no MetalLB IP (set METALLB_IP)" >&2
    return 1
  fi
  printf '%s\n' --resolve "${RP_TLS_SNI}:443:${ip}"
}

rp_curl_edge_common_args() {
  local ip="${1:-}"
  local root ca
  root="$(rp_repo_root)"
  ca="${RP_CA_CERT}"
  [[ "$ca" != /* ]] && ca="$root/$ca"
  rp_curl_edge_resolve_args "$ip" || return 1
  if [[ -f "$ca" ]]; then
    printf '%s\n' --cacert "$ca"
  elif [[ "${RP_TLS_INSECURE:-0}" == "1" ]]; then
    printf '%s\n' -k
  else
    echo "rp_curl_edge_common_args: missing CA $ca (set RP_CA_CERT or RP_TLS_INSECURE=1)" >&2
    return 1
  fi
}

rp_edge_url() {
  local path="${1:-/}"
  [[ "$path" != /* ]] && path="/$path"
  printf '%s%s\n' "$RP_PUBLIC_ORIGIN" "$path"
}
