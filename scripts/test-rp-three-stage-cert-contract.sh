#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
bash -n scripts/rp-verify-three-stage-cert-contract.sh
bash -n scripts/lib/rp-cert-proof.sh
grep -q 'rp_cert_proof_verify_three_stage_anchors' scripts/lib/rp-cert-proof.sh
grep -q 'rp_cert_proof_verify_three_stage_anchors' scripts/print-rp-cert-proof.sh
echo "✅ test-rp-three-stage-cert-contract.sh"
