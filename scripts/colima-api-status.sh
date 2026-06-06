#!/usr/bin/env bash
# Quick observability: what is running and what is not (Colima + k3s, port 6443).
# Run when stuck to see tunnel, host API, in-VM API, and pod summary in one place.
#
# Usage: ./scripts/colima-api-status.sh [port]

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PORT="${1:-6443}"
API_CLASS=""

ok()   { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
info() { echo "ℹ️  $*"; }
say()  { printf "\n\033[1m%s\033[0m\n" "$*"; }

say "Colima + API status (port $PORT)"
echo ""

# 1. Colima
if command -v colima >/dev/null 2>&1; then
  info "Colima:"
  colima status 2>&1 | sed 's/^/  /' || true
  colima list 2>/dev/null | sed 's/^/  /' || true
else
  warn "colima not in PATH"
fi
echo ""

# 2. Tunnel (who is listening on 6443)
info "Port $PORT (tunnel/listener):"
if lsof -i ":$PORT" 2>/dev/null | head -5 | sed 's/^/  /'; then
  :
else
  warn "Nothing listening on $PORT (tunnel down?)"
fi
(nc -zv 127.0.0.1 "$PORT" 2>&1 | sed 's/^/  /') || true
echo ""

# 3. Host API (capture stderr to classify 503 vs reset vs timeout)
info "Host API (kubectl get nodes):"
_host_err=$(mktemp 2>/dev/null || echo "/tmp/colima-status-host-$$.err")
if kubectl get nodes --request-timeout=8s 2>"$_host_err"; then
  ok "Host: OK"
  API_CLASS="ok"
else
  _err_text=$(cat "$_host_err" 2>/dev/null)
  if echo "$_err_text" | grep -qi "ServiceUnavailable\|503\|unable to handle the request"; then
    echo "  📌 API server returned 503 ServiceUnavailable (overloaded or still starting) — not a tunnel issue."
    API_CLASS="503"
  elif echo "$_err_text" | grep -qi "connection reset\|ECONNRESET\|refused"; then
    echo "  📌 Connection reset/refused — tunnel or API closed connection."
    API_CLASS="reset"
  else
    warn "Host: FAIL (tunnel or kubeconfig)"
    API_CLASS="fail"
  fi
  [[ -n "$_err_text" ]] && echo "$_err_text" | head -3 | sed 's/^/  /'
fi
rm -f "$_host_err"
echo ""

# 4. In-VM API (why reissue step 2 might fall back to host)
info "In-VM API (colima ssh + KUBECONFIG=/etc/rancher/k3s/k3s.yaml):"
_vm_out=$(mktemp 2>/dev/null || echo "/tmp/colima-status-vm-$$.out")
_vm_err=$(mktemp 2>/dev/null || echo "/tmp/colima-status-vm-$$.err")
if command -v colima >/dev/null 2>&1 && colima ssh -- env KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl get nodes --request-timeout=8s >"$_vm_out" 2>"$_vm_err"; then
  ok "In-VM: OK (reissue step 2 can use this)"
  cat "$_vm_out" | sed 's/^/  /'
else
  warn "In-VM: FAIL"
  _vm_err_text=$(cat "$_vm_err" 2>/dev/null)
  if echo "$_vm_err_text" | grep -qi "ServiceUnavailable\|503\|unable to handle the request"; then
    echo "  📌 In-VM also 503 — API server inside VM is overloaded or starting (same as host path)."
    API_CLASS="503"
  fi
  echo "  Detail:"
  (colima ssh -- sh -c 'test -r /etc/rancher/k3s/k3s.yaml 2>/dev/null && echo "    k3s.yaml: readable" || echo "    k3s.yaml: not readable"; which kubectl 2>/dev/null || echo "    kubectl: not in PATH"; env KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl get nodes 2>&1' 2>&1) | sed 's/^/  /' || true
fi
rm -f "$_vm_out" "$_vm_err"
echo ""

# 5. k3s in VM (when API fails — activating vs active, restarts, recent logs)
if [[ "${API_CLASS:-}" == "503" ]] || [[ "${API_CLASS:-}" == "fail" ]]; then
  say "k3s in VM (API overloaded or down)"
  _k3s_info=$(colima ssh -- sh -c '
    echo "  State: $(sudo systemctl is-active k3s 2>/dev/null | head -1 || echo unknown)"
    echo "  Restarts: $(sudo systemctl show k3s -p NRestarts --value 2>/dev/null | tr -d "\n" || echo ?)"
    echo "  journal (last 12):"
    sudo journalctl -u k3s --no-pager -n 12 2>/dev/null | sed "s/^/    /"
  ' 2>&1) || true
  echo "$_k3s_info" | head -25
  if echo "$_k3s_info" | grep -q "activating"; then
    echo "  📌 k3s is still activating (Docker CRI + API can take 1–2 min). Run: $REPO_ROOT/scripts/wait-for-k3s-ready.sh"
  fi
  if echo "$_k3s_info" | grep -qE "Restarts: [0-9]{2,}"; then
    echo "  📌 High restart count — k3s may be in a restart loop. Try: colima ssh -- sudo systemctl restart k3s  then wait or run wait-for-k3s-ready.sh"
  fi
  echo ""
fi

# 6. Pod summary (re-check API — it may have come up while we were running)
info "Pods (if API up):"
_api_ok_now=0
if kubectl get nodes --request-timeout=5s >/dev/null 2>&1; then
  _api_ok_now=1
  if [[ "${API_CLASS:-}" == "503" ]] || [[ "${API_CLASS:-}" == "fail" ]]; then
    echo "  (API was 503/unreachable earlier; recheck passed now — k3s likely finished activating.)"
  fi
  echo "  record-platform:"
  kubectl get pods -n record-platform --no-headers 2>/dev/null | awk '{print "    " $1 " " $2}' | head -20
  echo "  ingress-nginx:"
  kubectl get pods -n ingress-nginx --no-headers 2>/dev/null | awk '{print "    " $1 " " $2}' | head -5
else
  echo "  (skip — API not reachable)"
fi
echo ""

say "Quick actions"
if [[ "${API_CLASS:-}" == "503" ]] && [[ "${_api_ok_now:-0}" != "1" ]]; then
  echo "  API server 503 (overloaded/starting):"
  echo "    1. Wait for k3s (poll until ready): $REPO_ROOT/scripts/wait-for-k3s-ready.sh"
  echo "    2. Or wait 30–60s and re-run this script or preflight."
  echo "    3. Restart k3s in VM: colima ssh -- sudo systemctl restart k3s   # then wait ~60s"
  echo "    4. Full teardown + tunnel: $REPO_ROOT/scripts/colima-teardown-and-start.sh"
elif [[ "${API_CLASS:-}" == "503" ]] && [[ "${_api_ok_now:-0}" == "1" ]]; then
  echo "  API came up during this run — you can proceed with preflight."
fi
echo "  Re-establish tunnel: $REPO_ROOT/scripts/colima-forward-6443.sh"
echo "  Full diagnostic:     DEEP=1 DIAG_GATHER=1 $SCRIPT_DIR/diagnose-reset-by-peer.sh $PORT"
echo "  Runbook:             Runbook.md item 32, CONNECTION-RESET-PLAYBOOK.md"
