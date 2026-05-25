#!/usr/bin/env bash
# Regression tests for shared edge curl probe classifier (h2 + h3).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/rp-edge-curl-probe.sh
source "$SCRIPT_DIR/lib/rp-edge-curl-probe.sh"

FAIL=0
bad() { echo "❌ $*" >&2; FAIL=1; }
ok() { echo "✅ $*"; }

_assert() {
  local name="$1" expected="$2" protocol="$3"
  shift 3
  local got
  got="$(rp_edge_classify_result "$protocol" "$@")"
  if [[ "$got" != "$expected" ]]; then
    bad "$name: expected $expected got $got"
  else
    ok "$name => $got"
  fi
}

# h3 success
_assert "h3 success 200" PASS h3 0 200 3 0 "" 200

# h2 success
_assert "h2 success 200" PASS h2 0 200 2 0 "" 200

# timeout (not cert)
_assert "timeout ec28 h3" TIMEOUT h3 28 000 0 1 "curl: (28) timed out" 200
_assert "timeout ec28 h2" TIMEOUT h2 28 000 0 1 "" 200

# real cert failure
_assert "cert ec60 h2" CERT_FAIL h2 60 000 0 1 "" 200
_assert "cert stderr h3" CERT_FAIL h3 0 000 0 1 "curl: (60) SSL certificate problem: bad cert" 200

# wrong protocol
_assert "h2 got h3" NOT_EXPECTED_PROTOCOL h2 0 200 3 0 "" 200
_assert "h3 got h2" NOT_EXPECTED_PROTOCOL h3 0 200 2 0 "" 200

# prometheus 302 redirect — the exact bug that broke the smoke
_assert "prometheus 302 h3 multi-code" PASS h3 0 302 3 0 "" 200 302 401
_assert "prometheus 302 h2 multi-code" PASS h2 0 302 2 0 "" 200 302 401

# 302 must NOT pass if only 200 is accepted (settings-like path)
_assert "302 not in 200-only policy" BAD_STATUS h3 0 302 3 0 "" 200

# bad status
_assert "h2 404 not in policy" BAD_STATUS h2 0 404 2 0 "" 200

# upstream 5xx
_assert "h3 503" UPSTREAM_5XX h3 0 503 3 0 "" 200

# no false cert on success
_assert "no false cert h3" PASS h3 0 200 3 0 "" 200

# --- parse metric extraction ---
sample='attempt=1	protocol=h3	curl_exit=0	http_code=200	http_version=3	ssl_verify_result=0	remote_ip=192.168.64.243'
for field in curl_exit http_code http_version ssl_verify_result remote_ip; do
  val="$(rp_edge_parse_metric "$field" "$sample")"
  [[ -n "$val" ]] || bad "parse missing $field"
done
ok "parse sample write-out line"

# --- structural checks on the smoke scripts ---
if grep -q 'rp_edge_probe_once' "$SCRIPT_DIR/lib/rp-edge-curl-probe.sh" \
  && grep -q 'write_line="\$("\$curl_bin"' "$SCRIPT_DIR/lib/rp-edge-curl-probe.sh"; then
  ok "probe captures curl write-out in write_line"
else
  bad "rp_edge_probe_once must capture -w output in write_line"
fi

# global_fail vs path_fail must be separate in the strict runner
if grep -q 'global_fail' "$SCRIPT_DIR/lib/rp-edge-strict-smoke-runner.sh" \
  && grep -q 'path_fail' "$SCRIPT_DIR/lib/rp-edge-strict-smoke-runner.sh" \
  && ! grep -qE '\[\[ "\$fail" -eq 0 \]\]' "$SCRIPT_DIR/lib/rp-edge-strict-smoke-runner.sh"; then
  ok "strict runner separates global_fail from path_fail"
else
  bad "strict runner must use global_fail (set by bad()) separate from per-path path_fail counter"
fi

# contract smoke python must indent codes inside the for-ep loop
if python3 -c "
import ast, sys, textwrap
src = open('$SCRIPT_DIR/smoke-rp-edge-contract.sh').read()
# extract the PY heredoc
start = src.index(\"<<'PY'\") + len(\"<<'PY'\")
end = src.index('\nPY\n', start)
py = src[start:end]
tree = ast.parse(py)
# find the for-section loop
for node in ast.walk(tree):
    if isinstance(node, ast.For) and isinstance(node.target, ast.Name) and node.target.id == 'section':
        inner_for = [n for n in ast.walk(node) if isinstance(n, ast.For) and isinstance(n.target, ast.Name) and n.target.id == 'ep']
        if inner_for:
            ep_body_lines = {n.lineno for n in ast.walk(inner_for[0]) if hasattr(n, 'lineno')}
            # codes assignment must be inside ep loop body
            for n in ast.walk(inner_for[0]):
                if isinstance(n, ast.Assign):
                    for t in n.targets:
                        if isinstance(t, ast.Name) and t.id == 'codes':
                            sys.exit(0)  # found codes inside ep loop
sys.exit(1)
" 2>/dev/null; then
  ok "contract smoke python: codes assignment inside for-ep loop"
else
  bad "contract smoke python: codes must be indented inside the for-ep loop (was only testing last endpoint per section)"
fi

[[ "$FAIL" -eq 0 ]] || exit 1
echo "✅ test-rp-edge-curl-probe-parser passed"
