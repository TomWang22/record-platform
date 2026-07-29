#!/usr/bin/env bash
# Install repo-owned git hooks (reject Cursor attribution; do not inject).
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOOKS_SRC="$REPO_ROOT/scripts/git-hooks"
HOOKS_DST="$(git -C "$REPO_ROOT" rev-parse --git-path hooks)"

mkdir -p "$HOOKS_DST"
install -m 0755 "$HOOKS_SRC/commit-msg" "$HOOKS_DST/commit-msg"
# Defensive: never install a prepare-commit-msg that mutates attribution.
if [[ -f "$HOOKS_DST/prepare-commit-msg" ]]; then
  if rg -qi 'cursoragent|co-authored-by:.*cursor|generated-by:.*cursor' "$HOOKS_DST/prepare-commit-msg"; then
    echo "Removing Cursor-injecting prepare-commit-msg from $HOOKS_DST" >&2
    rm -f "$HOOKS_DST/prepare-commit-msg"
  fi
fi

echo "Installed commit-msg reject hook at $HOOKS_DST/commit-msg"
