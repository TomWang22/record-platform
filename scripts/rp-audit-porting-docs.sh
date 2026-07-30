#!/usr/bin/env bash
# Non-blocking audit: RP/booking reference strings in porting/bundle docs (not runtime).
# Blocks only when RP_STRICT_DOC_PORTING_AUDIT=1.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
STRICT="${RP_STRICT_DOC_PORTING_AUDIT:-0}"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "ℹ️  $*"; }

VIOLATIONS=0
PATTERNS=(
  'record-platform\.test'
  'record-platform\.local'
  'reservation-mesh'
  'messaging-service'
)

scan_dir() {
  local dir="$1"
  [[ -d "$dir" ]] || return 0
  local pat re
  for pat in "${PATTERNS[@]}"; do
    while IFS= read -r hit; do
      [[ -z "$hit" ]] && continue
      echo "  ${hit}"
      VIOLATIONS=$((VIOLATIONS + 1))
    done < <(grep -RInE "$pat" "$dir" 2>/dev/null \
      --exclude-dir=node_modules --exclude-dir=.git || true)
  done
}

say "RP porting-doc audit (docs/porting + docs/bundles reference strings)"
scan_dir "$REPO_ROOT/docs/porting"
scan_dir "$REPO_ROOT/docs/bundles"

if [[ "$VIOLATIONS" -eq 0 ]]; then
  ok "no RP/booking reference strings in porting/bundle docs"
  exit 0
fi

warn "found $VIOLATIONS reference line(s) in docs (expected in porting notes; not runtime)"
if [[ "$STRICT" == "1" ]]; then
  echo "❌ RP_STRICT_DOC_PORTING_AUDIT=1 — failing" >&2
  exit 1
fi
exit 0
