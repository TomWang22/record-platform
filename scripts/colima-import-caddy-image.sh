#!/usr/bin/env bash
# Ensure caddy-with-tcpdump:dev is available to Colima k3s and optionally restart Caddy.
# Run from repo root after: docker build -t caddy-with-tcpdump:dev docker/caddy-with-tcpdump
# Colima with docker+k3s: image is in the same Docker k3s uses, so no import needed — just restart Caddy.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ctx=$(kubectl config current-context 2>/dev/null || true)
if [[ "$ctx" != *"colima"* ]]; then
  echo "Current context '$ctx' is not Colima; this script is for Colima. For k3d use: k3d image import caddy-with-tcpdump:dev -c record-platform"
  exit 1
fi

if ! colima ssh -- docker images -q caddy-with-tcpdump:dev 2>/dev/null | grep -q .; then
  echo "Image caddy-with-tcpdump:dev not found in Colima. Build it first:"
  echo "  docker build -t caddy-with-tcpdump:dev docker/caddy-with-tcpdump"
  exit 1
fi
echo "Image caddy-with-tcpdump:dev is present in Colima Docker (k3s uses same daemon)."
echo "Restarting Caddy..."
kubectl -n ingress-nginx rollout restart deployment/caddy-h3
kubectl -n ingress-nginx rollout status deployment/caddy-h3 --timeout=120s
echo "Done. Caddy pods now use caddy-with-tcpdump:dev (tcpdump available for capture)."
