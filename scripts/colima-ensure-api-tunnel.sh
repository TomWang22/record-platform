#!/usr/bin/env bash
# With Colima --network-address (bridged), the API is only inside the VM on 127.0.0.1:PORT.
# This script starts an SSH tunnel (host:6443 -> VM:PORT) and sets kubeconfig to 127.0.0.1:6443.
# Run when: Colima is running but kubectl get nodes fails with "connection refused".
#
# Usage: ./scripts/colima-ensure-api-tunnel.sh
set -euo pipefail

if ! colima status 2>/dev/null | grep -qi running; then
  echo "Colima is not running. Start it first (e.g. ./scripts/colima-start-k3s-bridged-clean.sh)." >&2
  exit 1
fi

if kubectl get nodes --request-timeout=5s &>/dev/null; then
  echo "API already reachable."
  exit 0
fi

# Get k3s API port from inside the VM
K3S_SERVER=$(colima ssh -- cat /etc/rancher/k3s/k3s.yaml 2>/dev/null | grep -E '^\s+server:' | sed -E 's/.*https:\/\/127.0.0.1:([0-9]+).*/\1/')
if [[ -z "$K3S_SERVER" ]]; then
  echo "Could not read k3s API port from VM." >&2
  exit 1
fi

# Kill any existing tunnel to 6443
pkill -f "ssh.*-L 6443:127.0.0.1:$K3S_SERVER" 2>/dev/null || true
sleep 1

echo "Starting tunnel: host:6443 -> VM:127.0.0.1:$K3S_SERVER"
ssh -f -N -L 6443:127.0.0.1:"$K3S_SERVER" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null colima 2>/dev/null || {
  echo "SSH tunnel failed. Try: ssh -L 6443:127.0.0.1:$K3S_SERVER colima -N   (in another terminal)" >&2
  exit 1
}

sleep 2
cluster=$(kubectl config view --minify -o jsonpath='{.contexts[0].context.cluster}' 2>/dev/null || echo "colima")
kubectl config set-cluster "$cluster" --server=https://127.0.0.1:6443

if kubectl get nodes --request-timeout=10s &>/dev/null; then
  echo "API reachable at https://127.0.0.1:6443"
else
  echo "Tunnel up but kubectl still failed. Check: nc -z 127.0.0.1 6443" >&2
  exit 1
fi
