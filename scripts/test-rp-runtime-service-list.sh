#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
bash scripts/rp-audit-runtime-service-list.sh
grep -q 'booking-service' scripts/lib/record-platform-docker-services-default.sh && exit 1 || true
grep -q 'rp-audit-runtime-service-list' scripts/cold-bootstrap.sh
echo "✅ test-rp-runtime-service-list.sh"
