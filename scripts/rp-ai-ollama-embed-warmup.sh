#!/usr/bin/env bash
# T20.10I-preflight-B — Ollama embedding warmup gate (benchmark/provider readiness only).
# Does not change product retrieval behavior or shadow timeout defaults.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

NS="${K8S_NAMESPACE:-record-platform}"
OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://ollama.${NS}.svc.cluster.local:11434}"
AI_EMBEDDING_MODEL="${AI_EMBEDDING_MODEL:-nomic-embed-text}"
OLLAMA_WARMUP_MAX_ATTEMPTS="${OLLAMA_WARMUP_MAX_ATTEMPTS:-12}"
OLLAMA_WARMUP_TARGET_MS="${OLLAMA_WARMUP_TARGET_MS:-2000}"
OLLAMA_WARMUP_CONSECUTIVE="${OLLAMA_WARMUP_CONSECUTIVE:-3}"
OLLAMA_WARMUP_TIMEOUT_SEC="${OLLAMA_WARMUP_TIMEOUT_SEC:-25}"
OLLAMA_WARMUP_TEXT="${OLLAMA_WARMUP_TEXT:-record platform seller offer summary warmup}"
OLLAMA_WARMUP_VIA_POD="${OLLAMA_WARMUP_VIA_POD:-auto}"

WARMUP_PY="${SCRIPT_DIR}/lib/rp-ai-ollama-embed-warmup.py"

echo "=== Ollama embed warmup gate (T20.10I-preflight-B) ==="
echo "model=${AI_EMBEDDING_MODEL} base=${OLLAMA_BASE_URL}"
echo "target_ms=${OLLAMA_WARMUP_TARGET_MS} consecutive=${OLLAMA_WARMUP_CONSECUTIVE} max_attempts=${OLLAMA_WARMUP_MAX_ATTEMPTS}"

export OLLAMA_BASE_URL AI_EMBEDDING_MODEL OLLAMA_WARMUP_TEXT
export OLLAMA_WARMUP_MAX_ATTEMPTS OLLAMA_WARMUP_TARGET_MS OLLAMA_WARMUP_CONSECUTIVE
export OLLAMA_WARMUP_TIMEOUT_SEC

_pod_ready() {
  kubectl get deploy/python-ai-service -n "$NS" >/dev/null 2>&1 || return 1
  local phase
  phase="$(kubectl get pod -n "$NS" -l app=python-ai-service -o jsonpath='{.items[0].status.phase}' 2>/dev/null || true)"
  [[ "$phase" == "Running" ]]
}

_run_local() {
  echo "path=local_python"
  python3 -u "$WARMUP_PY"
}

_run_via_pod() {
  echo "path=kubectl_exec deploy/python-ai-service"
  kubectl exec -i -n "$NS" deploy/python-ai-service -c app -- env \
    OLLAMA_BASE_URL="$OLLAMA_BASE_URL" \
    AI_EMBEDDING_MODEL="$AI_EMBEDDING_MODEL" \
    OLLAMA_WARMUP_TEXT="$OLLAMA_WARMUP_TEXT" \
    OLLAMA_WARMUP_MAX_ATTEMPTS="$OLLAMA_WARMUP_MAX_ATTEMPTS" \
    OLLAMA_WARMUP_TARGET_MS="$OLLAMA_WARMUP_TARGET_MS" \
    OLLAMA_WARMUP_CONSECUTIVE="$OLLAMA_WARMUP_CONSECUTIVE" \
    OLLAMA_WARMUP_TIMEOUT_SEC="$OLLAMA_WARMUP_TIMEOUT_SEC" \
    python3 -u - < "$WARMUP_PY"
}

use_pod="no"
case "$OLLAMA_WARMUP_VIA_POD" in
  1|true|yes|pod) use_pod="yes" ;;
  auto)
    if _pod_ready; then
      use_pod="yes"
    fi
    ;;
esac

if [[ "$use_pod" == "yes" ]]; then
  _run_via_pod
else
  _run_local
fi
