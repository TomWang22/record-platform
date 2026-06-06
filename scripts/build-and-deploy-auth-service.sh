#!/usr/bin/env bash
# Build auth-service:dev and deploy to the cluster (Colima or Kind).
# Use after auth-service code changes (e.g. 401 on login-after-delete fix).
# Usage: ./scripts/build-and-deploy-auth-service.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

CLUSTER="${KIND_CLUSTER:-h3}"
ctx=$(kubectl config current-context 2>/dev/null || echo "")

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
fail(){ echo "❌ $*" >&2; exit 1; }

say "Build and deploy auth-service"

# 1. Build
df="services/auth-service/Dockerfile"
[[ -f "$df" ]] || fail "Dockerfile not found: $df"

PLATFORM="${PLATFORM:-linux/amd64}"
say "Building auth-service:dev (platform: $PLATFORM)..."
if DOCKER_BUILDKIT=1 docker buildx build \
  --load \
  --pull --progress=plain \
  --platform "$PLATFORM" \
  -f "$df" -t auth-service:dev .; then
  ok "auth-service:dev built"
else
  fail "Build failed"
fi

# 2. Load into cluster (Kind only; Colima k3s uses same Docker daemon)
if [[ "$ctx" == *"colima"* ]]; then
  ok "Colima context: image already available to k3s (shared Docker daemon)"
else
  if command -v kind >/dev/null 2>&1 && kind get clusters 2>/dev/null | grep -qx "$CLUSTER"; then
    say "Loading auth-service:dev into Kind ($CLUSTER)..."
    if kind load docker-image auth-service:dev --name "$CLUSTER"; then
      ok "Image loaded into Kind"
    else
      fail "kind load failed"
    fi
  else
    warn "Not Colima and Kind cluster '$CLUSTER' not found; skipping load (image may still be in use if cluster uses host Docker)"
  fi
fi

# 3. Rollout restart
NS="record-platform"
say "Rolling restart auth-service in $NS..."
kctl() {
  if [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
    colima ssh -- kubectl --request-timeout=15s "$@" 2>/dev/null || kubectl --request-timeout=15s "$@"
  else
    kubectl --request-timeout=15s "$@"
  fi
}
if kctl rollout restart deploy auth-service -n "$NS"; then
  ok "Rollout restarted"
else
  fail "rollout restart failed"
fi

say "Waiting for auth-service to be ready..."
if kctl rollout status deploy auth-service -n "$NS" --timeout=120s; then
  ok "auth-service is ready"
else
  warn "Rollout status timed out or failed; check: kubectl get pods -n $NS -l app=auth-service"
fi

ok "Done. Re-run auth/delete-account tests; login after delete should return 401 (not 500)."
