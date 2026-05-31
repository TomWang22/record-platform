#!/usr/bin/env bash
# Run webapp Playwright specs (service / edge health). Repo root.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WEBAPP="$REPO_ROOT/webapp"

if [[ ! -f "$WEBAPP/package.json" ]]; then
  echo "webapp/package.json not found" >&2
  exit 1
fi

if [[ ! -f "$WEBAPP/playwright.config.ts" ]]; then
  echo "webapp/playwright.config.ts missing — add @playwright/test to webapp" >&2
  exit 1
fi

export E2E_API_BASE="${E2E_API_BASE:-https://record-platform.test}"

cd "$WEBAPP"
if ! pnpm exec playwright --version >/dev/null 2>&1; then
  echo "Install Playwright: pnpm -C webapp add -D @playwright/test && pnpm -C webapp exec playwright install" >&2
  exit 1
fi

echo "E2E_API_BASE=$E2E_API_BASE"
exec pnpm exec playwright test "$@"
