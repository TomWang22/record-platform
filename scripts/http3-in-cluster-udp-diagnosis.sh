#!/usr/bin/env bash
# Isolate in-cluster HTTP/3 failure: bypass Service (Test 1), iptables UDP (Test 2), flannel (Test 3).
# Run when Phase 4 fails (in-cluster curl to Service returns 000) but Caddy listens on UDP 443.
#
# Interpretation:
#   Test 1 (direct pod IP) works  → Service/kube-proxy UDP is broken.
#   Test 1 fails                 → Caddy QUIC or pod-to-pod UDP path is broken.
#   Test 2 missing UDP DNAT      → kube-proxy did not program UDP for the Service.
#   Test 3 missing 10.42.x/24     → Flannel overlay broken.
#
# Usage: ./scripts/http3-in-cluster-udp-diagnosis.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${CADDY_NS:-ingress-nginx}"
CURL_IMAGE="${CURL_IMAGE:-alpine/curl-http3:latest}"
# k3d server node container name (cluster name from kubeconfig or env)
K3D_SERVER="${K3D_SERVER:-k3d-record-platform-server-0}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
fail(){ echo "❌ $*"; }
info(){ echo "ℹ️  $*"; }

cd "$REPO_ROOT"

# Resolve server node container (k3d: k3d-<cluster>-server-0)
if [[ -z "${K3D_SERVER:-}" ]] && kubectl config current-context 2>/dev/null | grep -q k3d; then
  _cluster=$(kubectl config current-context 2>/dev/null | sed 's/^k3d-//')
  K3D_SERVER="k3d-${_cluster}-server-0"
fi

say "=== Test 1 — Bypass Service: curl to Caddy with record.local (SNI) ==="
# Invariant: use record.local so SNI matches Caddy server block. Never raw IP in production tests.
CADDY_POD_IP=$(kubectl get pod -n "$NS" -l app=caddy-h3 -o jsonpath='{.items[0].status.podIP}' 2>/dev/null || true)
if [[ -z "$CADDY_POD_IP" ]]; then
  fail "No caddy-h3 pod IP (is Caddy deployed in $NS?)"
  exit 1
fi
info "Caddy pod IP: $CADDY_POD_IP"
info "Running curl --http3-only -k --resolve record.local:443:$CADDY_POD_IP https://record.local/ (image: $CURL_IMAGE)..."
_override=$(cat <<OV
{"spec":{"containers":[{"name":"curl","image":"$CURL_IMAGE","command":["/bin/sh","-c","NGTCP2_ENABLE_GSO=0 code=\$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 --http3-only -k --resolve record.local:443:$CADDY_POD_IP https://record.local/ 2>&1); echo HTTP_CODE:\${code:-000}"]}]}}
OV
)
_result=$(kubectl run http3-test-direct-ip --rm -i --restart=Never -n "$NS" --image="$CURL_IMAGE" --overrides="$_override" </dev/null 2>/dev/null | grep -o 'HTTP_CODE:[0-9]*' || echo "HTTP_CODE:000")
_code=$(echo "$_result" | cut -d: -f2)
if [[ "$_code" == "200" ]]; then
  ok "Test 1: record.local HTTP/3 to pod IP returned 200 → Service/kube-proxy UDP path may be broken; pod-to-pod QUIC works."
else
  warn "Test 1: record.local HTTP/3 returned $_code (expected 200). If Caddy uses record.local block, ensure --resolve record.local:443:<ip> and https://record.local. For debug-only isolation use tls internal { on_demand }."
fi

say "=== Test 2 — iptables NAT: UDP 443 DNAT to Caddy pod ==="
if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${K3D_SERVER}$"; then
  warn "Server node container $K3D_SERVER not found (not k3d or wrong name). Set K3D_SERVER=... to run Test 2."
else
  _udp_dnat=$(docker exec "$K3D_SERVER" iptables -t nat -L -n 2>/dev/null | grep -E "udp.*443.*10\.42\.|https-udp.*10\.42\." || true)
  if [[ -n "$_udp_dnat" ]]; then
    ok "Test 2: UDP 443 DNAT rules present (kube-proxy programmed UDP)."
    echo "$_udp_dnat" | sed 's/^/  /'
  else
    fail "Test 2: No UDP 443 DNAT to pod IP. kube-proxy may not be programming UDP for the Service."
  fi
fi

say "=== Test 3 — Flannel overlay routes ==="
if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${K3D_SERVER}$"; then
  warn "Server node container $K3D_SERVER not found. Set K3D_SERVER=... to run Test 3."
else
  _flannel=$(docker exec "$K3D_SERVER" ip route 2>/dev/null | grep -E "10\.42\.|flannel" || true)
  if [[ -n "$_flannel" ]]; then
    ok "Test 3: Overlay routes present (10.42.x or flannel)."
    echo "$_flannel" | sed 's/^/  /'
  else
    fail "Test 3: No 10.42.x/flannel routes. Flannel overlay may be broken."
  fi
fi

say "=== Summary ==="
echo "  Test 1 (direct pod IP): $_code"
echo "  If 200 → fix Service/kube-proxy UDP. If not 200 → ensure Caddy has record.local block and tests use --resolve record.local:443:<ip> and https://record.local (no IP-based QUIC)."
echo "  See docs/HTTP3_DEBUG_PLAYBOOK.md and docs/QUIC_INVARIANT_CHECKLIST.md"
