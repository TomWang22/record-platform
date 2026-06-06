#!/usr/bin/env bash
# kubectl wrapper that avoids timeout issues

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# Try direct kubectl first
if kubectl cluster-info >/dev/null 2>&1; then
  kubectl "$@"
elif command -v docker >/dev/null 2>&1 && docker ps --filter "name=h3-control-plane" --format "{{.Names}}" | grep -q "h3-control-plane"; then
  # Use docker exec as fallback
  if [[ "$1" == "apply" ]] && [[ "$2" == "-k" ]]; then
    # For kustomize, copy files first
    docker cp "$(pwd)" h3-control-plane:/host 2>/dev/null || true
    docker exec h3-control-plane kubectl -C /host "$@" --validate=false
  else
    docker exec h3-control-plane kubectl "$@" --validate=false
  fi
else
  echo "❌ Cannot access cluster" >&2
  exit 1
fi
