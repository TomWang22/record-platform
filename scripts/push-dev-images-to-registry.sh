#!/usr/bin/env bash
# Tag and push existing :dev images to k3d-record-platform-registry:5000 (no build).
# Use after build-and-push-dev.sh or when images exist locally. Cluster must pull that exact ref.
#
# Prerequisites:
# 1. Resolve registry hostname (if push fails with "could not resolve host"):
#      echo '127.0.0.1 k3d-record-platform-registry' | sudo tee -a /etc/hosts
# 2. Use HTTP for registry (if push fails with "server gave HTTP response to HTTPS client"):
#      Add k3d-record-platform-registry:5000 to Docker insecure-registries (see script output).
# Then re-run this script.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

REG="${K3D_REGISTRY:-k3d-record-platform-registry:5000}"
SERVICES=( api-gateway auth-service records-service listings-service analytics-service python-ai-service social-service shopping-service auction-monitor )

ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }

if ! ( curl -s -o /dev/null -w "%{http_code}" --connect-timeout 2 "http://k3d-record-platform-registry:5000/v2/" 2>/dev/null | grep -qE '200|401|403' ); then
  warn "k3d-record-platform-registry did not resolve or registry not reachable."
  echo "  Run once: echo '127.0.0.1 k3d-record-platform-registry' | sudo tee -a /etc/hosts"
  echo "  Then re-run: $0"
  exit 1
fi

_insecure_registry_hint() {
  echo ""
  warn "Docker is using HTTPS for the registry; the k3d registry is HTTP-only."
  echo "  Add the registry to Docker's insecure-registries and restart Docker, then re-run this script."
  echo ""
  echo "  Colima (macOS):"
  echo "    colima ssh"
  echo "    # Add insecure-registries to /etc/docker/daemon.json (merge if file exists). Then:"
  echo "    sudo systemctl daemon-reload && sudo systemctl restart docker"
  echo "    exit"
  echo "    # Then: $0"
  echo "  (Example daemon.json: {\"insecure-registries\": [\"k3d-record-platform-registry:5000\", \"127.0.0.1:5000\"]})"
  echo ""
  echo "  Linux (Docker directly):"
  echo "    Add to /etc/docker/daemon.json: \"insecure-registries\": [ \"k3d-record-platform-registry:5000\" ]"
  echo "    sudo systemctl daemon-reload && sudo systemctl restart docker"
  echo ""
}

for s in "${SERVICES[@]}"; do
  if docker image inspect "$s:dev" >/dev/null 2>&1; then
    docker tag "$s:dev" "$REG/$s:dev"
    _push_ok=0
    for _try in 1 2 3; do
      _out=$(docker push "$REG/$s:dev" 2>&1) && { _push_ok=1; ok "Pushed $s:dev"; break; }
      echo "$_out" >&2
      if echo "$_out" | grep -q "server gave HTTP response to HTTPS client"; then
        _insecure_registry_hint
        exit 1
      fi
      [[ $_try -lt 3 ]] && echo "  Retry $_try/3 in 5s..." && sleep 5
    done
    [[ $_push_ok -eq 0 ]] && warn "Push $s:dev failed after 3 tries"
  else
    warn "No image $s:dev (build first: ./scripts/build-and-push-dev.sh)"
  fi
done

echo ""
ok "Done. Restart deployments: kubectl rollout restart deploy -n record-platform"
