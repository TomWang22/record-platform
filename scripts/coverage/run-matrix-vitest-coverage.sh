#!/usr/bin/env bash
# Run Vitest with coverage for every service in infra/services-manifest.json (matrix C axis).
# Writes services/<svc>/coverage/coverage-summary.json when json-summary reporter is configured.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
MANIFEST="$ROOT/infra/coverage-services-manifest.json"
if [[ ! -f "$MANIFEST" ]]; then
  MANIFEST="$ROOT/infra/services-manifest.json"
fi
if [[ ! -f "$MANIFEST" ]]; then
  echo "::error::missing coverage or services manifest" >&2
  exit 2
fi
# shellcheck disable=SC2207
SERVICES=($(node -e "const j=require(process.argv[1]); console.log(j.services.join(' '))" "$MANIFEST"))
for svc in "${SERVICES[@]}"; do
  pkg="services/$svc/package.json"
  if [[ ! -f "$pkg" ]]; then
    echo "coverage-matrix-vitest: skip $svc (no package)"
    continue
  fi
  if ! grep -q '"test:coverage"' "$pkg" 2>/dev/null; then
    echo "::error::services/$svc missing scripts.test:coverage in package.json" >&2
    exit 1
  fi
  echo "▶ coverage-matrix-vitest: pnpm -C services/$svc run test:coverage"
  ROLLUP_DISABLE_NATIVE=true pnpm -C "services/$svc" run test:coverage
done
echo "✅ coverage-matrix-vitest: done (${#SERVICES[@]} services)"
