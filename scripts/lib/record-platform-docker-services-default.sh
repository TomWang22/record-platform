#!/usr/bin/env bash
# Default Docker build service list for Record Platform (no excluded peers; webapp appended once at call sites).
set -euo pipefail
_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/rp-active-image-targets.sh
source "$_LIB_DIR/rp-active-image-targets.sh"
RECORD_PLATFORM_DOCKER_SERVICES_DEFAULT="${RP_DOCKER_BUILD_SERVICES[*]}"
HOUSING_DOCKER_SERVICES_DEFAULT="$RECORD_PLATFORM_DOCKER_SERVICES_DEFAULT"
