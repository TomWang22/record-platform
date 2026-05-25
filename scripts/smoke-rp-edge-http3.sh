#!/usr/bin/env bash
# Smoke edge HTTP/2 + HTTP/3 against record-platform.test with trusted dev CA (no -k).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib/rp-dev-ca.sh
source "$SCRIPT_DIR/lib/rp-dev-ca.sh"
# shellcheck source=lib/rp-service-cert-contract.sh
source "$SCRIPT_DIR/lib/rp-service-cert-contract.sh"

HOST="${RP_EDGE_HOST:-$(rp_cert_contract_edge_cn)}"
NS="${HOUSING_NS:-record-platform}"
PATH_READY="${RP_EDGE_READY_PATH:-/readyz}"
CA="$(rp_dev_chain_pem)"
[[ -f "$CA" ]] || CA="$(rp_dev_root_pem)"

LB_IP="${CADDY_LB_IP:-}"
if [[ -z "$LB_IP" ]]; then
  LB_IP="$(kubectl get svc -n "$NS" caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
fi
[[ -n "$LB_IP" ]] || { echo "❌ no Caddy LB IP (set CADDY_LB_IP or deploy caddy-h3)" >&2; exit 1; }

_resolve() {
  printf --resolve '%s:443:%s' "$HOST" "$LB_IP"
}

CURL=(curl -sS -f --cacert "$CA" "$(_resolve)" "https://${HOST}${PATH_READY}")
echo "▶ HTTP/2 readyz https://${HOST}${PATH_READY} via ${LB_IP}"
"${CURL[@]}" -o /dev/null -w 'http2 %{http_code}\n' --http2

if command -v curl >/dev/null 2>&1 && curl --version 2>/dev/null | grep -qi http3; then
  echo "▶ HTTP/3 readyz"
  "${CURL[@]}" -o /dev/null -w 'http3 %{http_code}\n' --http3-only || {
    echo "⚠️  HTTP/3 probe failed (curl without http3 or edge not advertising h3)"
    exit 1
  }
else
  echo "ℹ️  curl lacks HTTP/3; skipped h3 probe"
fi

echo "✅ smoke-rp-edge-http3 passed (${HOST} @ ${LB_IP})"
