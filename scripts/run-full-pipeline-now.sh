#!/usr/bin/env bash
# Invoke run-full-pipeline and record that we started.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SENTINEL="$REPO/.run-full-pipeline-started"
echo "started $(date +%Y-%m-%dT%H:%M:%S) pid=$$" > "$SENTINEL"
export PATH="$REPO/scripts/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
cd "$REPO"
exec "$REPO/scripts/run-full-pipeline.sh"
