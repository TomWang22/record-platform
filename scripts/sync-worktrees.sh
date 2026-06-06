#!/bin/bash
# Sync required scripts to all worktrees to prevent Cursor worktree errors
set -euo pipefail

MAIN_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKTREES_DIR="$HOME/.cursor/worktrees/record-platform"

if [ ! -d "$WORKTREES_DIR" ]; then
  echo "Worktrees directory not found: $WORKTREES_DIR"
  exit 0
fi

REQUIRED_SCRIPTS=(
  "run-k6-shopping.sh"
  "wait-and-retrieve-k6-results.sh"
  "find-bottlenecks.sh"
  "monitor-bottleneck-tests.sh"
  "analyze-bottlenecks.sh"
)

echo "Syncing scripts to all worktrees..."
for WT in "$WORKTREES_DIR"/*; do
  if [ -d "$WT" ]; then
    WT_NAME=$(basename "$WT")
    mkdir -p "$WT/scripts"
    for SCRIPT in "${REQUIRED_SCRIPTS[@]}"; do
      if [ -f "$MAIN_REPO/scripts/$SCRIPT" ]; then
        if [ ! -f "$WT/scripts/$SCRIPT" ] || [ "$MAIN_REPO/scripts/$SCRIPT" -nt "$WT/scripts/$SCRIPT" ]; then
          cp "$MAIN_REPO/scripts/$SCRIPT" "$WT/scripts/$SCRIPT"
          chmod +x "$WT/scripts/$SCRIPT"
          echo "  ✅ $WT_NAME: $SCRIPT"
        fi
      fi
    done
    # Clean up deleted files from git index
    (cd "$WT" && git ls-files --deleted 2>&1 | xargs -r git rm 2>&1 || true) >/dev/null 2>&1
  fi
done

echo "✅ All worktrees synced"

# Also sync markdown documentation files
REQUIRED_MARKDOWN=(
  "K6_SHOPPING_TEST_STATUS.md"
  "BOTTLENECK_FINDER_README.md"
  "TEST_STATUS.md"
  "STRICT_TLS_PRODUCTION_README.md"
  "SITREP.md"
  "AUTH_SERVICE_INVESTIGATION.md"
  "AUTH_SERVICE_FIXES.md"
  "AUTH_SERVICE_DEPLOYMENT_STATUS.md"
  "GRPC_HEALTH_CHECKS.md"
  "GRPC_HEALTH_PROBES_UPDATE.md"
  "K6_TEST_STATUS_STRICT_TLS.md"
  "K6_SHOPPING_DAILY_CRONJOB.md"
)

echo "Syncing markdown files to all worktrees..."
for WT in "$WORKTREES_DIR"/*; do
  if [ -d "$WT" ]; then
    WT_NAME=$(basename "$WT")
    for MD_FILE in "${REQUIRED_MARKDOWN[@]}"; do
      if [ -f "$MAIN_REPO/$MD_FILE" ]; then
        if [ ! -f "$WT/$MD_FILE" ] || [ "$MAIN_REPO/$MD_FILE" -nt "$WT/$MD_FILE" ]; then
          cp "$MAIN_REPO/$MD_FILE" "$WT/$MD_FILE"
          echo "  ✅ $WT_NAME: $MD_FILE"
        fi
      fi
    done
  fi
done
