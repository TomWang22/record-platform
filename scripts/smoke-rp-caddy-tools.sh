#!/usr/bin/env bash
# Verify rp-caddy:dev contains required operator tools.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE="${RP_CADDY_IMAGE:-rp-caddy:dev}"
REPORT_DIR="${REPORT_DIR:-$REPO_ROOT/bench_logs/security-contract}"
REPORT="${REPORT:-$REPORT_DIR/caddy-runtime-debug-image-contract.md}"

mkdir -p "$REPORT_DIR"

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "Image $IMAGE missing — run ./scripts/build-rp-caddy.sh" >&2
  exit 1
fi

run_in() { docker run --rm --entrypoint sh "$IMAGE" -lc "$1"; }

checks=0
pass=0

{
  echo "# Caddy runtime/debug image contract"
  echo ""
  echo "Image: \`$IMAGE\`"
  echo "Dockerfile: \`docker/caddy/Dockerfile\`"
  echo "Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo ""
  echo "## Tool versions"
} >"$REPORT"

check() {
  local name="$1" cmd="$2"
  checks=$((checks + 1))
  echo "### $name" >>"$REPORT"
  if out=$(run_in "$cmd" 2>&1); then
    pass=$((pass + 1))
    echo '```' >>"$REPORT"
    echo "$out" | head -4 >>"$REPORT"
    echo '```' >>"$REPORT"
  else
    echo "FAIL" >>"$REPORT"
  fi
  echo "" >>"$REPORT"
}

check caddy 'caddy version'
check xcaddy 'xcaddy version'
check strace 'strace -V 2>&1 | head -1'
check tcpdump 'tcpdump --version 2>&1 | head -1'
check tshark 'tshark --version 2>&1 | head -1'
check htop 'htop --version 2>&1 || htop -v 2>&1 | head -1'
check curl 'curl --version | head -1'
check jq 'jq --version'
check openssl 'openssl version'
check dig 'dig -v | head -1'

{
  echo "## Summary"
  echo ""
  if [[ "$pass" -eq "$checks" ]]; then
    echo "**PASS** — $pass/$checks tools present."
  else
    echo "**FAIL** — $pass/$checks tools present."
  fi
} >>"$REPORT"

if [[ "$pass" -ne "$checks" ]]; then
  echo "Caddy tools smoke FAILED — $REPORT" >&2
  exit 1
fi
echo "Caddy tools smoke PASS — $REPORT"
exit 0
