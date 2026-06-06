#!/usr/bin/env bash
# Light Ollama smoke when RP_ENABLE_OLLAMA=1 (no full model pull unless RP_OLLAMA_REQUIRE_MODEL=1).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/rp-ollama-gate-policy.sh
source "$SCRIPT_DIR/lib/rp-ollama-gate-policy.sh"

NS="${HOUSING_NS:-record-platform}"
OLLAMA_URL="${OLLAMA_SMOKE_URL:-http://ollama.${NS}.svc.cluster.local:11434}"

rp_ollama_policy_resolve
if [[ "${RP_ENABLE_OLLAMA_EFFECTIVE}" != "1" ]]; then
  echo "ℹ️  smoke-rp-ollama skipped — RP_ENABLE_OLLAMA_EFFECTIVE!=1"
  exit 0
fi

rp_ollama_env_validate || exit 1

if ! kubectl get svc ollama -n "$NS" >/dev/null 2>&1; then
  echo "❌ service/ollama missing in ns=$NS" >&2
  exit 1
fi

_code="$(kubectl run "rp-ollama-smoke-$$" -n "$NS" --rm -i --restart=Never \
  --image=curlimages/curl:8.5.0 --command -- \
  curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 10 --max-time 30 \
  "${OLLAMA_URL}/" 2>/dev/null || echo "000")"

if [[ "$_code" =~ ^[23] ]]; then
  echo "✅ Ollama HTTP ${_code} at ${OLLAMA_URL}/"
else
  echo "❌ Ollama smoke failed HTTP=${_code} (${OLLAMA_URL}/)" >&2
  exit 1
fi

if [[ "${RP_OLLAMA_REQUIRE_MODEL:-0}" == "1" ]]; then
  echo "▶ RP_OLLAMA_REQUIRE_MODEL=1 — checking /api/tags…"
  _tags="$(kubectl run "rp-ollama-tags-$$" -n "$NS" --rm -i --restart=Never \
    --image=curlimages/curl:8.5.0 --command -- \
    curl -sS --connect-timeout 10 --max-time 60 "${OLLAMA_URL}/api/tags" 2>/dev/null || true)"
  echo "$_tags" | grep -q '"models"' \
    && echo "✅ Ollama /api/tags responded" \
    || { echo "❌ Ollama model list empty or unreachable" >&2; exit 1; }
fi

echo "✅ smoke-rp-ollama passed"
