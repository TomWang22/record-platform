#!/usr/bin/env bash
# Generate untrusted (foreign) PKI fixtures for live Kafka denial tests.
# Keys stay under certs/ (gitignored). Never commit private keys.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT="${REPO_ROOT}/certs/kafka-client/_fixtures/untrusted"
mkdir -p "$OUT"

# Prefer OpenSSL 3 in docker for consistent extensions
OPENSSL=(docker run --rm -v "${REPO_ROOT}/certs:/certs" -w /certs alpine/openssl)

# Foreign root
"${OPENSSL[@]}" genrsa -out kafka-client/_fixtures/untrusted/foreign-root.key 2048 >/dev/null
"${OPENSSL[@]}" req -x509 -new -key kafka-client/_fixtures/untrusted/foreign-root.key \
  -out kafka-client/_fixtures/untrusted/foreign-root.pem -days 3650 \
  -subj "/CN=rp-untrusted-fixture-root/O=Untrusted Fixture/C=US" >/dev/null

# Foreign intermediate
"${OPENSSL[@]}" genrsa -out kafka-client/_fixtures/untrusted/foreign-int.key 2048 >/dev/null
"${OPENSSL[@]}" req -new -key kafka-client/_fixtures/untrusted/foreign-int.key \
  -out kafka-client/_fixtures/untrusted/foreign-int.csr \
  -subj "/CN=rp-untrusted-fixture-intermediate/O=Untrusted Fixture/C=US" >/dev/null
cat >"$OUT/foreign-int.ext" <<'EOF'
basicConstraints=critical,CA:TRUE,pathlen:0
keyUsage=critical,keyCertSign,cRLSign
EOF
"${OPENSSL[@]}" x509 -req -in kafka-client/_fixtures/untrusted/foreign-int.csr \
  -CA kafka-client/_fixtures/untrusted/foreign-root.pem \
  -CAkey kafka-client/_fixtures/untrusted/foreign-root.key -CAcreateserial \
  -out kafka-client/_fixtures/untrusted/foreign-int.pem -days 1825 -sha256 \
  -extfile kafka-client/_fixtures/untrusted/foreign-int.ext >/dev/null

# Leaf signed by foreign intermediate (UNTRUSTED_INTERMEDIATE presentation chain)
"${OPENSSL[@]}" genrsa -out kafka-client/_fixtures/untrusted/untrusted-int-leaf.key 2048 >/dev/null
"${OPENSSL[@]}" req -new -key kafka-client/_fixtures/untrusted/untrusted-int-leaf.key \
  -out kafka-client/_fixtures/untrusted/untrusted-int-leaf.csr \
  -subj "/CN=analytics-service/O=Record Platform" >/dev/null
cat >"$OUT/untrusted-int-leaf.ext" <<'EOF'
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=clientAuth
subjectAltName=DNS:analytics-service,URI:spiffe://record-platform/service/analytics-service
EOF
"${OPENSSL[@]}" x509 -req -in kafka-client/_fixtures/untrusted/untrusted-int-leaf.csr \
  -CA kafka-client/_fixtures/untrusted/foreign-int.pem \
  -CAkey kafka-client/_fixtures/untrusted/foreign-int.key -CAcreateserial \
  -out kafka-client/_fixtures/untrusted/untrusted-int-leaf.crt -days 30 -sha256 \
  -extfile kafka-client/_fixtures/untrusted/untrusted-int-leaf.ext >/dev/null

# Leaf signed directly by foreign root (UNTRUSTED_CLIENT_LEAF — no approved trust)
"${OPENSSL[@]}" genrsa -out kafka-client/_fixtures/untrusted/untrusted-client-leaf.key 2048 >/dev/null
"${OPENSSL[@]}" req -new -key kafka-client/_fixtures/untrusted/untrusted-client-leaf.key \
  -out kafka-client/_fixtures/untrusted/untrusted-client-leaf.csr \
  -subj "/CN=analytics-service/O=Record Platform" >/dev/null
cat >"$OUT/untrusted-client-leaf.ext" <<'EOF'
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=clientAuth
subjectAltName=DNS:analytics-service,URI:spiffe://record-platform/service/analytics-service
EOF
"${OPENSSL[@]}" x509 -req -in kafka-client/_fixtures/untrusted/untrusted-client-leaf.csr \
  -CA kafka-client/_fixtures/untrusted/foreign-root.pem \
  -CAkey kafka-client/_fixtures/untrusted/foreign-root.key -CAcreateserial \
  -out kafka-client/_fixtures/untrusted/untrusted-client-leaf.crt -days 30 -sha256 \
  -extfile kafka-client/_fixtures/untrusted/untrusted-client-leaf.ext >/dev/null

# Chain PEMs for presentation (leaf + foreign intermediate; never the approved RP intermediate)
cat "$OUT/untrusted-int-leaf.crt" "$OUT/foreign-int.pem" >"$OUT/untrusted-int-chain.pem"

echo "✅ untrusted fixtures in ${OUT}"
openssl x509 -in "$OUT/untrusted-int-leaf.crt" -noout -fingerprint -sha256 | sed 's/^/untrusted-int-leaf /'
openssl x509 -in "$OUT/untrusted-client-leaf.crt" -noout -fingerprint -sha256 | sed 's/^/untrusted-client-leaf /'
# Prove they do NOT verify against platform root
openssl verify -CAfile "${REPO_ROOT}/certs/dev-root.pem" -untrusted "${REPO_ROOT}/certs/dev-intermediate.pem" \
  "$OUT/untrusted-int-leaf.crt" 2>&1 | sed 's/^/platform_verify_untrusted_int_leaf /' || true
openssl verify -CAfile "${REPO_ROOT}/certs/dev-root.pem" \
  "$OUT/untrusted-client-leaf.crt" 2>&1 | sed 's/^/platform_verify_untrusted_client_leaf /' || true
