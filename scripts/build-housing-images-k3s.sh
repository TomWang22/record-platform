#!/usr/bin/env bash
# Deprecated name — use build-record-platform-images-k3s.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/build-record-platform-images-k3s.sh" "$@"
