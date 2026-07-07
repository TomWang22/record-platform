#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

DOCS_DIR="docs/ai-platform"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

is_allowed_line() {
  local line="$1"
  if echo "$line" | grep -qiE 'not full parity|sample only|never (call|count|describe|merge)|without claiming|do not call|must not|do not infer|is sample only'; then
    return 0
  fi
  return 1
}

check_banned_pattern() {
  local pattern="$1"
  local matches
  matches="$(grep -ri --include='*.md' -F "$pattern" "$DOCS_DIR" 2>/dev/null || true)"
  if [[ -z "$matches" ]]; then
    return 0
  fi

  while IFS= read -r match; do
    [[ -z "$match" ]] && continue
    local line_content="${match#*:}"
    if is_allowed_line "$line_content"; then
      continue
    fi
    fail "banned evidence label drift ($pattern) in ${match%%:*}: ${line_content}"
  done <<< "$matches"
}

banned_patterns=(
  'Phase 22C 7200 is full parity'
  '7200/7200 satisfies full parity'
  'Phase 22C full protocol parity'
  '7200 full protocol parity'
  '171315 cumulative'
  '171315 unlabeled'
)

for pattern in "${banned_patterns[@]}"; do
  check_banned_pattern "$pattern"
done

echo "PASS: AI-platform evidence labels are preserved"
