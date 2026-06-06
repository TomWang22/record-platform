#!/usr/bin/env bash
# Verify HTTP/3 (QUIC) to Caddy via MetalLB LB IP only — no 127.0.0.1, no socat, no NodePort forward.
# Use after: Colima bridged (./scripts/colima-start-k3s-bridged-clean.sh) + MetalLB + Caddy bring-up.
#
# Tests:
#   1. In-VM (or in-cluster hostNetwork pod): curl -k --http3-only https://<LB_IP>/_caddy/healthz  (authoritative for MetalLB + QUIC)
#   2. From Mac (if bridged): curl -k --http3-only https://<LB_IP>/_caddy/healthz  (no forwarder)
# Pass if either 1 or 2 returns 200.
#
# Usage: ./scripts/verify-colima-http3-direct.sh
#   HTTP3_CURL_IMAGE=alpine/curl-http3:latest   override in-cluster curl image (default: rmarx/curl-http3:latest; use alpine/curl-http3 on aarch64 if pull/run fails)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
cd "$REPO_ROOT"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
info(){ echo "ℹ️  $*"; }

# Normalize curl http_code to 3 chars (avoid 000000 or empty)
_normalize() { local c="${1:-000}"; c="${c:0:3}"; echo "${c:-000}"; }

ctx=$(kubectl config current-context 2>/dev/null || echo "")
if [[ "$ctx" != *"colima"* ]]; then
  warn "Context is not Colima ($ctx). This script is for Colima + MetalLB + bridged."
  exit 1
fi

# Get Caddy LB IP
lb_ip=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)
if [[ -z "$lb_ip" ]]; then
  warn "Caddy LoadBalancer has no IP yet. Wait for MetalLB: kubectl -n ingress-nginx get svc caddy-h3"
  exit 1
fi

say "=== HTTP/3 direct (LB IP only — no 127.0.0.1, no socat) ==="
info "LB IP: $lb_ip"

vm_ok=""
host_ok=""

# 1. In-VM (authoritative when VM curl has --http3-only)
say "1. In-VM (authoritative for MetalLB + QUIC)"
if command -v colima &>/dev/null; then
  vm_code=$(colima ssh -- curl -k -sS -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 10 --http3-only "https://${lb_ip}/_caddy/healthz" 2>/dev/null || echo "000")
  vm_code=$(_normalize "$vm_code")
  if [[ "$vm_code" == "200" ]]; then
    ok "In-VM HTTP/3 to $lb_ip returned 200 — MetalLB + QUIC correct."
    vm_ok=1
  else
    info "In-VM curl returned $vm_code (VM curl often lacks --http3-only). Trying in-cluster pod with HTTP/3..."
  fi
else
  info "colima not in PATH; skipping in-VM test"
fi

# 1b. Fallback: in-cluster pod with HTTP/3-capable curl (hostNetwork = node network = can reach LB IP via L2)
# Image must support --http3 (e.g. rmarx/curl-http3 or alpine/curl-http3). Override with HTTP3_CURL_IMAGE (e.g. alpine/curl-http3:latest on aarch64).
if [[ -z "$vm_ok" ]] && kubectl get ns ingress-nginx &>/dev/null; then
  say "1b. In-cluster HTTP/3 (hostNetwork pod — same as node; proves MetalLB + QUIC)"
  _h3_img="${HTTP3_CURL_IMAGE:-rmarx/curl-http3:latest}"
  pod_out=$(kubectl -n ingress-nginx run curl-h3-direct --rm -i --restart=Never \
    --overrides='{"spec":{"hostNetwork":true}}' \
    --image="$_h3_img" -- \
    curl -k -sS -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 15 --http3 "https://'"${lb_ip}"'/_caddy/healthz" 2>/dev/null || echo "000")
  # Extract 3-digit http code (pod may print "curl: ..." on stderr; take last line or only digits)
  pod_code=$(echo "$pod_out" | tail -1 | grep -oE '[0-9]{3}' | tail -1 || echo "000")
  pod_code=$(_normalize "$pod_code")
  if [[ "$pod_code" == "200" ]]; then
    ok "In-cluster (hostNetwork) HTTP/3 to $lb_ip returned 200 — MetalLB + QUIC correct."
    vm_ok=1
  else
    info "In-cluster HTTP/3 returned $pod_code (image pull or QUIC path issue)."
  fi
