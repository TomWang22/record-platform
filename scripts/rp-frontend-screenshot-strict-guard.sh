#!/usr/bin/env bash
# Scan Playwright contract screenshot PNGs for forbidden visible strings.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SHOT_DIR="${SHOT_DIR:-$REPO_ROOT/webapp/e2e/screenshots}"
REPORT="${REPORT:-$REPO_ROOT/bench_logs/frontend-contract/global-screenshot-strict-guard.md}"
CONTRACT_ONLY="${CONTRACT_ONLY:-1}"
CONTRACT_DATE="${CONTRACT_SCREENSHOT_DATE:-$(date -u +%Y-%m-%d)}"

FORBIDDEN=(
  'Loading record'
  'Loading marketplace'
  'Loading revision history'
  'Loading revisions'
  'Loading listing'
  'Loading observation'
  'Listing not found'
  'localStorage'
  'until API is wired'
  'local until'
  'dev-auth'
  'mock'
  'demo'
  'fallback'
  'Provider: dev'
  '\bOCH\b'
  '\bHousing\b'
  'Format: apartment'
  'Dashboard Welcome back'
  '\bLIVE MODE\b'
  '\bapartment\b'
  '\blandlord\b'
  '\bTenant\b'
  '\btenant\b'
  'off-campus'
  '\blease\b'
  '\bbooking\b'
  '\brent\b'
  '\bfurnished\b'
  'residence_type'
  'To User ID'
  'Record ID'
  'P2P Messages'
  '"to"'
  '"from"'
)

UUID_RE='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

mkdir -p "$(dirname "$REPORT")"
fail=0
hits=()
scanned=0

scan_dirs=()
if [[ "$CONTRACT_ONLY" == "1" ]]; then
  scan_dirs=(
    "$SHOT_DIR/authenticated/$CONTRACT_DATE"
    "$SHOT_DIR/guest/$CONTRACT_DATE"
  )
else
  scan_dirs=("$SHOT_DIR")
fi

for dir in "${scan_dirs[@]}"; do
  [[ -d "$dir" ]] || continue
  while IFS= read -r -d '' f; do
    scanned=$((scanned + 1))
    text="$(strings -n 6 "$f" 2>/dev/null | LC_ALL=C grep -E '^[A-Za-z0-9][A-Za-z0-9 ,.;:()$\/\-]{4,}$' || true)"
    for pat in "${FORBIDDEN[@]}"; do
      # PNG `strings` can embed coincidental tokens (e.g. j-RP:R); require space-delimited RP/Housing.
      case "$pat" in
        '\bOCH\b') scan_pat='(^|[[:space:]])RP([[:space:]]|$)' ;;
        '\bHousing\b') scan_pat='(^|[[:space:]])Housing([[:space:]]|$)' ;;
        *) scan_pat="$pat" ;;
      esac
      if printf '%s' "$text" | grep -qiE "$scan_pat"; then
        hits+=("$f: matched /$pat/i")
        fail=1
      fi
    done
    if printf '%s' "$text" | grep -qiE "$UUID_RE"; then
      hits+=("$f: matched UUID in visible text")
      fail=1
    fi
  done < <(find "$dir" -maxdepth 1 -name '*.png' -print0 2>/dev/null)
done

{
  echo "# Global screenshot strict guard"
  echo ""
  echo "Scanned: \`${scan_dirs[*]}\` (CONTRACT_ONLY=$CONTRACT_ONLY)"
  echo "Contract date: \`$CONTRACT_DATE\`"
  echo "PNG count: $scanned"
  echo "Time: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo ""
  if [[ "$fail" -eq 0 ]]; then
    echo "**PASS** — no forbidden strings in screenshot text."
  else
    echo "**FAIL** — forbidden strings detected:"
    echo ""
    for h in "${hits[@]}"; do
      echo "- $h"
    done
  fi
} >"$REPORT"

if [[ "$fail" -ne 0 ]]; then
  echo "Screenshot strict guard FAILED — see $REPORT"
  exit 1
fi
if [[ "$scanned" -eq 0 ]]; then
  echo "Screenshot strict guard: no PNGs in active dated folders (run contract E2E first)"
  exit 1
fi
echo "Screenshot strict guard PASS — $REPORT ($scanned PNGs)"
