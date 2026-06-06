#!/usr/bin/env bash
# Fail if captured shell output contains failure glyphs (regression guard for sync/prereq scripts).
set -euo pipefail
file="${1:-}"
if [[ -z "$file" || ! -f "$file" ]]; then
  echo "usage: $0 <output-log-file>" >&2
  exit 1
fi
if grep -q '❌' "$file"; then
  echo "FAIL: output contains ❌ — see $file" >&2
  grep '❌' "$file" >&2 || true
  exit 1
fi
exit 0
