#!/usr/bin/env bash
# Run pytest with coverage for python-ai-service app/ai module only.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SVC="$ROOT/services/python-ai-service"
cd "$SVC"

mkdir -p coverage

if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
python -m pip install -q --upgrade pip
pip install -q -r requirements.txt -r requirements-test.txt

export PYTHONPATH="$SVC${PYTHONPATH:+:$PYTHONPATH}"
pytest tests/ \
  --cov=app.ai \
  --cov-report=term-missing:skip-covered \
  --cov-report=json:coverage/coverage.json \
  -q

node "$ROOT/scripts/coverage/python-cov-to-summary.mjs" \
  "$SVC/coverage/coverage.json" \
  "$SVC/coverage/coverage-summary.json"

echo "✅ python-ai coverage summary: $SVC/coverage/coverage-summary.json"
