#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
AUDIT="$ROOT/scripts/rp-audit-no-localhost-nodeport.sh"
grep -q 'docs/reference RP strings ignored' "$AUDIT"
grep -q 'active runtime network audit OK' "$AUDIT"
! grep -q 'docs/porting' "$AUDIT" || ! grep -q 'SCAN_DIRS=.*docs/porting' "$AUDIT"
bash -n "$AUDIT"
bash -n scripts/rp-audit-porting-docs.sh
echo "✅ test-rp-runtime-audit-scope.sh"
