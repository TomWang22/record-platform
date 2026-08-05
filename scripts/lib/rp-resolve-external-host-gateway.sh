#!/usr/bin/env bash
# Compatibility wrapper — prefer rp-resolve-external-dependency-endpoint.sh.
# Emergency hostAliases must not silently choose between Colima VM IP and macOS gateway.
# shellcheck disable=SC1091
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=rp-resolve-external-dependency-endpoint.sh
source "$SCRIPT_DIR/rp-resolve-external-dependency-endpoint.sh"
