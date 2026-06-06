#!/usr/bin/env bash
# Stop the LB IP forwarders (TCP/UDP socat) and free UDP 443. Prints what was stopped so you see success.
#
# Usage:
#   LB_IP=192.168.106.241 ./scripts/stop-lb-ip-host-access.sh
#   # Or auto-detect from cluster:
#   ./scripts/stop-lb-ip-host-access.sh
#   # Stop ALL forwarders (every LB IP: 240, 241, etc.) and remove all MetalLB aliases:
#   STOP_ALL_LB_IP=1 ./scripts/stop-lb-ip-host-access.sh
#
# Optional: REMOVE_ALIAS=1 to also remove the loopback alias (so the LB IP is no longer on lo0).
# With STOP_ALL_LB_IP=1, REMOVE_ALIAS=1 removes 192.168.106.240 and 192.168.106.241.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_DIR="/tmp"
_stopped=0

# STOP_ALL_LB_IP=1: kill every forwarder (all LB IPs), then free 443, then optionally remove all MetalLB aliases
if [[ "${STOP_ALL_LB_IP:-0}" == "1" ]]; then
  echo "Stopping ALL LB IP forwarders and Docker bridge..."
  for _pf in "$PID_DIR"/lb-ip-forward-*-tcp.pid "$PID_DIR"/lb-ip-forward-*-udp.pid "$PID_DIR"/lb-ip-docker-bridge-*-tcp.pid "$PID_DIR"/lb-ip-docker-bridge-*-udp.pid "$PID_DIR"/lb-ip-caddy-pf-*.pid; do
    [[ ! -f "$_pf" ]] && continue
    _pid=$(cat "$_pf" 2>/dev/null || true)
    [[ -z "$_pid" ]] && rm -f "$_pf" 2>/dev/null && continue
    if ps -p "$_pid" -o pid= 2>/dev/null | grep -q .; then
      sudo kill "$_pid" 2>/dev/null || kill "$_pid" 2>/dev/null || true
      sleep 0.3
      sudo kill -9 "$_pid" 2>/dev/null || kill -9 "$_pid" 2>/dev/null || true
      echo "✅ Stopped $(basename "$_pf") (PID $_pid)"
      _stopped=1
    fi
    rm -f "$_pf" 2>/dev/null || true
  done
  _udp_pids=$(sudo lsof -t -i UDP:443 2>/dev/null || true)
  [[ -n "$_udp_pids" ]] && echo "$_udp_pids" | xargs sudo kill -9 2>/dev/null && echo "✅ Freed UDP 443" && _stopped=1
  if [[ "${REMOVE_ALIAS:-0}" == "1" ]] && [[ "$(uname -s)" == "Darwin" ]]; then
    for _ip in 192.168.106.240 192.168.106.241; do
      ifconfig lo0 2>/dev/null | grep -q "inet $_ip " && sudo ifconfig lo0 -alias "$_ip" 2>/dev/null && echo "✅ Removed alias $_ip" && _stopped=1 || true
    done
  fi
  [[ $_stopped -eq 1 ]] && echo "✅ Done (all LB IP forwarders stopped)." || echo "ℹ️  No forwarders were running."
  exit 0
fi

