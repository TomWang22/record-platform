#!/usr/bin/env bash
# Create k3d cluster with 443/tcp and 443/udp on loadbalancer only. No NodePort dependency for QUIC.
# Use with: curl --resolve record.local:443:127.0.0.1 https://record.local/
# Usage: ./scripts/k3d-http3-clean-bootstrap.sh

set -euo pipefail

CLUSTER_NAME="${CLUSTER_NAME:-record-platform}"

echo "🔥 Deleting old cluster (if any)..."
k3d cluster delete "$CLUSTER_NAME" 2>/dev/null || true

echo "🔥 Creating clean cluster (HTTP/3-safe: 443 tcp+udp @ loadbalancer, no NodePort for QUIC)..."
k3d cluster create "$CLUSTER_NAME" \
  --servers 1 \
  --agents 1 \
  --port "6443:6443@server:0" \
  --k3s-arg "--disable=traefik@server:*" \
  --port "443:443@loadbalancer" \
  --port "443:443/udp@loadbalancer"

echo "⏳ Waiting for nodes..."
kubectl wait --for=condition=Ready nodes --all --timeout=120s

echo "✅ Cluster ready. Next: deploy base, apply Caddy, then ./scripts/http3-contract-validator.sh"
