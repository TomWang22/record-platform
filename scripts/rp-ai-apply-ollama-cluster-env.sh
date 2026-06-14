#!/usr/bin/env bash
# Apply canonical Ollama/provider env on python-ai-service (cluster DNS fix).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

NS="${K8S_NAMESPACE:-record-platform}"
DEPLOY="${PYTHON_AI_DEPLOY:-python-ai-service}"
OLLAMA_URL="${OLLAMA_BASE_URL:-http://ollama.${NS}.svc.cluster.local:11434}"

echo "=== rp-ai-apply-ollama-cluster-env ==="
echo "namespace=$NS deployment=$DEPLOY"
echo "OLLAMA_BASE_URL=$OLLAMA_URL"

kubectl set env "deployment/${DEPLOY}" -n "$NS" \
  OLLAMA_BASE_URL="$OLLAMA_URL" \
  AI_OLLAMA_MODEL="${AI_OLLAMA_MODEL:-llama3.2:1b}" \
  AI_EMBEDDING_MODEL="${AI_EMBEDDING_MODEL:-nomic-embed-text}" \
  AI_OLLAMA_TIMEOUT_MS="${AI_OLLAMA_TIMEOUT_MS:-5000}" \
  AI_RAG_MAX_CHUNKS="${AI_RAG_MAX_CHUNKS:-8}" \
  AI_RAG_MAX_CONTEXT_TOKENS="${AI_RAG_MAX_CONTEXT_TOKENS:-2048}" \
  AI_MAX_RESPONSE_TOKENS="${AI_MAX_RESPONSE_TOKENS:-512}" \
  AI_MODEL_PROVIDER="${AI_MODEL_PROVIDER:-rule}" \
  AI_TRANSFORMER_ENABLED="${AI_TRANSFORMER_ENABLED:-0}"

kubectl rollout status "deployment/${DEPLOY}" -n "$NS" --timeout=300s
echo "✅ ${DEPLOY} Ollama env applied (provider=${AI_MODEL_PROVIDER:-rule}; rule fallback preserved)"
