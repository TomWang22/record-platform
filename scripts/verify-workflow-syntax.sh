#!/usr/bin/env bash
# Validate GitHub Actions workflow syntax with pinned actionlint.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ACTIONLINT_VERSION="${ACTIONLINT_VERSION:-1.7.7}"
CACHE_DIR="$REPO_ROOT/.cache/actionlint"
BIN="$CACHE_DIR/actionlint"

_fail() {
  echo "verify-workflow-syntax: FAIL — $*" >&2
  exit 1
}

_detect_platform() {
  local os arch
  case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    *) _fail "unsupported OS for actionlint bootstrap: $(uname -s)" ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) arch=amd64 ;;
    arm64|aarch64) arch=arm64 ;;
    *) _fail "unsupported CPU arch for actionlint bootstrap: $(uname -m)" ;;
  esac
  printf '%s\n%s\n' "$os" "$arch"
}

_bootstrap_actionlint() {
  if [[ -x "$BIN" ]]; then
    return 0
  fi
  local os arch
  os="$(_detect_platform | sed -n '1p')"
  arch="$(_detect_platform | sed -n '2p')"
  mkdir -p "$CACHE_DIR"
  local url="https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_${os}_${arch}.tar.gz"
  echo "verify-workflow-syntax: downloading actionlint v${ACTIONLINT_VERSION} (${os}/${arch})"
  if ! curl -fsSL "$url" | tar -xz -C "$CACHE_DIR" actionlint; then
    _fail "failed to download actionlint from $url"
  fi
  chmod +x "$BIN"
}

_bootstrap_actionlint

mapfile -t workflow_files < <(
  find "$REPO_ROOT/.github/workflows" -maxdepth 1 \( -name '*.yml' -o -name '*.yaml' \) | sort
)

if [[ "${#workflow_files[@]}" -eq 0 ]]; then
  _fail "no workflow files found under .github/workflows"
fi

echo "verify-workflow-syntax: scanning ${#workflow_files[@]} workflow file(s)"
"$BIN" "${workflow_files[@]}"
echo "verify-workflow-syntax: PASS"
