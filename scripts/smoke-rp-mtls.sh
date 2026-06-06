#!/usr/bin/env bash
# Smoke /mtls-healthz: no cert fails, valid client cert succeeds.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib/edge-test-url.sh
source "$SCRIPT_DIR/lib/edge-test-url.sh"

CERT_DIR="${RP_MTLS_TEST_CERT_DIR:-$REPO_ROOT/certs/mtls-test}"
CA="${NODE_EXTRA_CA_CERTS:-$REPO_ROOT/certs/dev-root.pem}"
BASE="$(edge_normalize_e2e_api_base)"
REPORT_DIR="${REPORT_DIR:-$REPO_ROOT/bench_logs/security-contract}"
REPORT="$REPORT_DIR/mtls-contract.md"

mkdir -p "$REPORT_DIR"
chmod +x "$SCRIPT_DIR/generate-rp-mtls-test-certs.sh" 2>/dev/null || true
"$SCRIPT_DIR/generate-rp-mtls-test-certs.sh"

no_cert_ok=0
with_cert_ok=0

no_code=$(curl -sS --cacert "$CA" -o /dev/null -w "%{http_code}" "$BASE/mtls-healthz" 2>/dev/null || echo "err")
if [[ "$no_code" == "401" || "$no_code" == "403" ]]; then
  no_cert_ok=1
fi

with_code=$(curl -sS --cacert "$CA" --cert "$CERT_DIR/client.pem" --key "$CERT_DIR/client.key" \
  -o /dev/null -w "%{http_code}" "$BASE/mtls-healthz" 2>/dev/null || echo "err")
if [[ "$with_code" == "200" ]]; then
  with_cert_ok=1
fi

{
  echo "# mTLS contract — /mtls-healthz"
  echo ""
  echo "Host: \`$BASE\`"
  echo "Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo ""
  echo "## Results"
  echo ""
  echo "| Probe | HTTP | Expected | Pass |"
  echo "|-------|------|----------|------|"
  echo "| No client cert | $no_code | 401 or 403 | $([[ $no_cert_ok -eq 1 ]] && echo yes || echo no) |"
  echo "| Valid client cert | $with_code | 200 | $([[ $with_cert_ok -eq 1 ]] && echo yes || echo no) |"
  echo ""
  echo "## Prerequisites"
  echo ""
  echo "1. \`./scripts/generate-rp-mtls-test-certs.sh\`"
  echo "2. Mount \`certs/mtls-test/mtls-test-ca.pem\` on caddy-h3 as \`/etc/caddy/mtls-test/mtls-test-ca.pem\`"
  echo "3. Caddyfile: \`client_auth verify_if_given\` + \`/mtls-healthz\` route"
  echo ""
  echo "## Summary"
  echo ""
  if [[ $no_cert_ok -eq 1 && $with_cert_ok -eq 1 ]]; then
    echo "**PASS** — mTLS protected route behaves as expected."
  else
    echo "**FAIL** — see HTTP codes above; redeploy Caddy with updated Caddyfile + CA mount."
  fi
} >"$REPORT"

if [[ $no_cert_ok -eq 1 && $with_cert_ok -eq 1 ]]; then
  echo "mTLS smoke PASS — $REPORT"
  exit 0
fi
echo "mTLS smoke FAILED — $REPORT" >&2
exit 1
