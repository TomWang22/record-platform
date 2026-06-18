#!/usr/bin/env bash
# Guard: commit vector diagnostic scripts only after gates pass and embedded count is unchanged.
# Usage (before git commit):
#   T19_DIAG_GATES_PASSED=1 EMBEDDED_EXPECTED=4547 bash scripts/lib/rp-ai-diagnostics-commit-guard.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=rp-python-ai-psql.sh
source "$SCRIPT_DIR/rp-python-ai-psql.sh"

EXPECTED="${EMBEDDED_EXPECTED:-4547}"
GATES_PASSED="${T19_DIAG_GATES_PASSED:-0}"

DIAG_SCRIPTS=(
  "$REPO_ROOT/scripts/rp-ai-vector-distribution-audit.sh"
  "$REPO_ROOT/scripts/rp-ai-shadow-source-diagnostic.sh"
)

if [[ "$GATES_PASSED" != "1" ]]; then
  echo "❌ T19_DIAG_GATES_PASSED=1 required (run full gate bundle first)"
  exit 1
fi

rp_python_ai_psql_connect_check || { echo "❌ python_ai DB unreachable"; exit 1; }

actual="$(rp_python_ai_psql "SELECT count(*) FROM ai.ai_document_chunks WHERE embedding_vec IS NOT NULL;")"
if [[ "$actual" != "$EXPECTED" ]]; then
  echo "❌ embedded count mismatch: expected=$EXPECTED actual=$actual"
  exit 1
fi

changed=0
for f in "${DIAG_SCRIPTS[@]}"; do
  if git -C "$REPO_ROOT" diff --quiet HEAD -- "$f" 2>/dev/null; then
    if [[ -f "$f" ]] && ! git -C "$REPO_ROOT" ls-files --error-unmatch "$f" >/dev/null 2>&1; then
      changed=1
    fi
  else
    changed=1
  fi
done

if [[ "$changed" -eq 0 ]]; then
  echo "ℹ️  no diagnostic script source changes — skip commit"
  exit 2
fi

echo "✅ commit guard OK (embedded=$actual, gates_passed=1, scripts changed)"
