#!/usr/bin/env bash
# Verify rp-caddy-debug image contains required operator tools.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE="${RP_CADDY_DEBUG_IMAGE:-rp-caddy:dev}"
REPORT_DIR="${REPORT_DIR:-$REPO_ROOT/bench_logs/security-contract}"
REPORT="$REPORT_DIR/caddy-debug-image-contract.md"

mkdir -p "$REPORT_DIR"

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "Image $IMAGE not found — run ./scripts/build-rp-caddy-debug.sh first" >&2
  exit 1
fi

run_in() {
  docker run --rm --entrypoint sh "$IMAGE" -lc "$1"
}

{
  echo "# Caddy debug image contract"
  echo ""
  echo "Image: \`$IMAGE\`"
  echo "Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo ""
  echo "## Tool versions"
  echo '```'
} >"$REPORT"

checks=0
pass=0

check() {
  local name="$1" cmd="$2"
  checks=$((checks + 1))
  echo "### $name" >>"$REPORT"
  if out=$(run_in "$cmd" 2>&1); then
    pass=$((pass + 1))
    echo '```' >>"$REPORT"
    echo "$out" | head -3 >>"$REPORT"
    echo '```' >>"$REPORT"
    echo "  OK $name"
  else
    echo "FAIL: $name" >>"$REPORT"
    echo "  FAIL $name"
  fi
  echo "" >>"$REPORT"
}

# Required on caddy-with-tcpdump:dev (docker/caddy-with-debug-tools.Dockerfile)
check "caddy version" "caddy version"
check "strace" "strace -V | head -1"
check "tcpdump" "tcpdump --version | head -1"
check "tshark" "tshark --version | head -1"
check "htop" "htop --version 2>&1 || htop -v 2>&1 | head -1"
check "curl" "curl --version | head -1"

required_checks=$checks
required_pass=$pass

# Optional (not shipped in minimal edge image; logged only)
for opt in \
  "xcaddy version|xcaddy version" \
  "jq|jq --version" \
  "dig|dig -v | head -1" \
  "openssl|openssl version"; do
  IFS='|' read -r name cmd <<<"$opt"
  if out=$(run_in "$cmd" 2>&1); then
    echo "  OK (optional) $name"
  else
    echo "  ℹ️  optional $name not in image"
  fi
done

checks=$required_checks
pass=$required_pass

{
  echo "## Summary"
  echo ""
  echo "| Check | Result |"
  echo "|-------|--------|"
  echo "| Tools verified | $pass / $checks |"
} >>"$REPORT"

if [[ "$pass" -lt "$checks" ]]; then
  echo "Caddy debug tools smoke FAILED — $REPORT" >&2
  exit 1
fi
echo "Caddy debug tools smoke PASS — $REPORT"
