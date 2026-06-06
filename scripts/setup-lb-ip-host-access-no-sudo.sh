#!/usr/bin/env bash
# Host → Caddy via Colima VM without sudo: forward 127.0.0.1:8443 (TCP+UDP) to VM:NodePort.
# Use when: Colima k3s, real L2 (LB IP on VM), Mac not on same L2 — so we skip lo0 alias and port 443.
# No Docker bridge by default (set START_DOCKER_BRIDGE=1 to listen on 0.0.0.0:18443 for containers).
#
# Usage: ./scripts/setup-lb-ip-host-access-no-sudo.sh
#   HOST_HTTPS_PORT=8443   port on 127.0.0.1 (default 8443; no root needed)
#   START_DOCKER_BRIDGE=1 also start 0.0.0.0:18443 → VM:NodePort for containers
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

HOST_HTTPS_PORT="${HOST_HTTPS_PORT:-8443}"
DOCKER_BRIDGE_PORT="${DOCKER_BRIDGE_PORT:-18443}"
START_DOCKER_BRIDGE="${START_DOCKER_BRIDGE:-0}"

say() { printf "\n\033[1m▶ %s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
info(){ echo "ℹ️  $*"; }

# LB IP and NodePort from cluster (for display and env)
LB_IP=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)
[[ -z "$LB_IP" ]] && LB_IP=$(kubectl get svc -A -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}' 2>/dev/null | head -1 || true)
NODEPORT=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.spec.ports[?(@.port==443)].nodePort}' 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+$' | head -1 || true)
[[ -z "$NODEPORT" ]] && NODEPORT="30443"

if [[ -z "$LB_IP" ]]; then
  warn "No LoadBalancer IP in cluster; continuing with NodePort only."
fi

# Colima VM IP: must be the Mac-reachable IP (Lima/Colima host-VM network), not the VM's eth0 (192.168.5.x).
# Prefer node InternalIP (e.g. 192.168.64.7 = col0) so socat on Mac can reach the VM's NodePort.
COLIMA_IP=""
if [[ -n "${COLIMA_IP_OVERRIDE:-}" ]]; then
  COLIMA_IP="$COLIMA_IP_OVERRIDE"
elif command -v kubectl &>/dev/null; then
  # Take first IPv4 InternalIP (jsonpath can return multiple; we need Mac-reachable, usually 192.168.64.x)
  COLIMA_IP=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}' 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | head -1 || true)
  # If node IP is in 192.168.5.x the host may not have a route; try colima ssh to get the host-reachable interface (col0 = 192.168.64.x)
  if [[ "$COLIMA_IP" == 192.168.5.* ]] && command -v colima &>/dev/null; then
    COLIMA_IP=$(colima ssh -- ip -4 addr show col0 2>/dev/null | awk '/inet /{print $2; exit}' | cut -d/ -f1 || true)
    [[ -z "$COLIMA_IP" ]] && COLIMA_IP=$(colima ssh -- ip -4 -o addr show 2>/dev/null | grep -E 'col0|192\.168\.64' | head -1 | awk '{print $4}' | cut -d/ -f1 || true)
  fi
fi
if [[ -z "$COLIMA_IP" ]] && command -v colima &>/dev/null; then
  _src_awk='/(^| )src /{for(i=1;i<NF;i++) if($i=="src") {print $(i+1); exit}}'
  # Prefer col0 (192.168.64.x) so Mac can reach it; eth0 (192.168.5.x) is often not routable from Mac
  COLIMA_IP=$(colima ssh -- ip -4 addr show col0 2>/dev/null | awk '/inet /{print $2; exit}' | cut -d/ -f1 || true)
  [[ -z "$COLIMA_IP" ]] && COLIMA_IP=$(colima ssh -- ip route get 1.1.1.1 2>/dev/null | awk "$_src_awk" || true)
  [[ -z "$COLIMA_IP" ]] && COLIMA_IP=$(colima ssh -- ip -4 addr show eth0 2>/dev/null | awk '/inet /{print $2; exit}' | cut -d/ -f1 || true)
fi
if [[ -z "$COLIMA_IP" ]]; then
  warn "Colima VM IP not found. Start Colima and re-run, or set COLIMA_IP_OVERRIDE."
  exit 1
fi

PID_DIR="${TMPDIR:-/tmp}"
SAFE_LB="127_0_0_1"
TCP_PID_FILE="$PID_DIR/lb-ip-no-sudo-tcp-${HOST_HTTPS_PORT}.pid"
UDP_PID_FILE="$PID_DIR/lb-ip-no-sudo-udp-${HOST_HTTPS_PORT}.pid"

# Kill existing holders of our port
for proto in UDP TCP; do
  PIDS=$(lsof -t -i "${proto}:${HOST_HTTPS_PORT}" 2>/dev/null || true)
  if [[ -n "$PIDS" ]]; then
    info "Killing existing $proto $HOST_HTTPS_PORT: $PIDS"
    echo "$PIDS" | xargs kill -9 2>/dev/null || true
  fi
done
sleep 1

say "Starting host forward 127.0.0.1:$HOST_HTTPS_PORT → $COLIMA_IP:$NODEPORT (no sudo)"
if ! command -v socat &>/dev/null; then
  warn "socat not found. Install: brew install socat"
  exit 1
fi

