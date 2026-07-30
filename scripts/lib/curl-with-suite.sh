#!/usr/bin/env bash
# Canonical curl wrapper for **edge / gateway** traffic: always sends `x-suite` (default bash).
# Source from any script:
#   SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
#   # shellcheck source=scripts/lib/curl-with-suite.sh
#   source "$REPO_ROOT/scripts/lib/curl-with-suite.sh"
#   rp_curl_suite -sfS --cacert "$CA" "https://record-platform.test/api/readyz"
# Infra / bootstrap / HAProxy-style probes (strict gateway — no x-suite required):
#   rp_curl_infra -sfS --cacert "$CA" "https://record-platform.test/api/readyz"
# In-pod loopback to gateway :4020 (strict — no x-suite required):
#   rp_curl_internal -sfS "http://127.0.0.1:4020/healthz"
#
# Env: RP_X_SUITE — vitest | bash | k6 | playwright (default bash for shell probes).
set -euo pipefail

: "${RP_X_SUITE:=bash}"
if [[ -z "${RP_X_SUITE// }" ]]; then
  echo "❌ RP_X_SUITE is empty; refusing unlabeled gateway traffic." >&2
  return 2 2>/dev/null || exit 2
fi

rp_curl_suite() {
  curl -H "x-suite: ${RP_X_SUITE}" "$@"
}

rp_curl_infra() {
  curl -H "x-traffic-class: infra" "$@"
}

rp_curl_internal() {
  curl -H "x-traffic-class: internal" "$@"
}
