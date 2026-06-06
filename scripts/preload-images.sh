#!/usr/bin/env bash
# Pull and import images into k3d so cluster does not depend on registry after Docker restart.
# Prevents ImagePullBackOff. Run after cluster creation.
# Usage: ./scripts/preload-images.sh

set -euo pipefail

CLUSTER="${CLUSTER_NAME:-record-platform}"
# Match Caddy version in infra/k8s/caddy-h3-deploy.yaml
CADDY_IMAGE="${CADDY_IMAGE:-caddy:2.8}"

echo "📦 Pulling image..."
docker pull "$CADDY_IMAGE"

echo "📦 Importing into k3d..."
k3d image import "$CADDY_IMAGE" -c "$CLUSTER"

echo "✅ Image preloaded into cluster. Use imagePullPolicy: IfNotPresent in deploy."
