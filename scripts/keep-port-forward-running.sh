#!/usr/bin/env bash
# Helper script to keep port-forward running
# This will restart port-forward if it dies

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }

export KUBECONFIG="${KUBECONFIG:-$HOME/.kube/kind-h3.yaml}"

say "Keeping port-forward running for webapp..."
say "Press Ctrl+C to stop"

while true; do
  if ! curl -s http://localhost:3001/api/health >/dev/null 2>&1; then
    say "Port-forward not working, restarting..."
    pkill -f "port-forward.*webapp" 2>/dev/null
    kubectl port-forward -n default svc/webapp 3001:3001 > /tmp/webapp-portforward.log 2>&1 &
    sleep 3
    if curl -s http://localhost:3001/api/health >/dev/null 2>&1; then
      ok "Port-forward restarted"
    else
      say "Port-forward failed to start. Check logs: /tmp/webapp-portforward.log"
    fi
  fi
  sleep 10
done

