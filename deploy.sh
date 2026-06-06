#!/usr/bin/env bash
set -euo pipefail

# Wrapper script for GitHub Actions workflow
# Calls bootstrap-platform.sh to deploy the platform

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# For GitHub Actions, we want a simpler deployment
# Use bootstrap-platform.sh which handles everything
exec "$SCRIPT_DIR/scripts/bootstrap-platform.sh" "$@"

