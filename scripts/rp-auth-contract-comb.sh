#!/usr/bin/env bash
# Fail if contract/E2E paths use forbidden dev-auth or fake session patterns.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

REPORT_DIR="${REPORT_DIR:-$REPO_ROOT/bench_logs/auth-contract}"
REPORT="${REPORT:-$REPORT_DIR/auth-normal-only-contract.md}"
ALLOWLIST="${ALLOWLIST:-$REPO_ROOT/scripts/rp-auth-contract-allowlist.txt}"

mkdir -p "$REPORT_DIR"
FAIL=0
hits=()

pass() { echo "✅ $*"; }
fail() { echo "❌ $*"; FAIL=1; }

FORBIDDEN_PATTERNS=(
  '/api/dev-auth/login'
  '/api/auth/dev/align-password'
  'AUTH_DEV_ALIGN_PASSWORD'
  'dev-auth'
  'align-password'
  'fake.*session'
  'mockSession'
  'MockSessionProvider'
)

SCAN_DIRS=(
  webapp/e2e
  webapp/lib
  webapp/app
  webapp/components
  services/api-gateway/src
)

SKIP_GLOBS=(
  'bench_logs/*'
  'docs/reference/*'
  'docs/archive/*'
  'toolkit-reference/*'
  '**/node_modules/**'
  '**/.next/**'
)

is_allowlisted() {
  local file="$1"
  if [[ -f "$ALLOWLIST" ]] && grep -qxF "$file" "$ALLOWLIST" 2>/dev/null; then
    return 0
  fi
  case "$file" in
    bench_logs/*|docs/reference/*|docs/archive/*|toolkit-reference/*) return 0 ;;
  esac
  return 1
}

echo "=== RP auth normal-only comb ==="

for pat in "${FORBIDDEN_PATTERNS[@]}"; do
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    file="${line%%:*}"
    is_allowlisted "$file" && continue
    hits+=("$line ($pat)")
  done < <(rg -n --glob '!bench_logs/**' --glob '!docs/reference/**' --glob '!.next/**' \
    --glob '!node_modules/**' "$pat" "${SCAN_DIRS[@]}" 2>/dev/null || true)
done

# Prove contract login path exists
if grep -qE '/api/auth/(login|register)' "$REPO_ROOT/webapp/e2e/helpers/auth.ts" 2>/dev/null; then
  pass "E2E auth helper uses normal /api/auth/login or register"
else
  fail "E2E auth helper missing normal /api/auth/login or register"
fi

if [[ ${#hits[@]} -gt 0 ]]; then
  fail "Forbidden auth patterns in contract paths:"
  printf '  %s\n' "${hits[@]}"
else
  pass "No forbidden dev-auth / fake session patterns in contract scan paths"
fi

{
  echo "# Auth normal-only contract"
  echo ""
  echo "Time (UTC): $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo ""
  echo "## Scan paths"
  for d in "${SCAN_DIRS[@]}"; do echo "- \`$d\`"; done
  echo ""
  echo "## Forbidden patterns"
  for p in "${FORBIDDEN_PATTERNS[@]}"; do echo "- \`$p\`"; done
  echo ""
  if [[ ${#hits[@]} -gt 0 ]]; then
    echo "## Hits"
    printf '%s\n' "${hits[@]}" | sed 's/^/- /'
    echo ""
    echo "**Result:** FAIL"
  else
    echo "**Result:** PASS — contract auth uses normal register/login only."
    echo ""
    echo "✅ normal auth only contract passed"
  fi
} >"$REPORT"

if [[ $FAIL -eq 0 ]]; then
  pass "normal auth only contract passed"
  pass "Report: $REPORT"
  exit 0
fi
echo "Report: $REPORT" >&2
exit 1
