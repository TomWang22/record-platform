#!/usr/bin/env bash
# make runtime-heartbeat-acceptance-status — read-only summary.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

python3 - <<'PY'
import json, os
from pathlib import Path

root = Path(os.environ.get("RUNTIME_HEARTBEAT_EVIDENCE_ROOT", "/tmp/record-platform-runtime-heartbeat-v1"))
repo = Path(os.environ.get("REPO_ROOT", "."))

def load(p):
  try:
    return json.loads(Path(p).read_text())
  except Exception:
    return None

terminal = load(root / "freeze/terminal.json") or load(repo / "reports/runtime/runtime-heartbeat-terminal.json")
state = load(root / "ledger/runner-state.json")
gitpf = load(root / "pins/git-preflight.json") or load(repo / "reports/runtime/runtime-heartbeat-git-preflight.json")
pin = load(repo / "reports/runtime/final-runtime-pin.json")
pki = load(repo / "reports/transport/pki-inventory.json")
passed = []
pt = root / "ledger/passed-tickets.txt"
if pt.exists():
  passed = [x.strip() for x in pt.read_text().splitlines() if x.strip()]

summary = {
  "evidence_root": str(root),
  "terminal": terminal,
  "runner_state": state,
  "git_preflight": gitpf,
  "ticket_1_status": (pin or {}).get("status"),
  "ticket_2_status": (pki or {}).get("status"),
  "passed_tickets": passed,
  "pre_performance_gate_earned": False,
  "production_approved": False,
  "observability_journeys_allowed": set(["1","2","3","4","5","6"]).issubset(set(passed)),
}
print(json.dumps(summary, indent=2))
PY
