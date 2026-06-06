#!/usr/bin/env bash
# Helper script to commit using COMMIT_MESSAGE.txt
# Usage: ./scripts/commit.sh [additional files...]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMMIT_MSG_FILE="$REPO_ROOT/COMMIT_MESSAGE.txt"

if [[ ! -f "$COMMIT_MSG_FILE" ]]; then
  echo "❌ COMMIT_MESSAGE.txt not found at $COMMIT_MSG_FILE"
  echo "   Create it first or use: git commit -m 'your message'"
  exit 1
fi

# Check if there are any changes to commit
if ! git diff --quiet HEAD || ! git diff --cached --quiet; then
  # Use -F to read commit message from file
  git commit -F "$COMMIT_MSG_FILE" "$@"
  echo "✅ Committed using COMMIT_MESSAGE.txt"
else
  echo "⚠️  No changes to commit"
  echo "   Staged changes: $(git diff --cached --name-only | wc -l | tr -d ' ')"
  echo "   Unstaged changes: $(git diff --name-only | wc -l | tr -d ' ')"
  exit 1
fi

