#!/usr/bin/env bash
# Audit active service/webapp Dockerfiles for pnpm 11 Docker contract (CI, deploy --legacy, no broken shell).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
FAIL=0

fail() { echo "❌ $*" >&2; FAIL=1; }

grep -q 'forceLegacyDeploy: true' pnpm-workspace.yaml \
  || fail "pnpm-workspace.yaml must set pnpm.forceLegacyDeploy: true"
grep -q 'force-legacy-deploy=true' .npmrc \
  || fail ".npmrc must set force-legacy-deploy=true"

while IFS= read -r df; do
  [[ -f "$df" ]] || continue
  grep -qE 'node:22' "$df" || continue
  # npm-only micro-images (no workspace pnpm)
  grep -qE 'rp-pnpm -w|pnpm -w' "$df" || continue

  rel="${df#"$ROOT"/}"

  grep -q 'COPY \.npmrc' "$df" \
    || fail "$rel: missing COPY .npmrc (pnpm 11 config in Docker)"
  grep -qE 'rp-pnpm-ci-install|/usr/local/bin/rp-pnpm' "$df" \
    || fail "$rel: missing rp-pnpm CI shim in deps stage"

  if grep -qE 'rp-pnpm -w|pnpm -w' "$df"; then
    grep -qE 'install --frozen-lockfile --ignore-scripts|install --no-frozen-lockfile --ignore-scripts' "$df" \
      || fail "$rel: workspace install must use --ignore-scripts"
  fi

  if grep -qE 'pnpm deploy|rp-pnpm deploy' "$df"; then
    grep -qE '(pnpm|rp-pnpm) deploy.*--legacy' "$df" \
      || fail "$rel: pnpm deploy must include --legacy (pnpm 11 ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE)"
    grep -q 'rp-pnpm deploy' "$df" \
      || fail "$rel: use rp-pnpm deploy in build stage (pnpm 11 ignored-builds in deploy install)"
    build_block="$(awk '/^FROM .* AS build/{found=1; next} found && /^FROM /{exit} found{print}' "$df")"
    echo "$build_block" | grep -q 'rp-pnpm-ci-install' \
      || fail "$rel: build stage must COPY rp-pnpm-ci-install.sh when using deploy"
  fi

  if grep -qE '#.*--config\.confirmModulesPurge' "$df"; then
    fail "$rel: confirmModulesPurge glued to shell comment (breaks if/else)"
  fi

  if grep -qE 'pnpm.*(prune|install|deploy)' "$df" && ! grep -qE 'ENV CI=true|CI=true' "$df"; then
    fail "$rel: pnpm prune/install/deploy without ENV CI=true"
  fi

  frozen_line="$(grep -E 'install --frozen-lockfile' "$df" | grep -v 'no-frozen-lockfile' || true)"
  if [[ -n "$frozen_line" ]] && [[ "$frozen_line" != *"--ignore-scripts"* ]]; then
    fail "$rel: frozen-lockfile install missing --ignore-scripts"
  fi

  # Stage boundary readability (catch RUN line merged into next FROM comment)
  if grep -qE '^[[:space:]]*(rp-pnpm|pnpm).*(install|prune).*$' "$df"; then
    while IFS= read -r n; do
      [[ -n "$n" ]] || continue
      next=$((n + 1))
      line="$(sed -n "${n}p" "$df")"
      nline="$(sed -n "${next}p" "$df" 2>/dev/null || true)"
      if [[ "$line" == *install* ]] && [[ "$nline" == \#*build* ]]; then
        fail "$rel:${n}: RUN install line immediately followed by build-stage comment (missing newline)"
      fi
    done < <(grep -nE 'install --.*--ignore-scripts' "$df" | cut -d: -f1)
  fi
done < <(find "$ROOT/services" "$ROOT/webapp" -name Dockerfile 2>/dev/null | sort)

webapp_df="$ROOT/webapp/Dockerfile"
if [[ -f "$webapp_df" ]]; then
  nc="$(find "$ROOT/webapp" -maxdepth 1 -name 'next.config.*' | head -1)"
  [[ -n "$nc" ]] && grep -qE "output:[[:space:]]*['\"]standalone['\"]" "$nc" \
    || fail "webapp: next.config must set output: standalone"
  grep -q 'test -d /app/webapp/.next/standalone' "$webapp_df" \
    || fail "webapp/Dockerfile: missing .next/standalone gate after build"
  if grep -qE 'pnpm build.*\|.*tee|tee.*next-build' "$webapp_df"; then
    fail "webapp/Dockerfile: do not pipe pnpm build to tee (masks exit code)"
  fi
  build_block="$(awk '/^FROM .* AS build/{found=1; next} found && /^FROM /{exit} found{print}' "$webapp_df")"
  if echo "$build_block" | grep -qE 'prune --prod'; then
    if ! echo "$build_block" | grep -q 'test -d /app/webapp/.next/standalone'; then
      fail "webapp/Dockerfile: prune --prod in build without standalone gate"
    fi
  fi
fi

if [[ "$FAIL" -ne 0 ]]; then
  echo "❌ rp-audit-dockerfiles-pnpm failed" >&2
  exit 1
fi
echo "✅ rp-audit-dockerfiles-pnpm OK"
