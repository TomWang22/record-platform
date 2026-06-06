#!/usr/bin/env bash
# Apply webapp-runtime-secrets (Maps API key) in record-platform. Idempotent.
#
# Key source (first match):
#   1. CLI arg
#   2. NEXT_PUBLIC_GOOGLE_MAPS_API_KEY or GOOGLE_MAPS_API_KEY env
#   3. webapp/.env.local
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${HOUSING_NS:-${NAMESPACE:-record-platform}}"

_key_from_env_file() {
  local f="$1"
  [[ -f "$f" ]] || return 1
  local line
  line="$(grep -E '^[[:space:]]*NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=' "$f" | tail -1)" || return 1
  line="${line#*=}"
  line="${line%$'\r'}"
  line="${line#\"}"
  line="${line%\"}"
  line="${line#\'}"
  line="${line%\'}"
  [[ -n "$line" ]] || return 1
  printf '%s' "$line"
}

KEY="${1:-}"
KEY="${KEY:-${NEXT_PUBLIC_GOOGLE_MAPS_API_KEY:-}}"
KEY="${KEY:-${GOOGLE_MAPS_API_KEY:-}}"
if [[ -z "$KEY" ]]; then
  KEY="$(_key_from_env_file "$REPO_ROOT/webapp/.env.local" 2>/dev/null || true)"
fi

if [[ -z "$KEY" ]]; then
  echo "❌ ensure-webapp-runtime-secrets: no Maps API key (arg, env, or webapp/.env.local)" >&2
  exit 1
fi

command -v kubectl >/dev/null 2>&1 || {
  echo "❌ kubectl required" >&2
  exit 1
}

kubectl create namespace "$NS" --dry-run=client -o yaml | kubectl apply -f - >/dev/null 2>&1 || true

kubectl create secret generic webapp-runtime-secrets -n "$NS" \
  --from-literal=NEXT_PUBLIC_GOOGLE_MAPS_API_KEY="$KEY" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "✅ webapp-runtime-secrets applied in ns=$NS (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY)"

if kubectl get deployment webapp -n "$NS" >/dev/null 2>&1; then
  kubectl rollout restart deployment/webapp -n "$NS" >/dev/null 2>&1 || true
  echo "  ▶ rollout restart deployment/webapp"
fi