# Resolve LB_IP (same as setup script)
if [[ -z "${LB_IP:-}" ]]; then
  ctx=$(kubectl config current-context 2>/dev/null || echo "")
  if [[ "$ctx" == *"k3d"* ]]; then
    NS_ING="${NS_ING:-ingress-nginx}"
    LB_IP=$(kubectl -n "$NS_ING" get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
    [[ -z "$LB_IP" ]] && LB_IP=$(kubectl get svc -A -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}' 2>/dev/null | head -1 || echo "")
  fi
fi

if [[ -z "${LB_IP:-}" ]]; then
  echo "⚠️  LB_IP not set. Use: LB_IP=192.168.106.241 $SCRIPT_DIR/stop-lb-ip-host-access.sh  or  STOP_ALL_LB_IP=1 $SCRIPT_DIR/stop-lb-ip-host-access.sh"
  exit 1
fi

SAFE_LB=$(echo "$LB_IP" | tr '.' '_')
TCP_PID_FILE="$PID_DIR/lb-ip-forward-${SAFE_LB}-tcp.pid"
UDP_PID_FILE="$PID_DIR/lb-ip-forward-${SAFE_LB}-udp.pid"
CADDY_PF_PID_FILE="$PID_DIR/lb-ip-caddy-pf-${SAFE_LB}.pid"
DOCKER_TCP_PID_FILE="$PID_DIR/lb-ip-docker-bridge-${SAFE_LB}-tcp.pid"
DOCKER_UDP_PID_FILE="$PID_DIR/lb-ip-docker-bridge-${SAFE_LB}-udp.pid"

# 0. Kill Caddy port-forward if used (CADDY_DIRECT=1)
if [[ -f "$CADDY_PF_PID_FILE" ]]; then
  _pid=$(cat "$CADDY_PF_PID_FILE" 2>/dev/null || true)
  if [[ -n "$_pid" ]] && ps -p "$_pid" -o pid= 2>/dev/null | grep -q .; then
    kill "$_pid" 2>/dev/null || kill -9 "$_pid" 2>/dev/null || true
    echo "✅ Stopped Caddy port-forward (PID $_pid)"
    _stopped=1
  fi
  rm -f "$CADDY_PF_PID_FILE" 2>/dev/null || true
fi

# 1. Kill forwarder loop processes (from pid files). Use ps -p to detect (kill -0 fails for root's PIDs when not root).
for _label in "TCP:$TCP_PID_FILE" "UDP:$UDP_PID_FILE"; do
  _name="${_label%%:*}"
  _file="${_label#*:}"
  _pid=$(cat "$_file" 2>/dev/null || true)
  if [[ -n "$_pid" ]] && ps -p "$_pid" -o pid= 2>/dev/null | grep -q .; then
    sudo kill "$_pid" 2>/dev/null || sudo kill -9 "$_pid" 2>/dev/null || true
    echo "✅ Stopped $_name forwarder (PID $_pid)"
    _stopped=1
  fi
  rm -f "$_file" 2>/dev/null || true
done

# 1b. Kill Docker bridge forwarders (0.0.0.0:DOCKER_FORWARD_PORT) if running
for _label in "Docker TCP:$DOCKER_TCP_PID_FILE" "Docker UDP:$DOCKER_UDP_PID_FILE"; do
  _name="${_label%%:*}"
  _file="${_label#*:}"
  _pid=$(cat "$_file" 2>/dev/null || true)
  if [[ -n "$_pid" ]] && ps -p "$_pid" -o pid= 2>/dev/null | grep -q .; then
    kill "$_pid" 2>/dev/null || kill -9 "$_pid" 2>/dev/null || true
    echo "✅ Stopped $_name (PID $_pid)"
    _stopped=1
  fi
  rm -f "$_file" 2>/dev/null || true
done

# 2. Free UDP 443 (any process still on it, e.g. orphaned socat)
_udp_pids=$(sudo lsof -t -i UDP:443 2>/dev/null || true)
if [[ -n "$_udp_pids" ]]; then
  for _p in $_udp_pids; do
    sudo kill -9 "$_p" 2>/dev/null || true
    echo "✅ Freed UDP 443 (killed PID $_p)"
    _stopped=1
  done
fi

if [[ "$_stopped" -eq 0 ]]; then
  echo "ℹ️  No forwarder or UDP 443 process was running."
else
  echo "✅ Done. To start again: sudo LB_IP=$LB_IP NODEPORT=30443 $SCRIPT_DIR/setup-lb-ip-host-access.sh"
fi

# 3. Optionally remove loopback alias
if [[ "${REMOVE_ALIAS:-0}" == "1" ]] && [[ "$(uname -s)" == "Darwin" ]]; then
  if ifconfig lo0 2>/dev/null | grep -q "inet $LB_IP "; then
    sudo ifconfig lo0 -alias "$LB_IP" 2>/dev/null && echo "✅ Removed loopback alias $LB_IP" || echo "⚠️  Could not remove alias (sudo ifconfig lo0 -alias $LB_IP)"
  fi
fi
