# Shared default list for RP image builds (no reservation-mesh — RP-only).
# shellcheck source=scripts/lib/record-platform-docker-services-default.sh
SCRIPT_DIR_HDS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR_HDS/record-platform-docker-services-default.sh"
