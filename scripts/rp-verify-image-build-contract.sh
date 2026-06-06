#!/usr/bin/env bash
# Static (and optional docker) contract for all runtime image Dockerfiles before cluster deploy.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$REPO_ROOT"

# shellcheck source=scripts/lib/record-platform-docker-services-default.sh
source "$SCRIPT_DIR/lib/record-platform-docker-services-default.sh"

fail() { echo "❌ $*" >&2; FAIL=1; }
ok() { echo "✅ $*"; }
FAIL=0

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

_audit_dockerfile_pnpm() {
  local df="$1" rel="${df#"$REPO_ROOT"/}"
  grep -qE 'node:22' "$df" || return 0
  grep -qE 'rp-pnpm|pnpm ' "$df" || return 0

  grep -qE 'ENV CI=true|CI=true' "$df" \
    || fail "$rel: pnpm stages require ENV CI=true"
  grep -qE 'CONFIRM_MODULES_PURGE=false|confirm-modules-purge=false|confirmModulesPurge=false' "$df" \
    || fail "$rel: missing confirmModulesPurge=false (non-interactive pnpm 11)"
  grep -q 'COPY \.npmrc' "$df" \
    || fail "$rel: missing COPY .npmrc"
  grep -qE 'rp-pnpm-ci-install|/usr/local/bin/rp-pnpm' "$df" \
    || fail "$rel: missing rp-pnpm CI shim"

  if grep -qE 'install --frozen-lockfile' "$df"; then
    grep -qE 'install --frozen-lockfile.*--ignore-scripts|install --ignore-scripts.*--frozen-lockfile' "$df" \
      || fail "$rel: frozen-lockfile install must use --ignore-scripts"
  fi
}

_audit_webapp() {
  local df="$REPO_ROOT/webapp/Dockerfile"
  local nc
  nc="$(find "$REPO_ROOT/webapp" -maxdepth 1 -name 'next.config.*' | head -1)"
  [[ -n "$nc" ]] || fail "webapp: missing next.config.*"
  grep -qE "output:[[:space:]]*['\"]standalone['\"]" "$nc" \
    || fail "webapp: $nc must set output: 'standalone'"

  if grep -q '"typescript"' "$REPO_ROOT/webapp/package.json" 2>/dev/null; then
    ok "webapp: typescript in package.json devDependencies"
  elif grep -q '"typescript"' "$REPO_ROOT/package.json" 2>/dev/null; then
    ok "webapp: typescript in workspace root devDependencies"
  else
    fail "webapp: typescript must be in webapp or root devDependencies for next build"
  fi

  grep -qE 'COPY --from=build.*webapp/\.next/standalone' "$df" \
    || fail "webapp/Dockerfile: runtime must COPY .next/standalone from build"
  grep -q 'test -d /app/webapp/.next/standalone' "$df" \
    || fail "webapp/Dockerfile: missing test -d /app/webapp/.next/standalone gate after build"

  if grep -qE 'pnpm prune --prod|rp-pnpm.*prune --prod' "$df"; then
    build_block="$(awk '/^FROM .* AS build/{found=1; next} found && /^FROM /{exit} found{print}' "$df")"
    if echo "$build_block" | grep -qE 'prune --prod'; then
      if echo "$build_block" | grep -qE 'test -d /app/webapp/.next/standalone'; then
        local prune_line standalone_line
        prune_line="$(echo "$build_block" | grep -nE 'prune --prod' | head -1 | cut -d: -f1)"
        standalone_line="$(echo "$build_block" | grep -n 'test -d /app/webapp/.next/standalone' | head -1 | cut -d: -f1)"
        if [[ -n "$prune_line" && -n "$standalone_line" && "$prune_line" -lt "$standalone_line" ]]; then
          fail "webapp/Dockerfile: do not prune --prod before standalone output gate"
        fi
      else
        fail "webapp/Dockerfile: prune --prod in build without standalone gate"
      fi
    fi
  fi

  if grep -qE 'pnpm build.*\|.*tee|tee.*next-build' "$df"; then
    fail "webapp/Dockerfile: build must not pipe pnpm build to tee (masks exit code)"
  fi
  grep -qE 'set -e[u]?|status=\$\?' "$df" \
    || fail "webapp/Dockerfile: build RUN must fail fast (set -eu or capture build status)"
}

_dockerfile_for_svc() {
  local svc="$1"
  if [[ "$svc" == "webapp" ]]; then
    echo "$REPO_ROOT/webapp/Dockerfile"
  elif [[ "$svc" == "transport-watchdog" ]]; then
    echo "$REPO_ROOT/services/transport-watchdog/Dockerfile"
  else
    echo "$REPO_ROOT/services/${svc}/Dockerfile"
  fi
}

_image_tag() {
  printf 'rp-preflight/%s:contract' "$1"
}

_build_image() {
  local svc="$1" df tag
  df="$(_dockerfile_for_svc "$svc")"
  tag="$(_image_tag "$svc")"
  echo "  ▶ docker build -f ${df#"$REPO_ROOT"/} -t $tag"
  if docker build -t "$tag" -f "$df" "$REPO_ROOT"; then
    ok "docker build $svc"
  else
    fail "docker build $svc failed (see output above)"
  fi
}

say "RP image build contract (static)"
chmod +x "$SCRIPT_DIR/rp-audit-dockerfiles-pnpm.sh" 2>/dev/null || true
bash "$SCRIPT_DIR/rp-audit-dockerfiles-pnpm.sh" || fail "rp-audit-dockerfiles-pnpm.sh failed"

for svc in $HOUSING_DOCKER_SERVICES_DEFAULT webapp; do
  [[ -n "$svc" ]] || continue
  df="$(_dockerfile_for_svc "$svc")"
  [[ -f "$df" ]] || { fail "missing Dockerfile for $svc ($df)"; continue; }
  _audit_dockerfile_pnpm "$df"
done

_audit_webapp

if [[ "${RP_IMAGE_CONTRACT_BUILD:-0}" == "1" ]]; then
  say "RP image build contract (docker build — RP_IMAGE_CONTRACT_BUILD=1)"
  for svc in $HOUSING_DOCKER_SERVICES_DEFAULT webapp; do
    [[ -n "$svc" ]] || continue
    _build_image "$svc" || true
  done
fi

if [[ "$FAIL" -ne 0 ]]; then
  echo "❌ rp-verify-image-build-contract failed" >&2
  exit 1
fi
ok "rp-verify-image-build-contract OK"
