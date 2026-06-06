#!/usr/bin/env bash
# Generate RP dev PKI from cert contract (root -> intermediate -> all leaves).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=lib/rp-dev-ca.sh
source "$SCRIPT_DIR/lib/rp-dev-ca.sh"
# shellcheck source=lib/rp-service-cert-contract.sh
source "$SCRIPT_DIR/lib/rp-service-cert-contract.sh"

CERTS="$REPO_ROOT/certs"
KAFKA_DEV="$CERTS/kafka-dev"
TMP="${REPO_ROOT}/.dev-certs-tmp.$$"
mkdir -p "$CERTS" "$KAFKA_DEV" "$TMP"
trap 'rm -rf "$TMP"' EXIT

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }

command -v openssl >/dev/null 2>&1 || { echo "❌ openssl required"; exit 1; }
rp_dev_bootstrap_chain

say "=== Dev certs (strict TLS, no plaintext) ==="

say "1. PKI anchors (root + intermediate)..."
ok "Dev anchors ready: dev-root.pem, dev-intermediate.pem, dev-chain.pem"

say "2. Creating edge leaf ($(rp_cert_contract_edge_cn))..."
cat > "$TMP/edge.ext" <<EOF
[v3_edge]
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = DNS:$(rp_cert_contract_edge_cn)
EOF
rp_dev_sign_leaf \
  "$CERTS/$(rp_cert_contract_edge_cn).crt" \
  "$CERTS/$(rp_cert_contract_edge_cn).key" \
  "/CN=$(rp_cert_contract_edge_cn)/O=Record Platform" \
  "$TMP/edge.ext"
ok "$(rp_cert_contract_edge_cn).crt, .key"

say "3. Creating service mTLS leaves from contract..."
while IFS= read -r svc; do
  [[ -n "$svc" ]] || continue
  cn="$(rp_cert_contract_common_name "$svc")"
  sans="$(rp_cert_contract_sans_for_service "$svc")"
  cat > "$TMP/${svc}.ext" <<EOF
[v3_service]
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth, clientAuth
subjectAltName = ${sans}
EOF
  rp_dev_sign_leaf \
    "$CERTS/${svc}.crt" \
    "$CERTS/${svc}.key" \
    "/CN=${cn}/O=Record Platform" \
    "$TMP/${svc}.ext"
  ok "${svc}.crt, .key"
done < <(rp_cert_contract_mtls_services)

say "4. Creating Kafka client leaf (kafka-dev)..."
cp "$(rp_dev_root_pem)" "$KAFKA_DEV/ca.pem"
cat > "$TMP/kafka-client.ext" <<'EOF'
[v3_client]
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = clientAuth
EOF
rp_dev_sign_leaf \
  "$KAFKA_DEV/client.crt" \
  "$KAFKA_DEV/client.key" \
  "/CN=kafka-client/O=Record Platform" \
  "$TMP/kafka-client.ext"
ok "kafka-dev/ca.pem, client.crt, client.key"

say "=== Dev certs done ==="
echo "  CA: certs/dev-root.pem, certs/dev-intermediate.pem, certs/dev-chain.pem"
echo "  Edge: certs/$(rp_cert_contract_edge_cn).{crt,key}"
echo "  Service mTLS leaves: certs/<service>.{crt,key} for all certPolicy.mtlsServices"
echo "  Kafka client (Node): certs/kafka-dev/ca.pem, client.crt, client.key"
