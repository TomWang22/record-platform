#!/usr/bin/env bash
# Envoy upstream mTLS client cert (clientAuth), signed by intermediate CA.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=lib/rp-dev-ca.sh
source "$SCRIPT_DIR/lib/rp-dev-ca.sh"

OUT_CRT="${OUT_CRT:-certs/envoy-client.crt}"
OUT_KEY="${OUT_KEY:-certs/envoy-client.key}"
TMP="${REPO_ROOT}/.envoy-cert-tmp.$$"
mkdir -p "$TMP" certs
trap 'rm -rf "$TMP"' EXIT

rp_dev_bootstrap_chain

cat > "$TMP/ext.conf" <<'EXT'
[v3_envoy_client]
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = clientAuth
subjectAltName = DNS:envoy,DNS:envoy.record-platform.svc.cluster.local,DNS:envoy-test.envoy-test.svc.cluster.local
EXT

rp_dev_sign_leaf "$OUT_CRT" "$OUT_KEY" "/CN=envoy/O=Record Platform" "$TMP/ext.conf"
chmod 600 "$OUT_KEY" 2>/dev/null || true
rp_dev_verify_leaf_chain "$OUT_CRT" >/dev/null || { echo "❌ envoy client chain verify failed"; exit 1; }
echo "✅ Envoy client cert: $OUT_CRT, $OUT_KEY (clientAuth, 3-stage chain)"