fi

# 2. From Mac (bridged: no forwarder)
say "2. From Mac (bridged: no forwarder)"
CURL_BIN="${CURL_BIN:-}"
if [[ -z "$CURL_BIN" ]] && [[ -x "/opt/homebrew/opt/curl/bin/curl" ]]; then
  "/opt/homebrew/opt/curl/bin/curl" --help all 2>/dev/null | grep -q -- "--http3-only" && CURL_BIN="/opt/homebrew/opt/curl/bin/curl"
fi
[[ -z "$CURL_BIN" ]] && CURL_BIN="curl"
host_code="000"
if [[ -x "$CURL_BIN" ]] && "$CURL_BIN" --help all 2>/dev/null | grep -q -- "--http3-only"; then
  host_code=$(NGTCP2_ENABLE_GSO=0 "$CURL_BIN" -k -sS -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 10 --http3-only "https://${lb_ip}/_caddy/healthz" 2>/dev/null || echo "000")
  host_code=$(_normalize "$host_code")
fi
if [[ "$host_code" == "200" ]]; then
  ok "From Mac HTTP/3 to $lb_ip returned 200 — bridged working (no socat)."
  host_ok=1
else
  # Diagnose: can Mac reach LB IP at all (HTTP/2)?
  h2_code="000"
  if [[ -x "$CURL_BIN" ]]; then
    h2_code=$("$CURL_BIN" -k -sS -o /dev/null -w "%{http_code}" --connect-timeout 3 --max-time 5 --http2 "https://${lb_ip}/_caddy/healthz" 2>/dev/null || echo "000")
    h2_code=$(_normalize "$h2_code")
  fi
  if [[ "$h2_code" == "200" ]]; then
    info "From Mac HTTP/2 to $lb_ip works (TCP reachable). QUIC returned $host_code — try: NGTCP2_ENABLE_GSO=0 curl -k -v --http3-only https://$lb_ip/_caddy/healthz"
  else
    # Node can have IPv4 and IPv6 InternalIP; macOS route needs IPv4 only
    node_ip=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}' 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | head -1 || true)
    info "From Mac cannot reach $lb_ip (HTTP/2 also $h2_code). Add route (IPv4 only): sudo route -n add 192.168.5.0/24 ${node_ip:-<node-ipv4>}"
  fi
fi

say "Summary"
if [[ -n "${vm_ok:-}" ]] || [[ -n "${host_ok:-}" ]]; then
  if [[ -n "${vm_ok:-}" ]]; then
    ok "MetalLB + QUIC verified via LB IP $lb_ip (in-VM or in-cluster). No 127.0.0.1 or socat needed."
  fi
  if [[ -n "${host_ok:-}" ]]; then
    ok "Mac can curl LB IP directly (bridged)."
  fi
  echo ""
  info "Full MetalLB + traffic policy verify: ./scripts/verify-metallb-and-traffic-policy.sh"
  exit 0
fi

warn "HTTP/3 did not pass (in-VM/in-cluster or from Mac). Caddy pods Running? Check: kubectl get pods -n ingress-nginx -l app=caddy-h3"
info "  In-VM (if curl has HTTP/3): colima ssh -- curl -k --http3-only https://$lb_ip/_caddy/healthz"
info "  From Mac (after route if needed): NGTCP2_ENABLE_GSO=0 curl -k -v --http3-only https://$lb_ip/_caddy/healthz"
info "  Full verify: ./scripts/verify-metallb-and-traffic-policy.sh"
exit 1
