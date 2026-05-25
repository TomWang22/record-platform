#!/usr/bin/env bash
# Regression: Dockerfiles must not run pnpm prune/install without CI + confirmModulesPurge=false.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
FAIL=0
while IFS= read -r df; do
  [[ -f "$df" ]] || continue
  grep -qE 'node:22' "$df" || continue
  grep -qE 'rp-pnpm|pnpm ' "$df" || continue
  if ! grep -q 'CONFIRM_MODULES_PURGE=false\|confirm-modules-purge=false\|confirmModulesPurge=false' "$df"; then
    echo "❌ $df: missing confirmModulesPurge / confirm-modules-purge config" >&2
    FAIL=1
    continue
  fi
  if grep -qE 'pnpm.*(prune|install)' "$df" && ! grep -qE 'ENV CI=true|CI=true' "$df"; then
    echo "❌ $df: pnpm prune/install without ENV CI=true" >&2
    FAIL=1
  fi
  if grep -qE '#.*--config\.confirmModulesPurge=false' "$df"; then
    echo "❌ $df: confirmModulesPurge appended to shell comment (breaks if/else)" >&2
    FAIL=1
  fi
done < <(find "$ROOT/services" "$ROOT/webapp" -name Dockerfile 2>/dev/null)
bash -n "$ROOT/scripts/rp-audit-dockerfiles-pnpm.sh"
bash "$ROOT/scripts/rp-audit-dockerfiles-pnpm.sh"

[[ "$FAIL" -eq 0 ]] || exit 1
echo "✅ test-rp-dockerfiles-pnpm-noninteractive.sh"
