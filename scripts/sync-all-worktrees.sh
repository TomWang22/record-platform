#!/bin/bash
# Comprehensive worktree sync script - prevents Cursor worktree errors
# Auto-detects and syncs ALL important files automatically

set -euo pipefail

MAIN_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKTREES_DIR="$HOME/.cursor/worktrees/record-platform"

if [ ! -d "$WORKTREES_DIR" ]; then
  echo "Worktrees directory not found: $WORKTREES_DIR"
  exit 0
fi

echo "🔄 Syncing all worktrees from $MAIN_REPO..."

SYNCED=0
FIXED=0

for WT in "$WORKTREES_DIR"/*; do
  if [ -d "$WT" ]; then
    WT_NAME=$(basename "$WT")
    cd "$WT" || continue
    
    # Sync all .sh scripts from scripts/ directory
    if [ -d "$MAIN_REPO/scripts" ]; then
      mkdir -p scripts
      for script in "$MAIN_REPO/scripts"/*.sh; do
        if [ -f "$script" ]; then
          SCRIPT_NAME=$(basename "$script")
          if [ ! -f "scripts/$SCRIPT_NAME" ] || [ "$script" -nt "scripts/$SCRIPT_NAME" ]; then
            cp "$script" "scripts/$SCRIPT_NAME"
            chmod +x "scripts/$SCRIPT_NAME"
            SYNCED=$((SYNCED + 1))
          fi
        fi
      done
    fi
    
    # Sync all .md files from root
    if [ -d "$MAIN_REPO" ]; then
      for md in "$MAIN_REPO"/*.md; do
        if [ -f "$md" ]; then
          MD_NAME=$(basename "$md")
          if [ ! -f "$MD_NAME" ] || [ "$md" -nt "$MD_NAME" ]; then
            cp "$md" "$MD_NAME"
            SYNCED=$((SYNCED + 1))
          fi
        fi
      done
    fi
    
    # Sync all YAML files from infra/k8s (recursive)
    if [ -d "$MAIN_REPO/infra/k8s" ]; then
      while IFS= read -r -d '' yaml_file; do
        REL_PATH="${yaml_file#$MAIN_REPO/}"
        DIR_PATH=$(dirname "$REL_PATH")
        mkdir -p "$DIR_PATH"
        if [ ! -f "$REL_PATH" ] || [ "$yaml_file" -nt "$REL_PATH" ]; then
          cp "$yaml_file" "$REL_PATH"
          SYNCED=$((SYNCED + 1))
        fi
      done < <(find "$MAIN_REPO/infra/k8s" -type f -name "*.yaml" -o -name "*.yml" 2>/dev/null | head -1000 | tr '\n' '\0' || true)
    fi
    
    # Clean up deleted files from git index
    DELETED=$(git ls-files --deleted 2>&1 | wc -l | tr -d ' ')
    if [ "$DELETED" -gt 0 ]; then
      git ls-files --deleted 2>&1 | xargs -r git rm 2>&1 || true
      FIXED=$((FIXED + DELETED))
    fi
    
    cd - >/dev/null
  fi
done

echo "✅ Sync complete:"
echo "   • Files synced: $SYNCED"
echo "   • Deleted files cleaned: $FIXED"
