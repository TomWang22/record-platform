#!/usr/bin/env bash
# Patch app-config so pods can reach host (Redis, Postgres) on k3d.
# In k3d, host.docker.internal does not resolve from pods; host.k3d.internal does.
# Usage: ./scripts/patch-k3d-host-app-config.sh
set -euo pipefail

ctx=$(kubectl config current-context 2>/dev/null || true)
if [[ "$ctx" != *"k3d"* ]]; then
  echo "Current context is not k3d ($ctx). This script is for k3d only."
  exit 1
fi

echo "Patching app-config: host.docker.internal -> host.k3d.internal"
kubectl -n record-platform get configmap app-config -o yaml | sed 's/host\.docker\.internal/host.k3d.internal/g' | kubectl apply -f -
echo "Done. Restart app deployments to pick up config: kubectl -n record-platform rollout restart deploy/auth-service deploy/records-service ..."
