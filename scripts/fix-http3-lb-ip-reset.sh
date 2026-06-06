#!/usr/bin/env bash
# Reset HTTP/3 LB IP path: kill all processes holding TCP 443 and UDP 443, re-add loopback alias, optionally start forwarders.
# Usage: sudo LB_IP=192.168.106.241 NODEPORT=30443 ./scripts/fix-http3-lb-ip-reset.sh
# Optional: REMOVE_ALIAS=1 to remove alias only; RUN_SETUP=1 to run setup-lb-ip-host-access.sh after reset (default 1).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LB_IP="${LB_IP:-}"
NODEPORT="${NODEPORT:-30443}"
REMOVE_ALIAS="${REMOVE_ALIAS:-0}"
RUN_SETUP="${RUN_SETUP:-1}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

if [[ -z "$LB_IP" ]] && command -v kubectl >/dev/null 2>&1; then
  LB_IP=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)
fi
if [[ -z "$LB_IP" ]]; then
  echo "❌ Set LB_IP (e.g. from kubectl -n ingress-nginx get svc caddy-h3)."
  exit 1
fi

# Re-exec with sudo so we can kill holders and run ifconfig/socat (no need for user to type sudo)
if [[ $(id -u) -ne 0 ]] && command -v sudo >/dev/null 2>&1; then
  exec sudo -E LB_IP="$LB_IP" NODEPORT="$NODEPORT" REMOVE_ALIAS="$REMOVE_ALIAS" RUN_SETUP="$RUN_SETUP" "$0"
fi

say "Reset LB IP path (LB_IP=$LB_IP, NODEPORT=$NODEPORT)"

# Kill PID files from previous setup
PID_DIR="${TMPDIR:-/tmp}"
SAFE_LB=$(echo "$LB_IP" | tr '.' '_')
for f in "$PID_DIR/lb-ip-socat-tcp-${SAFE_LB}.pid" "$PID_DIR/lb-ip-socat-udp-${SAFE_LB}.pid" \
         "$PID_DIR/lb-ip-docker-bridge-${SAFE_LB}.pid.tcp" "$PID_DIR/lb-ip-docker-bridge-${SAFE_LB}.pid.udp"; do
  if [[ -f "$f" ]]; then
    pid=$(cat "$f" 2>/dev/null || true)
    [[ -n "$pid" ]] && kill -9 "$pid" 2>/dev/null || true
    rm -f "$f"
  fi
done

# Kill anything holding TCP 443 or UDP 443
for port in 443; do
  for proto in UDP TCP; do
    PIDS=$(lsof -t -i ${proto}:${port} 2>/dev/null || true)
    if [[ -n "$PIDS" ]]; then
      say "Killing ${proto} ${port} holders: $PIDS"
      echo "$PIDS" | xargs sudo kill -9 2>/dev/null || true
      sleep 1
    fi
  done
done

# Kill Docker bridge port 18443 if used
for port in 18443; do
  PIDS=$(lsof -t -i TCP:"$port" 2>/dev/null || true)
  [[ -n "$PIDS" ]] && echo "$PIDS" | xargs sudo kill -9 2>/dev/null || true
  PIDS=$(lsof -t -i UDP:"$port" 2>/dev/null || true)
  [[ -n "$PIDS" ]] && echo "$PIDS" | xargs sudo kill -9 2>/dev/null || true
done
sleep 1

if [[ "$REMOVE_ALIAS" == "1" ]]; then
  sudo ifconfig lo0 -alias "$LB_IP" 2>/dev/null || true
  ok "Removed alias $LB_IP"
fi

# Re-add alias
sudo ifconfig lo0 -alias "$LB_IP" 2>/dev/null || true
sleep 1
sudo ifconfig lo0 alias "$LB_IP"
ok "Alias $LB_IP re-added"

if [[ "$RUN_SETUP" == "1" ]] && [[ -f "$SCRIPT_DIR/setup-lb-ip-host-access.sh" ]]; then
  say "Running setup-lb-ip-host-access.sh..."
  sudo LB_IP="$LB_IP" NODEPORT="$NODEPORT" "$SCRIPT_DIR/setup-lb-ip-host-access.sh"
else
  ok "Reset complete. Run: sudo LB_IP=$LB_IP NODEPORT=$NODEPORT $SCRIPT_DIR/setup-lb-ip-host-access.sh"
fi
