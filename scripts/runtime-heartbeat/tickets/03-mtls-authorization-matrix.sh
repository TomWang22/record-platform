#!/usr/bin/env bash
# Ticket 3 placeholder — fails closed until identity authorization is implemented + matrix re-run.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"
rh_log "Ticket 3: mTLS authorization matrix NOT YET IMPLEMENTED (close VALID_SAME_CA_BUT_UNAUTHORIZED_SERVICE_IDENTITY_ACCEPTED)"
mkdir -p "$REPO_ROOT/reports/transport" "$EVIDENCE_ROOT/tickets/03"
python3 - <<'PY'
import json, datetime
from pathlib import Path
import os
doc = {
  "ticket": 3,
  "status": "BLOCKED",
  "generated_at": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
  "blocker": "VALID_SAME_CA_BUT_UNAUTHORIZED_SERVICE_IDENTITY_ACCEPTED",
  "required": [
    "implement SAN/SPIFFE service-call authorization (not CA-only trust)",
    "service-call-graph.json",
    "positive + negative matrices with peer fingerprints",
  ],
  "acceptance": {
    "wrong_service_identity_denied": "0% — not yet enforced",
  },
}
Path(os.environ["EVIDENCE_ROOT"], "tickets/03/status.json").write_text(json.dumps(doc, indent=2)+"\n")
Path(os.environ.get("REPO_ROOT","."), "reports/transport/grpc-mtls-negative-matrix.json").write_text(json.dumps(doc, indent=2)+"\n")
print(json.dumps(doc, indent=2))
raise SystemExit(1)
PY
