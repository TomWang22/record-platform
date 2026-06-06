# OCH tarball compatibility shim — RP uses record-platform-docker-services-default.sh.
SCRIPT_DIR_OCH_HDS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR_OCH_HDS/record-platform-docker-services-default.sh"
