#!/usr/bin/env bash
# Canonical edge URL/TLS args for record-platform.test via MetalLB (no -k, no record.local).
# shellcheck shell=bash
set -euo pipefail

_RP_EDGE_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_RP_EDGE_REPO="$(cd "$_RP_EDGE_LIB_DIR/../.." && pwd)"
# shellcheck source=scripts/lib/rp-dev-ca.sh
source "$_RP_EDGE_LIB_DIR/rp-dev-ca.sh"

EDGE_HOST="${EDGE_HOST:-${RP_PUBLIC_HOST:-record-platform.test}}"
EDGE_PORT="${EDGE_PORT:-443}"
EDGE_NS="${EDGE_NS:-${CADDY_NS:-ingress-nginx}}"
EDGE_SVC="${EDGE_SVC:-caddy-h3}"

EDGE_IP=""
if command -v kubectl >/dev/null 2>&1; then
  EDGE_IP="$(kubectl -n "$EDGE_NS" get svc "$EDGE_SVC" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
fi
[[ -n "${CADDY_TARGET:-}" ]] && EDGE_IP="${CADDY_TARGET}"

EDGE_CACERT="${EDGE_CACERT:-${CA_CERT:-$(rp_dev_edge_ca_file 2>/dev/null || echo "$_RP_EDGE_REPO/certs/dev-chain.pem")}}"

EDGE_RESOLVE_ARGS=()
if [[ -n "$EDGE_IP" ]]; then
  EDGE_RESOLVE_ARGS=(--resolve "${EDGE_HOST}:${EDGE_PORT}:${EDGE_IP}")
fi

EDGE_CURL_TLS_ARGS=()
if [[ -f "$EDGE_CACERT" ]]; then
  EDGE_CURL_TLS_ARGS=(--cacert "$EDGE_CACERT")
else
  echo "❌ rp-edge-url: missing CA bundle at $EDGE_CACERT (run scripts/strict-tls-bootstrap.sh)" >&2
  return 1 2>/dev/null || exit 1
fi

EDGE_BASE_URL="https://${EDGE_HOST}:${EDGE_PORT}"

rp_edge_curl() {
  # Usage: rp_edge_curl [extra curl args...] URL
  curl -sS --fail --show-error \
    "${EDGE_CURL_TLS_ARGS[@]}" \
    "${EDGE_RESOLVE_ARGS[@]}" \
    "$@"
}

export EDGE_HOST EDGE_PORT EDGE_IP EDGE_CACERT EDGE_RESOLVE_ARGS EDGE_CURL_TLS_ARGS EDGE_BASE_URL EDGE_NS EDGE_SVC
