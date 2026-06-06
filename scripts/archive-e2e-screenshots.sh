#!/usr/bin/env bash
# Move stale Playwright contract screenshots out of active scan paths.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SHOT_ROOT="$REPO_ROOT/webapp/e2e/screenshots"
ARCHIVE_ROOT="$SHOT_ROOT/_archive"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
ARCHIVE_RUN="$ARCHIVE_ROOT/$STAMP"
ACTIVE_DATE="${CONTRACT_SCREENSHOT_DATE:-$(date -u +%Y-%m-%d)}"

mkdir -p "$ARCHIVE_RUN/authenticated" "$ARCHIVE_RUN/guest"
mkdir -p "$SHOT_ROOT/authenticated/$ACTIVE_DATE" "$SHOT_ROOT/guest/$ACTIVE_DATE"

moved=0

archive_png_tree() {
  local role="$1"
  local src_base="$SHOT_ROOT/$role"
  local dest="$ARCHIVE_RUN/$role"
  [[ -d "$src_base" ]] || return 0

  # Undated PNGs directly under role/
  while IFS= read -r -d '' f; do
    rel="${f#"$src_base"/}"
    mkdir -p "$dest/$(dirname "$rel")"
    mv "$f" "$dest/$rel"
    moved=$((moved + 1))
  done < <(find "$src_base" -maxdepth 1 -name '*.png' -print0 2>/dev/null)

  # Dated folders except the active contract date
  for dir in "$src_base"/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]; do
    [[ -d "$dir" ]] || continue
    base="$(basename "$dir")"
    if [[ "$base" == "$ACTIVE_DATE" ]]; then
      continue
    fi
    mkdir -p "$dest"
    mv "$dir" "$dest/"
    moved=$((moved + 1))
  done
}

archive_png_tree authenticated
archive_png_tree guest

echo "Archived screenshot trees to: $ARCHIVE_RUN (moved_entries=$moved)"
echo "Active contract date: $ACTIVE_DATE"
echo "Active paths:"
echo "  $SHOT_ROOT/authenticated/$ACTIVE_DATE/"
echo "  $SHOT_ROOT/guest/$ACTIVE_DATE/"
