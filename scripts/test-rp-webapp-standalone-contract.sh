#!/usr/bin/env bash
# Webapp Next standalone contract: config, optional host build, optional docker build.
#
# Modes (RP_WEBAPP_CONTRACT_MODE):
#   static — verify next.config, package.json, Dockerfile gates only (no docker build)
#   docker — static checks + optional host pnpm build + docker build (default outside cold-bootstrap)
#
# Legacy env (still honored):
#   RP_WEBAPP_CONTRACT_SKIP_BUILD=1  — skip host pnpm build
#   RP_WEBAPP_CONTRACT_SKIP_DOCKER=1 — skip docker build
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$REPO_ROOT"

fail() { echo "❌ $*" >&2; exit 1; }
ok() { echo "✅ $*"; }

if [[ "${RP_SKIP_WEBAPP_STANDALONE_CONTRACT:-0}" == "1" ]]; then
  ok "skip (RP_SKIP_WEBAPP_STANDALONE_CONTRACT=1)"
  exit 0
fi

_mode="${RP_WEBAPP_CONTRACT_MODE:-docker}"
if [[ "${RP_COLD_BOOTSTRAP:-0}" == "1" ]] || [[ "${RP_COLD_BOOTSTRAP_ACTIVE:-0}" == "1" ]]; then
  _mode="${RP_WEBAPP_CONTRACT_MODE:-static}"
fi

case "$_mode" in
  static|docker) ;;
  *) fail "RP_WEBAPP_CONTRACT_MODE must be static or docker (got: $_mode)" ;;
esac

echo "test-rp-webapp-standalone-contract (mode=${_mode})"

# shellcheck source=scripts/lib/rp-ensure-node-pnpm.sh
source "$SCRIPT_DIR/lib/rp-ensure-node-pnpm.sh"
rp_ensure_node_pnpm "$REPO_ROOT" || fail "rp_ensure_node_pnpm failed"

nc="$(find webapp -maxdepth 1 -name 'next.config.*' | head -1)"
[[ -n "$nc" ]] || fail "webapp/next.config.* missing"
grep -qE "output:[[:space:]]*['\"]standalone['\"]" "$nc" \
  || fail "$nc must set output: 'standalone'"

grep -q '"typescript"' webapp/package.json \
  || fail "webapp/package.json must list typescript in devDependencies"

df="webapp/Dockerfile"
grep -q 'test -d /app/webapp/.next/standalone' "$df" \
  || fail "$df: missing standalone existence gate after build"
grep -qE 'COPY --from=build.*webapp/\.next/standalone' "$df" \
  || fail "$df: runtime must COPY .next/standalone from build"
grep -qE 'set -e[u]?|status=\$\?' "$df" \
  || fail "$df: build must fail fast on next build errors"

ok "static webapp standalone contract (next.config, typescript, Dockerfile gates)"

if [[ "$_mode" == "static" ]]; then
  ok "static mode — no host pnpm build, no docker build"
  ok "test-rp-webapp-standalone-contract.sh"
  exit 0
fi

if [[ "${RP_WEBAPP_CONTRACT_SKIP_BUILD:-0}" != "1" ]]; then
  echo "▶ pnpm -C webapp build"
  pnpm -C webapp build || fail "pnpm -C webapp build failed"
  [[ -d webapp/.next/standalone ]] || fail "webapp/.next/standalone missing after host build"
  [[ -d webapp/.next/static ]] || fail "webapp/.next/static missing after host build"
  ok "host build produced .next/standalone and .next/static"
else
  ok "skip host pnpm build (RP_WEBAPP_CONTRACT_SKIP_BUILD=1)"
fi

if [[ "${RP_WEBAPP_CONTRACT_SKIP_DOCKER:-0}" != "1" ]]; then
  tag="${RP_WEBAPP_CONTRACT_IMAGE:-record-platform-webapp:contract}"
  echo "▶ docker build -f webapp/Dockerfile -t $tag"
  docker build -f webapp/Dockerfile -t "$tag" "$REPO_ROOT" \
    || fail "docker build webapp failed"
  ok "docker build webapp ($tag)"
else
  ok "skip docker build (RP_WEBAPP_CONTRACT_SKIP_DOCKER=1)"
fi

ok "test-rp-webapp-standalone-contract.sh"
