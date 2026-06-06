#!/usr/bin/env bash
# Machine-verifiable RP toolchain contract (Node 22 + pnpm 11.1.3).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$REPO_ROOT"

# shellcheck source=scripts/lib/rp-ensure-node-pnpm.sh
source "$SCRIPT_DIR/lib/rp-ensure-node-pnpm.sh"

fail() { echo "❌ $*" >&2; exit 1; }
ok() { echo "✅ $*"; }

rp_ensure_node_pnpm "$REPO_ROOT" || fail "rp_ensure_node_pnpm failed"

nv="$(node -v)"
pv="$(pnpm --version | tr -d '[:space:]')"
[[ "$pv" == "11.1.3" ]] || fail "pnpm must be 11.1.3 (got $pv)"
_rp_node_version_in_contract "$nv" || fail "node must be >=22.13 <23 (got $nv)"

pm="$(node -e "const p=require('./package.json'); process.stdout.write(p.packageManager||'')")"
[[ "$pm" == "pnpm@11.1.3" ]] || fail "packageManager must be pnpm@11.1.3 (got $pm)"

eng="$(node -e "const p=require('./package.json'); process.stdout.write(p.engines?.node||'')")"
[[ "$eng" == *"22.13"* ]] || fail "engines.node must require >=22.13 (got $eng)"

[[ -f pnpm-lock.yaml ]] || fail "missing pnpm-lock.yaml"
grep -q "^lockfileVersion:" pnpm-lock.yaml || fail "pnpm-lock.yaml missing lockfileVersion"
lv="$(grep '^lockfileVersion:' pnpm-lock.yaml | head -1 | sed "s/.*['\"]\\([^'\"]*\\)['\"].*/\\1/")"
case "$lv" in
  9.0|9) ok "lockfileVersion $lv (pnpm 9+/11 compatible)" ;;
  *) fail "unexpected lockfileVersion $lv (regenerate with pnpm 11.1.3)" ;;
esac

[[ -f pnpm-workspace.yaml ]] || fail "missing pnpm-workspace.yaml"
grep -q '^packages:' pnpm-workspace.yaml || fail "pnpm-workspace.yaml missing packages:"
if grep -qE '^[[:space:]]*"pnpm"[[:space:]]*:[[:space:]]*\{' package.json 2>/dev/null; then
  fail 'package.json must not contain top-level "pnpm": { ... } (use pnpm-workspace.yaml)'
fi

bad_df="$(grep -RlE 'node:20|pnpm@9\.11' "$REPO_ROOT/services" "$REPO_ROOT/webapp" \
  --include='Dockerfile' 2>/dev/null || true)"
if [[ -n "$bad_df" ]]; then
  fail "Dockerfiles must use node:22* and pnpm@11.1.3 (found node:20 or pnpm@9): ${bad_df}"
fi
ok "Dockerfiles: node 22 + pnpm 11.1.3"

[[ -f .npmrc ]] && grep -q 'dangerously-allow-all-builds=true' .npmrc \
  || fail "missing .npmrc dangerously-allow-all-builds=true"
grep -q 'confirm-modules-purge=false' .npmrc \
  || fail "missing .npmrc confirm-modules-purge=false"
grep -q 'dangerouslyAllowAllBuilds: true' pnpm-workspace.yaml \
  || fail "pnpm-workspace.yaml must set dangerouslyAllowAllBuilds: true"
[[ -x scripts/docker/rp-pnpm-ci-install.sh ]] \
  || fail "missing scripts/docker/rp-pnpm-ci-install.sh"

df_bad=""
while IFS= read -r df; do
  [[ -f "$df" ]] || continue
  grep -qE 'node:22' "$df" || continue
  # Workspace pnpm images only (skip npm-only micro-images e.g. transport-watchdog)
  grep -qE 'rp-pnpm -w|pnpm -w' "$df" || continue
  grep -q 'COPY \.npmrc' "$df" || df_bad+="$df (no COPY .npmrc)"$'\n'
  grep -qE 'rp-pnpm-ci-install|rp-pnpm ' "$df" || df_bad+="$df (no rp-pnpm shim)"$'\n'
  frozen_line="$(grep -E 'install --frozen-lockfile' "$df" | grep -v 'no-frozen-lockfile' || true)"
  if [[ -n "$frozen_line" ]] && [[ "$frozen_line" != *"--ignore-scripts"* ]]; then
    df_bad+="$df (frozen install missing --ignore-scripts)"$'\n'
  fi
done < <(find "$REPO_ROOT/services" "$REPO_ROOT/webapp" -name Dockerfile 2>/dev/null)
[[ -z "$df_bad" ]] || fail "Docker pnpm 11 CI contract:${df_bad}"
ok "Dockerfiles: .npmrc + rp-pnpm shim + --ignore-scripts on frozen install"

chmod +x "$SCRIPT_DIR/rp-audit-dockerfiles-pnpm.sh" 2>/dev/null || true
bash "$SCRIPT_DIR/rp-audit-dockerfiles-pnpm.sh" || fail "rp-audit-dockerfiles-pnpm.sh failed"

if [[ "${RP_VERIFY_TOOLCHAIN_SKIP_IMAGE_CONTRACT:-0}" != "1" ]]; then
  chmod +x "$SCRIPT_DIR/rp-verify-image-build-contract.sh" 2>/dev/null || true
  bash "$SCRIPT_DIR/rp-verify-image-build-contract.sh" || fail "rp-verify-image-build-contract.sh failed"
fi

ok "RP toolchain contract OK (node $nv, pnpm $pv)"
