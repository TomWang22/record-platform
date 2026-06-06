#!/usr/bin/env bash
# Host-disk PKI only (B.crypto): 3-stage CA + edge/service/envoy/kafka-client leaves.
# Kafka broker JKS + strict-tls-bootstrap run after Colima/namespaces (C.infra / F).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

step() { printf '\n\033[1m▶ %s\033[0m\n' "$*"; }

step "dev-generate-certs.sh (root → intermediate → leaves)"
RP_DEV_CERTS_FORCE="${RP_DEV_CERTS_FORCE:-1}" bash "$SCRIPT_DIR/dev-generate-certs.sh"
unset RP_DEV_CERTS_FORCE

step "generate-envoy-client-cert.sh (before strict-tls-bootstrap)"
bash "$SCRIPT_DIR/generate-envoy-client-cert.sh"

step "print-rp-cert-proof.sh (disk material)"
bash "$SCRIPT_DIR/print-rp-cert-proof.sh"

step "verify-rp-cert-chain.sh (disk PKI only; K8s secrets deferred)"
RP_SKIP_K8S_VERIFY=1 bash "$SCRIPT_DIR/verify-rp-cert-chain.sh"

echo "✅ rp-bootstrap-host-certs complete (broker JKS + K8s secrets deferred until cluster/MetalLB)"
