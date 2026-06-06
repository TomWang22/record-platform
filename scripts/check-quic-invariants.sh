#!/usr/bin/env bash
# Preflight: fail fast if any QUIC invariant is broken.
# Run after restore and Caddy apply; before running suites or verify-caddy-http3-in-cluster.sh.
#
# Checks: Layer 1 (docker UDP 30443, curl http3), Layer 2 (NodePort QUIC), Layer 3 (pod UDP 443),
# Layer 4 (service UDP), Layer 5 (SNI: tests use record.local).
#
# Usage: ./scripts/check-quic-invariants.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${CADDY_NS:-ingress-nginx}"

ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
fail(){ echo "❌ $*" >&2; exit 1; }

cd "$REPO_ROOT"

# Layer 1 — Docker UDP 30443
if ! docker ps --format '{{.Ports}}' 2>/dev/null | grep -q 30443; then
  fail "Layer 1: Docker does not show 30443. Recreate cluster: ./scripts/restore-k3d-quic-known-good.sh"
fi
_udp=$(docker ps --format '{{.Ports}}' 2>/dev/null | grep -o '30443/udp' || true)
[[ -z "$_udp" ]] && fail "Layer 1: UDP 30443 not published. Recreate with --port 30443:30443/udp@server:0"
ok "Layer 1: Docker UDP 30443 published"

_curl=""
for c in /opt/homebrew/opt/curl/bin/curl /usr/local/opt/curl/bin/curl curl; do
  [[ -x "$c" ]] 2>/dev/null || continue
  "$c" --help all 2>/dev/null | grep -q -- "--http3-only" && _curl="$c" && break
done
[[ -z "$_curl" ]] && warn "Layer 1: No curl with --http3-only on host (install curl with ngtcp2 for host QUIC tests)"
[[ -n "$_curl" ]] && ok "Layer 1: curl supports HTTP/3"

# Layer 3 — Pod UDP 443 (before Layer 2 so we know Caddy is up)
POD=$(kubectl get pods -n "$NS" -l app=caddy-h3 --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
if [[ -z "$POD" ]]; then
  fail "Layer 3: No running caddy-h3 pod in $NS. Deploy base and run ensure-caddy-http3-config.sh"
fi
_udp_pod=$(kubectl exec -n "$NS" "$POD" -- ss -ulnp 2>/dev/null | grep 443 || kubectl exec -n "$NS" "$POD" -- netstat -ulnp 2>/dev/null | grep 443 || true)
[[ -z "$_udp_pod" ]] && fail "Layer 3: Caddy pod not listening on UDP 443. Check Caddyfile and rollout."
ok "Layer 3: Caddy pod UDP 443 listening"

# Layer 4 — Service UDP
_svc_udp=$(kubectl get svc caddy-h3 -n "$NS" -o jsonpath='{.spec.ports[?(@.protocol=="UDP")].port}' 2>/dev/null || true)
[[ -z "$_svc_udp" ]] && fail "Layer 4: Service caddy-h3 has no UDP port. Fix Service to expose protocol: UDP for 443."
ok "Layer 4: Service exposes UDP 443"

# Layer 2 — NodePort QUIC (requires record.local; use 127.0.0.1 for NodePort)
if [[ -n "$_curl" ]]; then
  _code=$(NGTCP2_ENABLE_GSO=0 "$_curl" -sS -o /dev/null -w '%{http_code}' --max-time 10 --http3-only -k --resolve "record.local:30443:127.0.0.1" "https://record.local:30443/_caddy/healthz" 2>/dev/null || echo "000")
  if [[ "$_code" != "200" ]]; then
    warn "Layer 2: NodePort QUIC returned $_code (expected 200). Ensure Caddy has record.local block and no on_demand; use --resolve record.local:30443:127.0.0.1"
  else
    ok "Layer 2: NodePort QUIC (record.local:30443) returns 200"
  fi
fi

# Layer 5 — SNI: reminder (no automated check for "all scripts")
echo ""
ok "Layer 5: All QUIC tests must use --resolve record.local:443:<ip> and https://record.local (see docs/QUIC_INVARIANTS.md)"
echo "  Run: ./scripts/verify-caddy-http3-in-cluster.sh"
