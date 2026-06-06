#!/usr/bin/env bash
# P1 host dependencies for RP cold-bootstrap (no cluster mutations).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

say() { printf '\n\033[1m[P1] %s\033[0m\n' "$*"; }
ok() { echo "✅ $*"; }
bad() { echo "❌ $*" >&2; exit 1; }

chmod +x "$SCRIPT_DIR/rp-verify-toolchain-contract.sh" \
  "$SCRIPT_DIR/lib/rp-ensure-node-pnpm.sh" 2>/dev/null || true

say "toolchain contract"
bash "$SCRIPT_DIR/rp-verify-toolchain-contract.sh" || bad "toolchain contract failed"

say "docker info"
command -v docker >/dev/null 2>&1 || bad "docker not on PATH"
_dw=0
while ! docker info >/dev/null 2>&1; do
  _dw=$((_dw + 1))
  [[ "$_dw" -le 90 ]] || bad "docker info timeout"
  echo "  ⏳ docker ($_dw/90)…"
  sleep 2
done
ok "docker info"

say "curl HTTP/3"
command -v curl >/dev/null 2>&1 || bad "curl not on PATH"
if [[ -x "$SCRIPT_DIR/check-curl-preflight-reqs.sh" ]]; then
  bash "$SCRIPT_DIR/check-curl-preflight-reqs.sh" || bad "curl preflight failed"
else
  curl --version 2>/dev/null | grep -qiE 'HTTP3|HTTP/3' || bad "curl missing HTTP/3"
fi
ok "curl HTTP/3"

say "openssl"
command -v openssl >/dev/null 2>&1 || bad "openssl not on PATH"
openssl version >/dev/null
ok "openssl"

say "kubectl"
command -v kubectl >/dev/null 2>&1 || bad "kubectl not on PATH"
kubectl version --client >/dev/null
ok "kubectl client"

say "pip venv (pip==26.1.1 for kafka-alignment report)"
make -C "$REPO_ROOT" kafka-alignment-report-venv >/dev/null || bad "kafka-alignment-report-venv failed"
_venv_pip="$REPO_ROOT/.venv-kafka-alignment-report/bin/pip"
[[ -x "$_venv_pip" ]] || bad "missing $_venv_pip (make kafka-alignment-report-venv)"
_pv="$("$_venv_pip" --version 2>/dev/null || true)"
echo "$_pv" | grep -q 'pip 26.1.1' || bad "expected pip 26.1.1 in kafka-alignment venv (got: ${_pv:-?})"
ok "pip 26.1.1 in .venv-kafka-alignment-report"

ok "P1 host dependencies satisfied"
