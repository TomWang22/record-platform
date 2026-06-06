#!/usr/bin/env bash
# Regression: final summary must not print success banner on failure; bash -n must pass.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

fail() { echo "❌ $*" >&2; exit 1; }
ok() { echo "✅ $*"; }

for f in \
  "$SCRIPT_DIR/cold-bootstrap-post-hosts.sh" \
  "$SCRIPT_DIR/lib/rp-cold-bootstrap-final-summary.sh" \
  "$SCRIPT_DIR/rp-verify-slo-sla.sh"; do
  bash -n "$f" || fail "bash -n failed: $f"
done
ok "bash -n passed for touched bootstrap scripts"

# shellcheck source=scripts/lib/rp-cold-bootstrap-final-summary.sh
source "$SCRIPT_DIR/lib/rp-cold-bootstrap-final-summary.sh"

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
export RP_CB_BENCH="$tmpdir"
export HOUSING_NS=record-platform
export RP_PUBLIC_HOST=record-platform.test
export RP_COLD_BOOTSTRAP_LOG=/tmp/rp-test-bootstrap.log

printf '%s\n' '{"live_health":{"score":100}}' >"$tmpdir/cluster-doctor.json"
printf '%s\n' '{"overall":true}' >"$tmpdir/bootstrap-state-verify-final.json"
printf '%s\n' '{"ok":true}' >"$tmpdir/rp_slo_sla_report.json"

out_ok="$(mktemp)"
export RP_CB_FINAL_SUMMARY_NO_KUBECTL=1
rp_cb_final_summary_print >"$out_ok" 2>&1 || fail "success print failed"
grep -q 'cold-bootstrap complete' "$out_ok" || fail "success banner missing"
grep -q 'COMPLETE' "$out_ok" && fail "COMPLETE line should only come from rp_cb_final_success_line in post-hosts"
ok "success banner prints when invoked explicitly"

out_fail="$(mktemp)"
rp_cb_final_failure_footer 2 "fake-command" >"$out_fail" 2>&1 || true
grep -q 'FAILED' "$out_fail" || fail "failure footer missing FAILED"
grep -q 'cold-bootstrap complete' "$out_fail" && fail "success banner must not appear in failure footer"
ok "failure footer has no success banner"

# Sourcing library must not auto-print success banner
out_source="$(mktemp)"
(
  # shellcheck source=scripts/lib/rp-cold-bootstrap-final-summary.sh
  source "$SCRIPT_DIR/lib/rp-cold-bootstrap-final-summary.sh"
) >"$out_source" 2>&1
grep -q 'cold-bootstrap complete' "$out_source" && fail "source must not auto-print success banner"
ok "library source is side-effect free"

# Simulated post-hosts tail: only success line after explicit print
sim_out="$(mktemp)"
(
  export RP_CB_FINAL_SUMMARY_NO_KUBECTL=1
  source "$SCRIPT_DIR/lib/rp-cold-bootstrap-final-summary.sh"
  rp_cb_final_summary_print
  rp_cb_final_success_line
) >"$sim_out" 2>&1
grep -q 'cold-bootstrap complete' "$sim_out" || fail "simulated success missing banner"
grep -q 'COMPLETE — exit=0' "$sim_out" || fail "simulated success missing exit=0 line"
ok "simulated success tail is consistent"

echo ""
ok "test-cold-bootstrap-final-summary: all checks passed"
