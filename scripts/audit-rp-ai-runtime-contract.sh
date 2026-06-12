#!/usr/bin/env bash
# T15.3A/E — AI runtime provider + retrieval contract audit.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

export PGHOST="${PGHOST:-127.0.0.1}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

REPORT_DIR="${REPORT_DIR:-$REPO_ROOT/bench_logs/ai-platform}"
MD_REPORT="$REPORT_DIR/ai-runtime-provider-contract.md"
JSON_REPORT="$REPORT_DIR/ai-runtime-provider-contract.json"
mkdir -p "$REPORT_DIR"

FAIL=0
CHECKS=()

pass() { CHECKS+=("{\"id\":\"$1\",\"status\":\"pass\"}"); echo "✅ $1"; }
fail() { CHECKS+=("{\"id\":\"$1\",\"status\":\"fail\",\"detail\":$(printf '%s' "$2" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')}"); echo "❌ $1: $2"; FAIL=1; }

API_BASE="${AI_CONTRACT_API_BASE:-https://record-platform.test}"
CA="${NODE_EXTRA_CA_CERTS:-$REPO_ROOT/certs/dev-chain.pem}"
if [[ ! -f "$CA" ]]; then CA="$REPO_ROOT/certs/dev-root.pem"; fi
CURL_OPTS=(-fsS --max-time 15)
if [[ -f "$CA" ]]; then CURL_OPTS+=(--cacert "$CA"); fi

echo "=== RP AI runtime contract audit (T15.3A) ==="

# Source files present
for f in \
  services/python-ai-service/app/ai/config.py \
  services/python-ai-service/app/ai/envelope.py \
  services/python-ai-service/app/ai/providers/registry.py \
  services/python-ai-service/app/ai/providers/ollama.py \
  services/python-ai-service/app/ai/providers/rule_engine.py \
  services/python-ai-service/app/ai/providers/transformer.py \
  services/python-ai-service/app/ai/rag_retrieval.py; do
  if [[ -f "$f" ]]; then pass "file_${f//\//_}"; else fail "file_${f//\//_}" "missing"; fi
done

# Python unit tests (no model downloads)
if PYTHONPATH="$REPO_ROOT/services/python-ai-service" python3 "$REPO_ROOT/services/python-ai-service/tests/test_rag_retrieval.py" -q 2>/dev/null; then
  pass "python_retrieval_unit_tests"
else
  fail "python_retrieval_unit_tests" "unittest failed"
fi

# Status endpoint shape
STATUS_JSON="$(curl "${CURL_OPTS[@]}" "$API_BASE/api/ai/rag/status" 2>/dev/null || echo '{}')"
if echo "$STATUS_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert "providers" in d or "reason" in d'; then
  pass "rag_status_providers_field"
else
  fail "rag_status_providers_field" "missing providers"
fi

if echo "$STATUS_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("retrieval_mode")=="keyword" or d.get("reason")'; then
  pass "rag_status_retrieval_mode"
else
  fail "rag_status_retrieval_mode" "expected retrieval_mode=keyword"
fi

MODEL_USED="$(echo "$STATUS_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("model_used",""))' 2>/dev/null || echo "")"
if [[ -n "$MODEL_USED" ]]; then pass "rag_status_model_used"; else fail "rag_status_model_used" "empty"; fi

# Ollama probe must be structured (no fake prose)
if echo "$STATUS_JSON" | python3 -c '
import json,sys,re
d=json.load(sys.stdin)
text=json.dumps(d).lower()
for term in ("demo","mock","sample fallback","lorem ipsum"):
    assert term not in text
'; then
  pass "no_forbidden_status_prose"
else
  fail "no_forbidden_status_prose" "forbidden term in status JSON"
fi

PROVIDERS_JSON="$(echo "$STATUS_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(json.dumps(d.get("providers",{})))' 2>/dev/null || echo '{}')"
for pname in ollama rule hf torch tensorflow; do
  if echo "$PROVIDERS_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); assert '$pname' in d"; then
    pass "provider_status_${pname}"
  else
    fail "provider_status_${pname}" "missing"
  fi
done

# Transformers disabled by default in deploy
if grep -q 'AI_TRANSFORMER_ENABLED' infra/k8s/base/python-ai-service/deploy.yaml && \
   grep -q 'AI_MODEL_PROVIDER' infra/k8s/base/python-ai-service/deploy.yaml; then
  pass "k8s_ai_runtime_env"
else
  fail "k8s_ai_runtime_env" "missing AI_MODEL_PROVIDER / AI_TRANSFORMER_ENABLED"
fi

FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
CHECKS_JSON="[$(IFS=,; echo "${CHECKS[*]}")]"

cat > "$JSON_REPORT" <<EOF
{
  "finished_at": "$FINISHED_AT",
  "status_sample": $(echo "$STATUS_JSON" | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)))' 2>/dev/null || echo '{}'),
  "checks": $CHECKS_JSON,
  "exit_code": $FAIL
}
EOF

{
  echo "# AI runtime provider contract (T15.3A audit)"
  echo ""
  echo "Generated: $FINISHED_AT"
  echo ""
  echo "## Active model"
  echo "- model_used: \`$MODEL_USED\`"
  echo ""
  echo "## Status sample"
  echo '```json'
  echo "$STATUS_JSON" | python3 -m json.tool 2>/dev/null || echo "$STATUS_JSON"
  echo '```'
  echo ""
  echo "## Checks"
  for c in "${CHECKS[@]}"; do echo "- $c"; done
  echo ""
  echo "Exit: $FAIL"
} > "$MD_REPORT"

echo "Reports: $MD_REPORT , $JSON_REPORT"
exit "$FAIL"
