#!/usr/bin/env bash
# Deprecated name — use rebuild-all-record-platform-images-k3s.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/rebuild-all-record-platform-images-k3s.sh" "$@"
