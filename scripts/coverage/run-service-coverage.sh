#!/usr/bin/env bash
# Run coverage for one service or all services listed in service-coverage-manifest.json.
# Does not require cluster/k8s. Does not modify production code.
#
# Usage:
#   bash scripts/coverage/run-service-coverage.sh              # all services (default)
#   bash scripts/coverage/run-service-coverage.sh all          # all services (explicit)
#   bash scripts/coverage/run-service-coverage.sh python-ai-service
#   bash scripts/coverage/run-service-coverage.sh messaging-service
#
# T20.11B: Node services with run_command are dry-wired (run + report). Failures on
# non-strict services are reported but do not fail the script. Strict services (python-ai)
# fail the script when their run_command exits non-zero.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MANIFEST="$ROOT/scripts/coverage/service-coverage-manifest.json"
TARGET="${1:-all}"

if [[ "$TARGET" == "all" ]]; then
  TARGET=""
fi

if [[ ! -f "$MANIFEST" ]]; then
  echo "::error::missing manifest: $MANIFEST" >&2
  exit 2
fi

RUN_OK=0
RUN_FAIL=0
SKIP_COUNT=0
STRICT_FAIL=0

read_summary_lines() {
  local summary_rel="$1"
  local summary_path="$ROOT/$summary_rel"
  if [[ ! -f "$summary_path" ]]; then
    echo ""
    return 0
  fi
  node -e "
    const p = require(process.argv[1]);
    const v = p?.total?.lines?.pct;
    if (typeof v === 'number' && !Number.isNaN(v)) console.log(v.toFixed(2));
  " "$summary_path" 2>/dev/null || true
}

package_has_test_coverage() {
  local pkg_path="$1"
  [[ -f "$pkg_path" ]] || return 1
  node -e "
    const p = require(process.argv[1]);
    process.exit(p.scripts && p.scripts['test:coverage'] ? 0 : 1);
  " "$pkg_path" 2>/dev/null
}

run_one() {
  local name="$1"
  local info
  info="$(node -e "
    const m = require(process.argv[1]);
    const svc = m.services.find(s => s.name === process.argv[2]);
    if (!svc) { console.error('unknown service: ' + process.argv[2]); process.exit(3); }
    console.log(JSON.stringify(svc));
  " "$MANIFEST" "$name")"

  local run_cmd skip_reason strict_enabled svc_path summary_rel
  run_cmd="$(node -e "console.log(JSON.parse(process.argv[1]).run_command || '')" "$info")"
  skip_reason="$(node -e "console.log(JSON.parse(process.argv[1]).skip_reason || '')" "$info")"
  strict_enabled="$(node -e "console.log(JSON.parse(process.argv[1]).strict_enabled ? '1' : '0')" "$info")"
  svc_path="$(node -e "console.log(JSON.parse(process.argv[1]).path || '')" "$info")"
  summary_rel="$(node -e "console.log(JSON.parse(process.argv[1]).coverage_summary_path || '')" "$info")"

  if [[ -z "$run_cmd" || "$run_cmd" == "null" ]]; then
    echo "SKIP $name — ${skip_reason:-no run_command configured}"
    SKIP_COUNT=$((SKIP_COUNT + 1))
    return 0
  fi

  if [[ -n "$svc_path" && -f "$ROOT/$svc_path/package.json" ]]; then
    if ! package_has_test_coverage "$ROOT/$svc_path/package.json"; then
      echo "SKIP $name — test:coverage missing from package.json"
      SKIP_COUNT=$((SKIP_COUNT + 1))
      return 0
    fi
  fi

  local strict_label="dry-wire"
  if [[ "$strict_enabled" == "1" ]]; then
    strict_label="strict"
  fi

  echo "▶ coverage: $name ($strict_label)"
  cd "$ROOT"
  if eval "$run_cmd"; then
    local lines_pct=""
    lines_pct="$(read_summary_lines "$summary_rel")"
    if [[ -n "$lines_pct" ]]; then
      echo "✅ coverage: $name done — lines ${lines_pct}% (non-blocking unless strict)"
    else
      echo "✅ coverage: $name done — summary not found at ${summary_rel:-<unset>}"
    fi
    RUN_OK=$((RUN_OK + 1))
    return 0
  fi

  local ec=$?
  if [[ "$strict_enabled" == "1" ]]; then
    echo "::error::FAIL $name — run_command exited $ec (strict gate)" >&2
    STRICT_FAIL=$((STRICT_FAIL + 1))
    return "$ec"
  fi

  echo "WARN $name — run_command exited $ec (non-strict; dry-wire only)"
  RUN_FAIL=$((RUN_FAIL + 1))
  return 0
}

if [[ -n "$TARGET" ]]; then
  run_one "$TARGET"
  exit $?
fi

mapfile -t NAMES < <(node -e "
  const m = require(process.argv[1]);
  for (const s of m.services) console.log(s.name);
" "$MANIFEST")

for name in "${NAMES[@]}"; do
  run_one "$name" || true
done

echo ""
echo "run-service-coverage summary: manifest=${#NAMES[@]} run_ok=$RUN_OK run_fail_non_strict=$RUN_FAIL skip=$SKIP_COUNT strict_fail=$STRICT_FAIL"

if [[ "$STRICT_FAIL" -gt 0 ]]; then
  echo "::error::run-service-coverage: strict service failure(s)" >&2
  exit 1
fi

echo "✅ run-service-coverage: finished (${#NAMES[@]} services in manifest)"
exit 0
