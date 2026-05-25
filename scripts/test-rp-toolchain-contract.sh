#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
grep -q 'rp_ensure_node_pnpm' scripts/lib/rp-ensure-node-pnpm.sh
grep -q '22.13' package.json
grep -q 'pnpm@11.1.3' package.json
[[ "$(tr -d '[:space:]' <.nvmrc)" == "22" ]]
grep -q 'dangerously-allow-all-builds=true' .npmrc
grep -q 'rp-pnpm-ci-install' scripts/rp-verify-toolchain-contract.sh
bash -n scripts/rp-verify-toolchain-contract.sh
echo "✅ test-rp-toolchain-contract.sh"
