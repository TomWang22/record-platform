#!/usr/bin/env bash
# One-shot: start Colima with --network-address (bridged), wait for k3s, install MetalLB, bring up cluster.
# So you don't keep fixing "Docker not running" / Colima stopped; one repeatable path for MetalLB + namespaces.
#
# Usage: ./scripts/start-colima-metallb-and-bring-up.sh
#   METALLB_POOL=192.168.5.240-192.168.5.250 ./scripts/start-colima-metallb-and-bring-up.sh
#   COLIMABRIDGED_MINIMAL=1  for smaller VM (4 CPU, 8 GiB, 60 GiB disk)
#
# After this: Docker works (Colima is running), k3s + MetalLB + namespaces are up.
# Then start external Postgres/Redis/Kafka and restore DBs if needed:
#   docker compose up -d postgres postgres-social postgres-listings postgres-shopping postgres-auth postgres-auction-monitor postgres-analytics postgres-python-ai redis zookeeper kafka
#   ./scripts/restore-all-databases-from-dumps.sh ./backup 20260101-223214
#
# See docs/COLIMA-K3S-METALLB-PRIMARY.md and docs/BACKUPS_AND_TUNING.md.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

echo "=== 1. Colima + k3s (bridged, --network-address) ==="
if colima status 2>/dev/null | grep -qi running; then
  echo "Colima already running. Fixing kubeconfig and checking API..."
  [[ -x "$SCRIPT_DIR/colima-refresh-kubeconfig.sh" ]] && "$SCRIPT_DIR/colima-refresh-kubeconfig.sh" 2>/dev/null || true
  [[ -x "$SCRIPT_DIR/colima-fix-kubeconfig-localhost.sh" ]] && "$SCRIPT_DIR/colima-fix-kubeconfig-localhost.sh" 2>/dev/null || true
  if kubectl get nodes --request-timeout=10s &>/dev/null; then
    echo "API OK. Skipping Colima start; going to MetalLB + bring-up."
  else
    echo "Colima running but API not reachable. Starting SSH tunnel (host:6443 -> VM:k3s)..."
    [[ -x "$SCRIPT_DIR/colima-ensure-api-tunnel.sh" ]] && "$SCRIPT_DIR/colima-ensure-api-tunnel.sh" || true
    if ! kubectl get nodes --request-timeout=10s &>/dev/null; then
      echo "Run: ./scripts/colima-ensure-api-tunnel.sh   then retry."
      exit 1
    fi
  fi
else
  "$SCRIPT_DIR/colima-start-k3s-bridged-clean.sh"
  # Bridged mode: API is only inside VM; host needs SSH tunnel to 6443.
  if ! kubectl get nodes --request-timeout=5s &>/dev/null; then
    [[ -x "$SCRIPT_DIR/colima-ensure-api-tunnel.sh" ]] && "$SCRIPT_DIR/colima-ensure-api-tunnel.sh" || true
  fi
fi

echo ""
echo "=== 2. MetalLB + bring-up (namespaces, Caddy LB) ==="
METALLB_POOL="${METALLB_POOL:-192.168.5.240-192.168.5.250}" "$SCRIPT_DIR/colima-metallb-bring-up.sh"

echo ""
echo "=== Done ==="
echo "Docker: docker ps"
echo "k3s:    kubectl get nodes"
echo "Caddy:  kubectl -n ingress-nginx get svc caddy-h3"
echo ""
echo "External Postgres (8) + Redis + Kafka (then restore DBs):"
echo "  docker compose up -d postgres postgres-social postgres-listings postgres-shopping postgres-auth postgres-auction-monitor postgres-analytics postgres-python-ai redis zookeeper kafka"
echo "  ./scripts/restore-all-databases-from-dumps.sh ./backup 20260101-223214"
