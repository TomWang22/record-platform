#!/usr/bin/env bash
# Ensure contract screenshot proof uses only the active dated folders (no undated PNGs).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SHOT_ROOT="${SHOT_ROOT:-$REPO_ROOT/webapp/e2e/screenshots}"
REPORT="${REPORT:-$REPO_ROOT/bench_logs/frontend-contract/screenshot-current-proof.md}"
CONTRACT_DATE="${CONTRACT_SCREENSHOT_DATE:-$(date -u +%Y-%m-%d)}"

fail=0
notes=()

_auth="$SHOT_ROOT/authenticated"
_guest="$SHOT_ROOT/guest"
_active_auth="$_auth/$CONTRACT_DATE"
_active_guest="$_guest/$CONTRACT_DATE"

mkdir -p "$(dirname "$REPORT")"

if find "$_auth" -maxdepth 1 -name '*.png' 2>/dev/null | grep -q .; then
  notes+=("Undated PNGs remain in \`authenticated/\` root")
  fail=1
fi
if find "$_guest" -maxdepth 1 -name '*.png' 2>/dev/null | grep -q .; then
  notes+=("Undated PNGs remain in \`guest/\` root")
  fail=1
fi

auth_count=0
guest_count=0
[[ -d "$_active_auth" ]] && auth_count=$(find "$_active_auth" -maxdepth 1 -name '*.png' 2>/dev/null | wc -l | tr -d ' ')
[[ -d "$_active_guest" ]] && guest_count=$(find "$_active_guest" -maxdepth 1 -name '*.png' 2>/dev/null | wc -l | tr -d ' ')

if [[ "$auth_count" -eq 0 && "$guest_count" -eq 0 ]]; then
  notes+=("No PNGs in active dated folders for $CONTRACT_DATE")
  fail=1
fi

{
  echo "# Screenshot current proof (staleness)"
  echo ""
  echo "Time (UTC): $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Contract date: \`$CONTRACT_DATE\`"
  echo ""
  echo "## Active proof paths (only these scanned by strict guard)"
  echo "- \`$_active_auth\` — $auth_count PNGs"
  echo "- \`$_active_guest\` — $guest_count PNGs"
  echo ""
  echo "## Staleness rules"
  echo "- No undated PNGs under \`authenticated/\` or \`guest/\` roots"
  echo "- Strict guard (\`CONTRACT_ONLY=1\`) scans dated folders only"
  echo "- Older dated folders archived under \`screenshots/_archive/\`"
  echo ""
  if [[ "$fail" -eq 0 ]]; then
    echo "**PASS** — contract screenshots are current (dated $CONTRACT_DATE only)."
    echo ""
    echo "Strict guard companion: \`make rp-frontend-screenshot-strict-contract\`"
  else
    echo "**FAIL**"
    for n in "${notes[@]}"; do
      echo "- $n"
    done
  fi
} >"$REPORT"

if [[ "$fail" -ne 0 ]]; then
  echo "Screenshot staleness check FAILED — $REPORT"
  exit 1
fi
echo "Screenshot staleness check PASS — $REPORT ($auth_count + $guest_count PNGs)"
exit 0
