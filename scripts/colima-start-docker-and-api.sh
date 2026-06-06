#!/usr/bin/env bash
# Get Colima + Docker + k8s API running when you see:
#   - kubectl: connection refused to 127.0.0.1:6443
#   - docker: Cannot connect to the Docker daemon at unix://.../docker.sock
#   - colima status: "error retrieving current runtime: empty value"
#
# This script: restarts Colima (stop/start), establishes 6443 tunnel, fixes kubeconfig,
# and ensures Docker socket is used. Then you run ensure-dependencies and recover-and-bring-up.
#
# Usage:
#   ./scripts/colima-start-docker-and-api.sh          # restart Colima, then tunnel + kubeconfig + docker
#   ./scripts/colima-start-docker-and-api.sh --no-restart   # only tunnel + kubeconfig + docker (Colima already running)
#   ./scripts/colima-start-docker-and-api.sh --full   # full teardown (colima delete -f) then clean start (no Docker in VM; use host Docker for compose)
#
# After this script succeeds:
#   ./scripts/ensure-dependencies-ready.sh   # start Postgres, Redis, Kafka (docker compose)
#   ./scripts/colima-recover-and-bring-up.sh   # MetalLB + bring up cluster
#
# See: docs/COLIMA-K3S-METALLB-PRIMARY.md, docs/COLIMA_K3S_CRASH_LOOP.md, Runbook #52 #67

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

NO_RESTART=0
FULL_TEARDOWN=0
[[ "${1:-}" == "--no-restart" ]] && NO_RESTART=1
[[ "${1:-}" == "--full" ]] && FULL_TEARDOWN=1

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
info(){ echo "ℹ️  $*"; }

say "=== Colima: Docker + API (6443) ==="

# Full teardown: delete VM then run clean bridged start (k3s only; no Docker in VM)
if [[ "$FULL_TEARDOWN" -eq 1 ]]; then
  warn "Full teardown: colima delete -f then clean bridged start (k3s v1.29, no Docker in VM)."
  warn "For Docker Compose (Postgres/Redis/Kafka) you need Docker Desktop or Colima with Docker; after this, use host Docker or start Colima again with Docker."
  read -r -p "Continue? [y/N] " r
  if [[ "${r:-n}" != "y" ]] && [[ "${r:-n}" != "Y" ]]; then
    exit 0
  fi
  colima delete -f 2>/dev/null || true
  exec "$SCRIPT_DIR/colima-start-k3s-bridged-clean.sh"
fi

# Restart Colima so runtime (Docker + k3s) comes back; "empty value" often fixed by stop/start
if [[ "$NO_RESTART" -eq 0 ]]; then
  info "Restarting Colima (stop then start) to recover runtime..."
  colima stop 2>/dev/null || true
  sleep 3
  # Start with same profile (Colima restores docker+k3s and network-address from default profile)
  info "Starting Colima (this can take 1–2 minutes)..."
  if ! colima start 2>&1; then
    warn "colima start failed. Try full teardown: $0 --full"
    exit 1
  fi
  sleep 5
else
  info "Skipping restart (--no-restart). Ensuring tunnel and kubeconfig."
fi

# SSH config must exist for tunnel
SSH_CFG="${HOME}/.colima/_lima/colima/ssh.config"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if [[ -f "$SSH_CFG" ]]; then
    break
  fi
  info "Waiting for Colima SSH config..."
  sleep 5
done
if [[ ! -f "$SSH_CFG" ]]; then
  warn "Colima SSH config not found. Start Colima: colima start --with-kubernetes --network-address"
  exit 1
fi

# Establish 6443 tunnel and pin kubeconfig to localhost
info "Setting up API tunnel 127.0.0.1:6443..."
"$SCRIPT_DIR/colima-forward-6443.sh" --restart 2>/dev/null || "$SCRIPT_DIR/colima-forward-6443.sh" 2>/dev/null || true
[[ -x "$SCRIPT_DIR/colima-refresh-kubeconfig.sh" ]] && "$SCRIPT_DIR/colima-refresh-kubeconfig.sh" 2>/dev/null || true
[[ -x "$SCRIPT_DIR/colima-fix-kubeconfig-localhost.sh" ]] && "$SCRIPT_DIR/colima-fix-kubeconfig-localhost.sh" 2>/dev/null || true

# Wait for API
info "Waiting for Kubernetes API..."
for _i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  if kubectl get nodes --request-timeout=5s &>/dev/null; then
    ok "kubectl get nodes OK"
    break
  fi
  [[ $_i -eq 12 ]] && { warn "API not reachable. Run: $SCRIPT_DIR/colima-forward-6443.sh --restart"; exit 1; }
  sleep 5
done

# Docker: point at Colima socket when VM is running (colima list shows Running)
for sock in "$HOME/.colima/default/docker.sock" "$HOME/.colima/docker.sock"; do
  if [[ -S "$sock" ]] || [[ -f "$sock" ]]; then
    export DOCKER_HOST="unix://$sock"
    docker context use colima 2>/dev/null || true
    break
  fi
done
if docker info &>/dev/null; then
  ok "Docker reachable (DOCKER_HOST=${DOCKER_HOST:-default})"
else
  warn "Docker daemon not reachable. If Colima has docker+k3s, the socket may appear after a few more seconds."
  info "Try: export DOCKER_HOST=unix://$HOME/.colima/default/docker.sock && docker ps"
  info "If socket never appears, restart fixed the VM but not the runtime; try: colima delete -f && colima start --with-kubernetes --network-address --cpu 12 --memory 16 --disk 256"
fi

say "=== Next steps ==="
echo "  1. Dependencies (Postgres, Redis, Kafka):  ./scripts/ensure-dependencies-ready.sh"
echo "  2. MetalLB + cluster bring-up:            ./scripts/colima-recover-and-bring-up.sh"
echo ""
ok "Colima API (6443) and Docker setup done."
