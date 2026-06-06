#!/usr/bin/env bash
# Restore k3d to known-good state for QUIC: delete cluster, recreate with UDP 30443 published.
# No drama. Deterministic recovery. After this: deploy base, apply production Caddyfile, run check-quic-invariants.sh.
#
# Target state: k3d 2-node, UDP 30443 published, Caddy record.local (no on_demand), HTTP/2 + HTTP/3 working,
# all tests use --resolve record.local:443:<ip> and https://record.local.
#
# Usage: ./scripts/restore-k3d-quic-known-good.sh
#   CLUSTER_NAME=record-platform  (default)
#   K3D_AGENTS=1                  (default)

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

CLUSTER_NAME="${CLUSTER_NAME:-record-platform}"
K3D_AGENTS="${K3D_AGENTS:-1}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
info(){ echo "📋 $*"; }

if ! command -v k3d >/dev/null 2>&1; then
  warn "k3d not found. Install: brew install k3d"
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  warn "Docker not reachable. Start Docker and re-run."
  exit 1
fi

# --- Step 1: Hard reset — delete cluster ---
say "Step 1 — Hard reset: delete cluster $CLUSTER_NAME"
if k3d cluster list 2>/dev/null | grep -q "^$CLUSTER_NAME "; then
  k3d cluster delete "$CLUSTER_NAME"
  ok "Cluster deleted"
else
  info "Cluster $CLUSTER_NAME does not exist; skipping delete"
fi

# --- Step 2: Recreate with 6443 and 30443 (tcp + udp) ---
say "Step 2 — Recreate cluster: 1 server + $K3D_AGENTS agent(s), 30443 tcp+udp published"
k3d cluster create "$CLUSTER_NAME" \
  --servers 1 \
  --agents "$K3D_AGENTS" \
  --port 6443:6443@server:0 \
  --port 30443:30443@server:0 \
  --port 30443:30443/udp@server:0 \
  --k3s-arg "--tls-san=127.0.0.1@server:0" \
  --k3s-arg "--tls-san=localhost@server:0" \
  --k3s-arg "--kube-apiserver-arg=request-timeout=300s@server:0" \
  --k3s-arg "--kube-apiserver-arg=min-request-timeout=600@server:0" \
  --k3s-arg "--kube-apiserver-arg=max-requests-inflight=1200@server:0" \
  --k3s-arg "--kube-apiserver-arg=max-mutating-requests-inflight=300@server:0" \
  --k3s-arg "--etcd-arg=quota-backend-bytes=8589934592@server:0" \
  --k3s-arg "--etcd-arg=max-request-bytes=1572864@server:0" \
  --wait

ok "Cluster created"

# --- Verify Docker publishes 30443 tcp and udp ---
say "Verify: Docker must show 30443 tcp and udp"
if docker ps --format '{{.Names}}\t{{.Ports}}' 2>/dev/null | grep -E "serverlb|server-0" | grep -q 30443; then
  docker ps --format 'table {{.Names}}\t{{.Ports}}' 2>/dev/null | grep -E "NAMES|serverlb|server-0" || true
  _udp=$(docker ps --format '{{.Ports}}' 2>/dev/null | grep -o '30443/udp' || true)
  _tcp=$(docker ps --format '{{.Ports}}' 2>/dev/null | grep -o '30443/tcp\|30443->' || true)
  if [[ -n "$_udp" ]] && [[ -n "$_tcp" ]]; then
    ok "30443 tcp and udp published"
  else
    warn "Check docker ps: expected 30443/tcp and 30443/udp for serverlb or server-0"
  fi
else
  warn "No k3d container with 30443 in docker ps; list:"
  docker ps -a --format 'table {{.Names}}\t{{.Ports}}' 2>/dev/null | head -15
fi

say "Next (order matters)"
echo "  1. kubectl get nodes -w   # wait both Ready"
echo "  2. Deploy workloads:      kubectl apply -k infra/k8s/base --validate=ignore --request-timeout=180s"
echo "  3. Restore Caddy config:  ./scripts/ensure-caddy-http3-config.sh   # record.local, no on_demand"
echo "  4. Check invariants:       ./scripts/check-quic-invariants.sh"
echo "  5. Validate QUIC:         ./scripts/verify-caddy-http3-in-cluster.sh"
echo ""
info "See docs/QUIC_INVARIANTS.md"
