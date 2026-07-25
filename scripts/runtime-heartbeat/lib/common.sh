#!/usr/bin/env bash
# Shared helpers for runtime-heartbeat acceptance (fail-closed).
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
EVIDENCE_ROOT="${RUNTIME_HEARTBEAT_EVIDENCE_ROOT:-/tmp/record-platform-runtime-heartbeat-v1}"
NS="${HOUSING_NS:-record-platform}"
HARDENING_SHA_EXPECTED="${RUNTIME_HEARTBEAT_EXPECTED_SHA:-47d1afbe617c2d784c04297c3097d0a612812e26}"

WORKLOADS=(
  analytics-service api-gateway auction-monitor auth-service listings-service
  media-service messaging-service notification-service python-ai-service
  records-service shopping-service trust-service webapp
)

rh_ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }

rh_log() { printf '[runtime-heartbeat] %s\n' "$*" >&2; }

rh_ledger() {
  local event="$1"
  shift || true
  mkdir -p "$EVIDENCE_ROOT/ledger"
  printf '{"ts":"%s","event":"%s","payload":%s}\n' "$(rh_ts)" "$event" "${1:-{}}" >>"$EVIDENCE_ROOT/ledger/events.jsonl"
}

rh_require_evidence_root() {
  mkdir -p "$EVIDENCE_ROOT"/{ledger,pcap,tickets,pins,pki,mtls,kafka,freeze,reports}
  if [[ -f "$EVIDENCE_ROOT/freeze/TERMINAL_STATE" ]]; then
    local st
    st="$(cat "$EVIDENCE_ROOT/freeze/TERMINAL_STATE")"
    if [[ "$st" == FROZEN_PASS_EVIDENCE || "$st" == FROZEN_BLOCKED_EVIDENCE ]]; then
      rh_log "evidence root frozen ($st); refusing mutating writes (read-only analysis only)"
      return 2
    fi
  fi
}

rh_freeze() {
  local state="$1"
  local reason="${2:-}"
  mkdir -p "$EVIDENCE_ROOT/freeze"
  if [[ -f "$EVIDENCE_ROOT/freeze/TERMINAL_STATE" ]]; then
    rh_log "already frozen: $(cat "$EVIDENCE_ROOT/freeze/TERMINAL_STATE"); not overwriting"
    return 1
  fi
  printf '%s\n' "$state" >"$EVIDENCE_ROOT/freeze/TERMINAL_STATE"
  printf '%s\n' "$reason" >"$EVIDENCE_ROOT/freeze/REASON.txt"
  printf '{"ts":"%s","state":"%s","reason":%s}\n' "$(rh_ts)" "$state" "$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$reason")" \
    >"$EVIDENCE_ROOT/freeze/terminal.json"
  rh_ledger "freeze" "$(python3 -c 'import json,sys; print(json.dumps({"state":sys.argv[1],"reason":sys.argv[2]}))' "$state" "$reason")"
  # Mirror terminal marker into repo reports (not private keys)
  mkdir -p "$REPO_ROOT/reports/runtime"
  cp "$EVIDENCE_ROOT/freeze/terminal.json" "$REPO_ROOT/reports/runtime/runtime-heartbeat-terminal.json"
}

rh_git_preflight() {
  local head origin dirty allow_dirty
  head="$(git -C "$REPO_ROOT" rev-parse HEAD)"
  origin="$(git -C "$REPO_ROOT" rev-parse origin/main 2>/dev/null || echo MISSING)"
  dirty="$(git -C "$REPO_ROOT" status --porcelain | wc -l | tr -d ' ')"
  allow_dirty="${RUNTIME_HEARTBEAT_ALLOW_DIRTY:-0}"

  python3 - <<PY
import json
from pathlib import Path
doc = {
  "ts": "$(rh_ts)",
  "head": "$head",
  "origin_main": "$origin",
  "head_equals_origin_main": "$head" == "$origin",
  "dirty_paths": int("$dirty"),
  "worktree_clean": int("$dirty") == 0,
  "expected_sha": "$HARDENING_SHA_EXPECTED",
  "head_equals_expected": "$head" == "$HARDENING_SHA_EXPECTED",
  "allow_dirty": "$allow_dirty" in ("1", "true", "TRUE"),
}
Path("$EVIDENCE_ROOT/pins/git-preflight.json").write_text(json.dumps(doc, indent=2) + "\n")
Path("$REPO_ROOT/reports/runtime/runtime-heartbeat-git-preflight.json").write_text(json.dumps(doc, indent=2) + "\n")
print(json.dumps(doc))
PY

  if [[ "$head" != "$origin" ]]; then
    echo "HEAD_NE_ORIGIN_MAIN" >&2
    return 10
  fi
  if [[ "$head" != "$HARDENING_SHA_EXPECTED" ]]; then
    echo "HEAD_NE_EXPECTED_SHA" >&2
    return 11
  fi
  if [[ "$dirty" != "0" && "$allow_dirty" != "1" ]]; then
    echo "WORKTREE_DIRTY count=$dirty (set RUNTIME_HEARTBEAT_ALLOW_DIRTY=1 only for read-only inventory)" >&2
    return 12
  fi
  return 0
}

rh_hard_stop() {
  local ticket="$1"
  local reason="$2"
  rh_log "HARD STOP at $ticket: $reason"
  rh_ledger "hard_stop" "$(python3 -c 'import json,sys; print(json.dumps({"ticket":sys.argv[1],"reason":sys.argv[2]}))' "$ticket" "$reason")"
  printf '%s\n' "$ticket" >"$EVIDENCE_ROOT/freeze/HARD_STOP_TICKET"
  printf '%s\n' "$reason" >"$EVIDENCE_ROOT/freeze/HARD_STOP_REASON.txt"
  # Do not freeze terminal PASS/BLOCKED here — caller decides after writing manifests
}
