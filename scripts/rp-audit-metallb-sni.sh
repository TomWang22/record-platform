#!/usr/bin/env bash
# Verify MetalLB caddy-h3 exposes TCP+UDP 443 and edge health over SNI record-platform.test (h1/h2/h3).
#
# Usage: bash scripts/rp-audit-metallb-sni.sh
# Env: METALLB_IP, RP_PUBLIC_HOST, RP_TLS_INSECURE, RP_SMOKE_HEALTH_PATH, RP_EDGE_PROTO_DEBUG=1
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
# shellcheck source=scripts/lib/rp-network-contract.sh
source "$SCRIPT_DIR/lib/rp-network-contract.sh"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok() { echo "✅ $*"; }
bad() { echo "❌ $*" >&2; }
warn() { echo "⚠️  $*" >&2; }

command -v kubectl >/dev/null || { bad "kubectl required"; exit 1; }
command -v curl >/dev/null || { bad "curl required"; exit 1; }

METALLB_IP="$(rp_discover_metallb_ip || true)"
if [[ ! "$METALLB_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  bad "caddy-h3 LoadBalancer IP not assigned (kubectl get svc -n ${RP_CADDY_NAMESPACE} ${RP_CADDY_SERVICE})"
  exit 1
fi
ok "MetalLB IP=${METALLB_IP}"

say "Service ports (expect TCP 443 + UDP 443)"
PORTS_JSON="$(kubectl get svc "$RP_CADDY_SERVICE" -n "$RP_CADDY_NAMESPACE" -o json)"
python3 - <<'PY' "$PORTS_JSON"
import json, sys
doc = json.loads(sys.argv[1])
ports = doc.get("spec", {}).get("ports") or []
names = {(p.get("name"), p.get("protocol"), p.get("port")) for p in ports}
need = {("https", "TCP", 443), ("https-udp", "UDP", 443)}
missing = need - names
if missing:
    print("MISSING", missing)
    sys.exit(1)
print("OK", sorted(names))
PY

HEALTH_URL="$(rp_edge_url "$RP_SMOKE_HEALTH_PATH")"
mapfile -t RESOLVE_ARGS < <(rp_curl_edge_resolve_args "$METALLB_IP")
mapfile -t TLS_ARGS < <(rp_curl_edge_common_args "$METALLB_IP")

curl_probe() {
  local label="$1"
  shift
  local tmp hdr
  tmp="$(mktemp)"
  hdr="$(mktemp)"
  if ! curl -sfS "${TLS_ARGS[@]}" "${RESOLVE_ARGS[@]}" -D "$hdr" -o "$tmp" "$@" "$HEALTH_URL"; then
    bad "curl $label failed for $HEALTH_URL"
    rm -f "$tmp" "$hdr"
    return 1
  fi
  local code
  code="$(awk 'toupper($1) ~ /^HTTP\// {print $2; exit}' "$hdr" || echo "?")"
  if [[ "$code" != "200" ]]; then
    bad "curl $label HTTP $code (expected 200)"
    rm -f "$tmp" "$hdr"
    return 1
  fi
  ok "curl $label → HTTP $code"
  if [[ "${RP_EDGE_PROTO_DEBUG:-0}" == "1" ]] || [[ "${RP_EDGE_PROTO_DEBUG:-0}" == "1" ]]; then
    local edge_hdr
    edge_hdr="$(awk 'tolower($0) ~ /^x-rp-debug-edge-proto:|^x-rp-debug-edge-proto:/ {print; exit}' "$hdr" | tr -d '\r')"
    if [[ -n "$edge_hdr" ]]; then
      ok "edge proto header: $edge_hdr"
    else
      warn "no X-RP-Debug-Edge-Proto / X-RP-Debug-Edge-Proto (set RP_EDGE_PROTO_DEBUG=1 on gateway)"
    fi
  fi
  rm -f "$tmp" "$hdr"
}

say "HTTP/1.1 + SNI ${RP_TLS_SNI}"
curl_probe "http1.1" --http1.1

say "HTTP/2 + SNI ${RP_TLS_SNI}"
curl_probe "http2" --http2

say "HTTP/3 + SNI ${RP_TLS_SNI}"
if curl --version 2>/dev/null | grep -qiE 'http3|ngtcp2|nghttp3'; then
  curl_probe "http3" --http3-only
else
  warn "curl lacks HTTP/3; skipping --http3-only probe"
fi

say "Alt-Svc advertisement (optional)"
alt="$(curl -sI "${TLS_ARGS[@]}" "${RESOLVE_ARGS[@]}" --http2 "$HEALTH_URL" 2>/dev/null | awk 'tolower($1)=="alt-svc:" {print; exit}' | tr -d '\r' || true)"
if [[ -n "$alt" ]]; then
  ok "Alt-Svc: $alt"
else
  warn "Alt-Svc header not present (configure in Caddy when enabling h3 advertisement)"
fi

ok "rp-audit-metallb-sni passed"
exit 0
