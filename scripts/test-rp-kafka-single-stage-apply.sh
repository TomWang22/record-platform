#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
grep -q 'P5b run id:' scripts/apply-kafka-kraft-staged.sh
grep -q 'RP_KAFKA_STAGED_APPLY_GUARD' scripts/bootstrap-cluster.sh
grep -q 'RP_KAFKA_STAGED_APPLY_GUARD' scripts/cold-bootstrap.sh
grep -q 'verify-only (P5b already ran' scripts/lib/rp-cold-bootstrap-kafka-tls.sh
grep -q 'apply-kafka-kraft-staged.sh' scripts/bootstrap-cluster.sh
echo "✅ test-rp-kafka-single-stage-apply.sh"
