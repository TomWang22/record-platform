#!/usr/bin/env bash
# Causal HTTP/3 diagnostic: what actually changed?
# Run after "it worked before, then listings fix broke it" — checks Caddy UDP, service, config, and in-cluster QUIC.
#
# Usage: ./scripts/diagnose-http3-causal.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${CADDY_NS:-ingress-nginx}"
SVC="caddy-h3"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
fail(){ echo "❌ $*"; }
info(){ echo "ℹ️  $*"; }

export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
cd "$REPO_ROOT"

say "=== 1. Caddy pod: is UDP 443 actually listening? ==="
POD=$(kubectl get pods -n "$NS" -l app=caddy-h3 -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
if [[ -z "$POD" ]]; then
  fail "No caddy-h3 pod in $NS"
else
  info "Pod: $POD"
  if kubectl exec -n "$NS" "$POD" -- ss -lunp 2>/dev/null | grep -E "443|UNCONN" || true; then
    _udp=$(kubectl exec -n "$NS" "$POD" -- ss -lunp 2>/dev/null | grep 443 || true)
    if [[ -n "$_udp" ]]; then
      ok "UDP 443 bound inside pod"
    else
      warn "No UDP 443 in ss -lunp (QUIC may not be listening)"
    fi
  else
    # Alpine/minimal may not have ss
    info "Trying netstat..."
    kubectl exec -n "$NS" "$POD" -- netstat -ulnp 2>/dev/null | grep 443 || warn "netstat failed or no UDP 443"
  fi
fi

say "=== 2. Service: does caddy-h3 expose UDP 443? ==="
kubectl get svc -n "$NS" "$SVC" -o yaml 2>/dev/null | grep -A2 -E "protocol|port: 443|targetPort" || true
_prot_udp=$(kubectl get svc -n "$NS" "$SVC" -o jsonpath='{.spec.ports[?(@.protocol=="UDP")]}' 2>/dev/null || true)
if [[ -n "$_prot_udp" ]]; then
  ok "Service has UDP port (443) defined"
else
  warn "Service may be missing protocol: UDP for 443"
fi

say "=== 3. Caddyfile in pod: is HTTP/3 (h3) enabled? ==="
if [[ -n "$POD" ]]; then
  _caddyfile=$(kubectl exec -n "$NS" "$POD" -- cat /etc/caddy/Caddyfile 2>&1) || true
  if echo "$_caddyfile" | grep -qE "h3|experimental_http3|protocols.*h3"; then
    ok "Caddyfile enables HTTP/3 (h3)"
    echo "$_caddyfile" | grep -E "protocols|servers|h3|http3" | head -10 | sed 's/^/  /'
  else
    warn "Caddyfile may NOT enable HTTP/3 (no h3 / experimental_http3 / protocols h3)"
    info "First 30 lines of mounted Caddyfile (or exec error):"
    echo "$_caddyfile" | head -30 | sed 's/^/  /'
    if [[ -z "$_caddyfile" ]] || echo "$_caddyfile" | grep -q "No such file\|cannot open\|Permission denied"; then
      fail "Pod may have empty/wrong mount. Run: ./scripts/deep-dive-caddy-http3.sh"
    fi
    info "To fix: re-apply ConfigMap and restart Caddy: ./scripts/ensure-caddy-http3-config.sh (or see deep-dive-caddy-http3.sh)"
  fi
fi

say "=== 4. HTTP/2 still works? (curl to LB IP or NodePort) ==="
LB_IP=$(kubectl get svc -n "$NS" "$SVC" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)
NP=$(kubectl get svc -n "$NS" "$SVC" -o jsonpath='{.spec.ports[?(@.name=="https")].nodePort}' 2>/dev/null || true)
if [[ -n "$LB_IP" ]]; then
  _h2=$(curl -k -sS -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 10 --http2 --resolve "record.local:443:$LB_IP" "https://record.local/_caddy/healthz" 2>/dev/null || echo "000")
  if [[ "$_h2" == "200" ]]; then
    ok "HTTP/2 via LB IP $LB_IP: 200"
  else
    warn "HTTP/2 via LB IP $LB_IP: $_h2"
  fi
fi
if [[ -n "$NP" ]]; then
  _h2np=$(curl -k -sS -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 10 --http2 --resolve "record.local:$NP:127.0.0.1" "https://record.local:$NP/_caddy/healthz" 2>/dev/null || echo "000")
  if [[ "$_h2np" == "200" ]]; then
    ok "HTTP/2 via NodePort 127.0.0.1:$NP: 200"
  else
    warn "HTTP/2 via NodePort 127.0.0.1:$NP: $_h2np"
  fi
fi

say "=== 5. Caddy pod logs (QUIC / bind / UDP errors) ==="
if [[ -n "$POD" ]]; then
  kubectl logs -n "$NS" "$POD" --tail=80 2>/dev/null | grep -iE "quic|udp|bind|443|listen|error|warn|http3" || info "No matching log lines (or no errors)"
  kubectl logs -n "$NS" "$POD" --tail=5 2>/dev/null | sed 's/^/  /'
fi

say "=== 6. In-cluster QUIC (bypass NodePort) ==="
if [[ -f "$SCRIPT_DIR/verify-caddy-http3-in-cluster.sh" ]]; then
  info "Running verify-caddy-http3-in-cluster.sh (curl from pod to Caddy service)..."
  if "$SCRIPT_DIR/verify-caddy-http3-in-cluster.sh" 2>&1; then
    ok "In-cluster HTTP/3: QUIC works (failure is host↔NodePort/socat path)"
  else
    warn "In-cluster HTTP/3 failed — QUIC is broken inside cluster (Caddy or config)"
  fi
else
  info "Run: kubectl run -it --rm q --image=alpine/curl-http3 -- curl -k --http3-only https://caddy-h3.ingress-nginx.svc.cluster.local/_caddy/healthz"
fi

say "=== 7. ConfigMap caddy-h3 (what Caddy actually mounts) ==="
kubectl get configmap caddy-h3 -n "$NS" -o jsonpath='{.data.Caddyfile}' 2>/dev/null | head -20 | sed 's/^/  /' || info "ConfigMap caddy-h3 not found or no Caddyfile key"

say "=== Summary ==="
echo "  If UDP 443 is not in ss -lunp → Caddy is not listening for QUIC."
echo "  If service has no UDP port → NodePort/kube-proxy won't forward UDP."
echo "  If Caddyfile has no h3 → HTTP/3 disabled."
echo "  If HTTP/2 works but HTTP/3 fails → QUIC path only is broken."
echo "  If in-cluster HTTP/3 works but host fails → host↔NodePort UDP or socat."
