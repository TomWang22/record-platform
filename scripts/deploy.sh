#!/usr/bin/env bash
set -euo pipefail

# Wrapper script for GitHub Actions workflow
# Calls bootstrap-platform.sh to deploy the platform

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# For GitHub Actions, we want a simpler deployment
# Use bootstrap-platform.sh which handles everything
exec "$REPO_ROOT/scripts/bootstrap-platform.sh" "$@"

