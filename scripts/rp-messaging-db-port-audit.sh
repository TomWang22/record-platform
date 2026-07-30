#!/usr/bin/env bash
# Fail if messaging-service is wired to legacy RP port 5444 instead of RP 5434.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT="${REPO_ROOT}/bench_logs/frontend-contract/messaging-db-port-audit.md"
mkdir -p "$(dirname "$OUT")"

bad=0
hits=()

scan() {
  local label="$1"
  local pattern="$2"
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    hits+=("$label: $line")
    bad=1
  done < <(rg -n "$pattern" "$REPO_ROOT" \
    --glob '!**/node_modules/**' \
    --glob '!**/.next/**' \
    --glob '!**/bench_logs/**' \
    --glob '!**/pnpm-lock.yaml' 2>/dev/null || true)
}

scan '5444 in messaging paths' '5444.*messag|messag.*5444|:5444'
scan 'och social port in messaging deploy' 'POSTGRES_URL_SOCIAL.*5444|5444.*social'

{
  echo "# Messaging DB port audit"
  echo ""
  echo "Time (UTC): $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo ""
  echo "Expected: messaging-service uses port **5434** (\`MESSAGING_DB_PORT\` / \`PGPORT\` default in \`services/messaging-service/src/lib/db.ts\`)."
  echo ""
  if [[ $bad -eq 0 ]]; then
    echo "Result: **PASS** — no active 5444 messaging references found."
  else
    echo "Result: **FAIL** — legacy RP port references:"
    echo '```'
    printf '%s\n' "${hits[@]}"
    echo '```'
  fi
} >"$OUT"

if [[ $bad -ne 0 ]]; then
  echo "❌ messaging DB port audit FAIL — $OUT" >&2
  exit 1
fi
echo "✅ messaging DB port audit PASS — $OUT"
