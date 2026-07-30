#!/usr/bin/env bash
# Deprecated name (RP) — use rebuild-record-platform-images-and-rollout.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/rebuild-record-platform-images-and-rollout.sh" "$@"
