#!/usr/bin/env bash
# make runtime-heartbeat-acceptance — resumable, fail-closed orchestrator.
# Tickets 7+ (observability journeys / soak) are gated: Tickets 2–6 must PASS first.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
export REPO_ROOT EVIDENCE_ROOT NS HARDENING_SHA_EXPECTED

rh_require_evidence_root
rh_log "evidence root: $EVIDENCE_ROOT"

STATE_FILE="$EVIDENCE_ROOT/ledger/runner-state.json"
mkdir -p "$EVIDENCE_ROOT/ledger"

write_state() {
  python3 - <<PY
import json
from pathlib import Path
Path("$STATE_FILE").write_text(json.dumps({
  "ts": "$(rh_ts)",
  "phase": "$1",
  "last_ticket": "$2",
  "status": "$3",
  "exact_sha": "$(git -C "$REPO_ROOT" rev-parse HEAD)",
}, indent=2) + "\n")
PY
}

# Preflight (git)
set +e
rh_git_preflight
pf=$?
set -e
if [[ $pf -ne 0 ]]; then
  # Inventory-only path when dirty/mismatch: Ticket 1–2 may still run with ALLOW_DIRTY
  if [[ "${RUNTIME_HEARTBEAT_ALLOW_DIRTY:-0}" != "1" ]]; then
    rh_hard_stop "0-preflight" "git preflight failed exit=$pf (need HEAD==origin/main==expected SHA and clean worktree)"
    rh_freeze "FROZEN_BLOCKED_EVIDENCE" "Ticket 0 git preflight failed (exit $pf). Clean worktree required for full acceptance."
    write_state "blocked" "0" "FROZEN_BLOCKED_EVIDENCE"
    exit $pf
  fi
  rh_log "WARNING: continuing with RUNTIME_HEARTBEAT_ALLOW_DIRTY=1 (inventory only; not full acceptance)"
fi

run_ticket() {
  local id="$1"
  local script="$2"
  local name="$3"
  write_state "running" "$id" "IN_PROGRESS"
  rh_ledger "ticket_start" "{\"ticket\":$id,\"name\":\"$name\"}"
  rh_log "=== Ticket $id: $name ==="
  if ! bash "$script"; then
    rh_hard_stop "$id" "ticket $id ($name) failed"
    rh_freeze "FROZEN_BLOCKED_EVIDENCE" "Ticket $id ($name) failed. Later destructive stages stopped."
    write_state "blocked" "$id" "FROZEN_BLOCKED_EVIDENCE"
    exit 1
  fi
  rh_ledger "ticket_pass" "{\"ticket\":$id,\"name\":\"$name\"}"
  printf '%s\n' "$id" >>"$EVIDENCE_ROOT/ledger/passed-tickets.txt"
}

# Ticket order: 1→6 required before 7+
run_ticket 1 "$SCRIPT_DIR/tickets/01-exact-sha-pin.sh" "exact-sha-pin"
run_ticket 2 "$SCRIPT_DIR/tickets/02-pki-inventory.sh" "pki-inventory"

# Remaining tickets: stub fail-closed until implemented (do not skip silently)
for stub in \
  "3:$SCRIPT_DIR/tickets/03-mtls-authorization-matrix.sh:mtls-authorization" \
  "4:$SCRIPT_DIR/tickets/04-http-protocols-pcap.sh:http-protocols-pcap" \
  "5:$SCRIPT_DIR/tickets/05-kafka-census.sh:kafka-census" \
  "6:$SCRIPT_DIR/tickets/06-kafka-broker-failover.sh:kafka-broker-failover"
do
  IFS=: read -r id path name <<<"$stub"
  if [[ ! -x "$path" && ! -f "$path" ]]; then
    rh_hard_stop "$id" "ticket script missing: $path"
    rh_freeze "FROZEN_BLOCKED_EVIDENCE" "Ticket $id script missing ($name). Observability journeys not started."
    write_state "blocked" "$id" "FROZEN_BLOCKED_EVIDENCE"
    exit 1
  fi
  run_ticket "$id" "$path" "$name"
done

# Gate: do not start Ticket 7+ until 2–6 pass (enforced by sequential hard-stop above)
rh_log "Tickets 1–6 passed. Tickets 7–13 not auto-started in this revision (explicit next invoke)."
write_state "awaiting_7_plus" "6" "TICKETS_1_6_PASS"
rh_ledger "tickets_1_6_complete" "{}"
echo "RUNTIME_HEARTBEAT: tickets 1–6 PASS — proceed to Ticket 7+ only via explicit continuation"
