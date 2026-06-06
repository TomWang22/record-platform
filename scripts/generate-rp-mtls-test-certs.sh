#!/usr/bin/env bash
# Generate dev mTLS test CA + client leaf for /mtls-healthz edge smoke.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT="${RP_MTLS_TEST_CERT_DIR:-$REPO_ROOT/certs/mtls-test}"
DAYS="${RP_MTLS_TEST_CERT_DAYS:-825}"
CN="${RP_MTLS_TEST_CLIENT_CN:-rp-mtls-test-client}"

mkdir -p "$OUT"

if [[ -f "$OUT/mtls-test-ca.pem" && -f "$OUT/client.pem" && -f "$OUT/client.key" ]]; then
  echo "mTLS test certs already exist in $OUT (delete to regenerate)"
  exit 0
fi

openssl genrsa -out "$OUT/mtls-test-ca.key" 4096
openssl req -x509 -new -nodes -key "$OUT/mtls-test-ca.key" -sha256 -days "$DAYS" \
  -subj "/CN=RP mTLS Test CA/O=Record Platform Dev" \
  -out "$OUT/mtls-test-ca.pem"

openssl genrsa -out "$OUT/client.key" 2048
openssl req -new -key "$OUT/client.key" -out "$OUT/client.csr" \
  -subj "/CN=$CN/O=Record Platform Dev"

cat >"$OUT/client-ext.cnf" <<EOF
basicConstraints=CA:FALSE
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=clientAuth
EOF

openssl x509 -req -in "$OUT/client.csr" -CA "$OUT/mtls-test-ca.pem" -CAkey "$OUT/mtls-test-ca.key" \
  -CAcreateserial -out "$OUT/client.pem" -days "$DAYS" -sha256 -extfile "$OUT/client-ext.cnf"

chmod 600 "$OUT"/*.key 2>/dev/null || true
fp="$(openssl x509 -in "$OUT/client.pem" -noout -fingerprint -sha256 | sed 's/sha256 Fingerprint=//')"
echo "Generated mTLS test certs in $OUT"
echo "  CA:     $OUT/mtls-test-ca.pem (mount as /etc/caddy/mtls-test/mtls-test-ca.pem on caddy-h3)"
echo "  Client: $OUT/client.pem + $OUT/client.key"
echo "  Client SHA256 fingerprint (Caddyfile @mtls_ok): $fp"
