#!/usr/bin/env bash
# When Colima says "already running" but docker commands fail with
# "Cannot connect to the Docker daemon at unix:///Users/tom/.colima/default/docker.sock":
# the socket may be stale or Colima's runtime state is wrong.
#
# Usage: ./scripts/colima-docker-fix.sh
# Then in the same shell: docker ps (or source your profile so DOCKER_HOST is set in new shells).

set -euo pipefail
COLIMA_DIR="${HOME}/.colima"
DEFAULT_SOCK="${COLIMA_DIR}/default/docker.sock"
LEGACY_SOCK="${COLIMA_DIR}/docker.sock"

echo "=== Colima / Docker socket fix ==="
echo ""

# 1. Check socket existence
if [[ -S "$DEFAULT_SOCK" ]]; then
  echo "Socket exists: $DEFAULT_SOCK"
  # Check if it's responsive (0 size can mean stale)
  if docker -H "unix://$DEFAULT_SOCK" ps >/dev/null 2>&1; then
    echo "Docker responds on default socket. Export in your shell:"
    echo "  export DOCKER_HOST=unix://$DEFAULT_SOCK"
    echo "  (or add to ~/.zshrc / ~/.bashrc)"
    exit 0
  fi
  echo "Socket exists but Docker did not respond (stale?)."
else
  echo "Socket not found: $DEFAULT_SOCK"
fi

# 2. Colima status
echo ""
echo "Colima status:"
colima status 2>&1 || true

# 3. Recommend restart
echo ""
echo "Try in order:"
echo "  1. Restart Colima (recreates socket and daemon):"
echo "     colima stop"
echo "     colima start"
echo ""
echo "  2. In this terminal, set DOCKER_HOST then retry docker:"
echo "     export DOCKER_HOST=unix://$DEFAULT_SOCK"
echo "     docker ps"
echo ""
echo "  3. Use Docker context if you have one:"
echo "     docker context ls"
echo "     docker context use colima   # if listed"
echo ""
echo "  4. If still broken, full reset (destroys Colima VMs):"
echo "     colima delete -f"
echo "     colima start"
exit 1
