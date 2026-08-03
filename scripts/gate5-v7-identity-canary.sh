#!/usr/bin/env bash
# Gate 5 v7 identity canary — real 12×3 service→broker mTLS matrix (36 rows).
# Not a stub. Requires RP_GATE5_V7_ACCEPTANCE=1.
#
# Reuses scripts/lib/kafka-mtls36-incluster.sh via prove-kafka-twelve-by-three-mtls.sh
# and writes acceptance evidence under /tmp (not mutable Git evidence).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ "${RP_GATE5_V7_ACCEPTANCE:-0}" != "1" ]]; then
  echo "status=DEFERRED_NOT_AUTHORIZED"
  echo "reason=RP_GATE5_V7_ACCEPTANCE!=1"
  exit 3
fi

EVIDENCE_ROOT="${RP_GATE5_V7_CANARY_EVIDENCE_ROOT:-/tmp/record-platform-gate5-v7-identity-canary}"
RUN_ID="$(date -u +%Y%m%d%H%M%S)-$$"
OUT_DIR="${EVIDENCE_ROOT}/${RUN_ID}"
mkdir -p "$OUT_DIR"
chmod 700 "$EVIDENCE_ROOT" 2>/dev/null || true

echo "evidence_dir=${OUT_DIR}"
export RP_GATE5_V7_MTLS_EVIDENCE_DIR="$OUT_DIR"

# Run the proven 12×3 matrix (writes reports/kafka/gate5-v7-twelve-by-three-mtls-matrix.json)
bash "$SCRIPT_DIR/prove-kafka-twelve-by-three-mtls.sh"

MATRIX="${REPO_ROOT}/reports/kafka/gate5-v7-twelve-by-three-mtls-matrix.json"
[[ -f "$MATRIX" ]] || { echo "missing matrix report"; exit 1; }

# Copy sanitized summary into evidence root; strip nothing secret (report is fingerprints only)
cp "$MATRIX" "${OUT_DIR}/twelve-by-three-mtls-matrix.json"

python3 - "$MATRIX" "$OUT_DIR/identity-canary-summary.json" <<'PY'
import json, sys
from pathlib import Path
from datetime import datetime, timezone
m = json.loads(Path(sys.argv[1]).read_text())
summary = m.get("summary") or {}
expected = int(summary.get("positive_mtls_rows_expected", 36))
tested = int(summary.get("positive_mtls_rows_tested", 0))
passed = int(summary.get("positive_mtls_rows_passed", 0))
failed = int(summary.get("positive_mtls_rows_failed", max(0, tested - passed)))
fps = int(summary.get("distinct_client_leaf_fingerprints", 0))
rows = m.get("rows") or []
client_auth = sum(1 for r in rows if (r.get("client") or {}).get("clientAuth") is True)
server_auth_absent = sum(1 for r in rows if (r.get("client") or {}).get("serverAuth") is False)
broker_server = sum(1 for r in rows if (r.get("broker") or {}).get("serverAuth") is True)
out = {
    "document": "gate5-v7-identity-canary-summary",
    "ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "positive_rows_expected": expected,
    "positive_rows_tested": tested,
    "positive_rows_passed": passed,
    "positive_rows_failed": failed,
    "distinct_service_leaf_fingerprints": fps,
    "clientAuth_present": f"{client_auth}/{tested}" if tested else "0/0",
    "serverAuth_absent_on_clients": f"{server_auth_absent}/{tested}" if tested else "0/0",
    "broker_serverAuth_present": f"{broker_server}/{tested}" if tested else "0/0",
    "matrix_report": "reports/kafka/gate5-v7-twelve-by-three-mtls-matrix.json",
    "passed": expected == 36 and tested == 36 and passed == 36 and failed == 0 and fps == 12,
}
Path(sys.argv[2]).write_text(json.dumps(out, indent=2) + "\n")
print(json.dumps(out, indent=2))
if not out["passed"]:
    raise SystemExit(1)
PY

# Sanitized copy for Git (deterministic counts only)
cp "${OUT_DIR}/identity-canary-summary.json" \
  "${REPO_ROOT}/reports/kafka/gate5-v7-identity-canary-summary.json"

echo "IDENTITY_CANARY_PASSED=1"
echo "positive_rows=36/36/36"