# TCP
nohup socat TCP-LISTEN:"$HOST_HTTPS_PORT",reuseaddr,fork,bind=127.0.0.1 TCP:"$COLIMA_IP:$NODEPORT" >>/dev/null 2>&1 &
echo $! > "$TCP_PID_FILE"
disown 2>/dev/null || true
sleep 0.3
# UDP (fork for QUIC)
nohup socat UDP-LISTEN:"$HOST_HTTPS_PORT",reuseaddr,fork,bind=127.0.0.1 UDP:"$COLIMA_IP:$NODEPORT" >>/dev/null 2>&1 &
echo $! > "$UDP_PID_FILE"
disown 2>/dev/null || true
sleep 0.5

if kill -0 "$(cat "$TCP_PID_FILE" 2>/dev/null)" 2>/dev/null && kill -0 "$(cat "$UDP_PID_FILE" 2>/dev/null)" 2>/dev/null; then
  ok "TCP and UDP $HOST_HTTPS_PORT → VM:$NODEPORT running"
else
  warn "One of TCP/UDP forwarders failed; check $TCP_PID_FILE and $UDP_PID_FILE"
fi

# Optional Docker bridge
if [[ "$START_DOCKER_BRIDGE" == "1" ]]; then
  for proto in UDP TCP; do
    PIDS=$(lsof -t -i "${proto}:$DOCKER_BRIDGE_PORT" 2>/dev/null || true)
    [[ -n "$PIDS" ]] && echo "$PIDS" | xargs kill -9 2>/dev/null || true
  done
  sleep 0.5
  nohup socat TCP-LISTEN:"$DOCKER_BRIDGE_PORT",reuseaddr,fork TCP:"$COLIMA_IP:$NODEPORT" >>/dev/null 2>&1 &
  nohup socat UDP-LISTEN:"$DOCKER_BRIDGE_PORT",reuseaddr,fork UDP:"$COLIMA_IP:$NODEPORT" >>/dev/null 2>&1 &
  disown 2>/dev/null || true
  ok "Docker bridge 0.0.0.0:$DOCKER_BRIDGE_PORT → VM:$NODEPORT"
fi

# Env for verify and suites: use 127.0.0.1:HOST_HTTPS_PORT as "host reachable" path
METALLB_ENV="${METALLB_REACHABLE_ENV:-/tmp/metallb-reachable.env}"
echo "REACHABLE_LB_IP=127.0.0.1" > "$METALLB_ENV"
echo "HOST_HTTPS_HOST=127.0.0.1" >> "$METALLB_ENV"
echo "HOST_HTTPS_PORT=$HOST_HTTPS_PORT" >> "$METALLB_ENV"
echo "USE_LB_FOR_TESTS=1" >> "$METALLB_ENV"
echo "NODEPORT=$NODEPORT" >> "$METALLB_ENV"
echo "COLIMA_IP=$COLIMA_IP" >> "$METALLB_ENV"
[[ -n "$LB_IP" ]] && echo "LB_IP=$LB_IP" >> "$METALLB_ENV"
info "Wrote $METALLB_ENV (host curl: 127.0.0.1:$HOST_HTTPS_PORT with --resolve record.local:$HOST_HTTPS_PORT:127.0.0.1)"

# Quick verify
CURL_HTTP3="/opt/homebrew/opt/curl/bin/curl"
[[ -x "$CURL_HTTP3" ]] || CURL_HTTP3="$(command -v curl 2>/dev/null)"
say "Quick verify"
_resolve="record.local:${HOST_HTTPS_PORT}:127.0.0.1"
_url="https://record.local:${HOST_HTTPS_PORT}/_caddy/healthz"
sleep 1
H2=$(curl -k -sS -o /dev/null -w '%{http_code}' --connect-timeout 5 --http2 --resolve "$_resolve" "$_url" 2>/dev/null || echo "000")
if [[ "$H2" == "200" ]]; then
  ok "HTTP/2 via 127.0.0.1:$HOST_HTTPS_PORT: $H2"
else
  warn "HTTP/2: $H2"
fi
if [[ -n "$CURL_HTTP3" ]] && "$CURL_HTTP3" --help all 2>/dev/null | grep -q -- "--http3"; then
  H3=$(NGTCP2_ENABLE_GSO=0 "$CURL_HTTP3" --http3-only -k -sS -o /dev/null -w '%{http_code}' --connect-timeout 5 --resolve "$_resolve" "$_url" 2>/dev/null || echo "000")
  if [[ "$H3" == "200" ]]; then
    ok "HTTP/3 via 127.0.0.1:$HOST_HTTPS_PORT: $H3"
  else
    warn "HTTP/3: $H3"
  fi
else
  info "HTTP/3: install Homebrew curl (brew install curl) to test"
fi
echo ""
info "Manual test: curl -k --http2 -sS -o /dev/null -w '%{http_code}' --resolve record.local:$HOST_HTTPS_PORT:127.0.0.1 https://record.local:$HOST_HTTPS_PORT/_caddy/healthz"
info "HTTP/3: NGTCP2_ENABLE_GSO=0 $CURL_HTTP3 --http3-only -k -sS -o /dev/null -w '%{http_code}' --resolve record.local:$HOST_HTTPS_PORT:127.0.0.1 https://record.local:$HOST_HTTPS_PORT/_caddy/healthz"
