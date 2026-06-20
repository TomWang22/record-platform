#!/usr/bin/env bash
# Run coverage for one service or all services listed in service-coverage-manifest.json.
# Does not require cluster/k8s. Does not modify production code.
#
# Usage:
#   bash scripts/coverage/run-service-coverage.sh              # all runnable services
#   bash scripts/coverage/run-service-coverage.sh python-ai-service
#   bash scripts/coverage/run-service-coverage.sh messaging-service
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MANIFEST="$ROOT/scripts/coverage/service-coverage-manifest.json"
TARGET="${1:-}"

if [[ ! -f "$MANIFEST" ]]; then
  echo "::error::missing manifest: $MANIFEST" >&2
  exit 2
fi

run_one() {
  local name="$1"
  local info
  info="$(node -e "
    const m = require(process.argv[1]);
    const svc = m.services.find(s => s.name === process.argv[2]);
    if (!svc) { console.error('unknown service: ' + process.argv[2]); process.exit(3); }
    console.log(JSON.stringify(svc));
  " "$MANIFEST" "$name")"

  local run_cmd skip_reason
  run_cmd="$(node -e "console.log(JSON.parse(process.argv[1]).run_command || '')" "$info")"
  skip_reason="$(node -e "console.log(JSON.parse(process.argv[1]).skip_reason || '')" "$info")"

  if [[ -z "$run_cmd" || "$run_cmd" == "null" ]]; then
    echo "SKIP $name — ${skip_reason:-no run_command configured}"
    return 0
  fi

  echo "▶ coverage: $name"
  cd "$ROOT"
  eval "$run_cmd"
  echo "✅ coverage: $name done"
}

if [[ -n "$TARGET" ]]; then
  run_one "$TARGET"
  exit 0
fi

mapfile -t NAMES < <(node -e "
  const m = require(process.argv[1]);
  for (const s of m.services) console.log(s.name);
" "$MANIFEST")

for name in "${NAMES[@]}"; do
  run_one "$name" || true
done

echo "✅ run-service-coverage: finished (${#NAMES[@]} services in manifest)"
