#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
grep -q 'namespace delete skipped by policy' scripts/bootstrap-cluster.sh
grep -q 'kafka-ssl-secret deferred until Kafka LB IPs exist' scripts/ensure-rp-cluster-secrets.sh
! grep -q 'BOOTSTRAP_SKIP_NS_DELETE=0 without BOOTSTRAP_FORCE_NS_DELETE — skipping delete' scripts/bootstrap-cluster.sh
! grep -q 'kafka-ssl-secret not applied (no MetalLB IPs)' scripts/ensure-rp-cluster-secrets.sh
echo "✅ test-rp-bootstrap-warning-policy.sh"
