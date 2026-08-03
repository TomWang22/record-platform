#!/usr/bin/env bash
# Gate 5 v8 final matrix runner — read-only ACL, no PKI/ACL/workload mutation.
# Freezes on first hard failure. Negative authz uses logs+offsets+side-effects, not exit code.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT="${RP_GATE5_V8_ROOT:-/tmp/record-platform-runtime-heartbeat-gate5-v8}"
export RP_GATE5_V8_ROOT="$ROOT"
NS="${HOUSING_NS:-record-platform}"
LOG="$ROOT/logs/matrix-runner.log"
mkdir -p "$ROOT/logs" "$ROOT/matrices" "$ROOT/contracts" "$ROOT/denominators" "$ROOT/pcap" "$ROOT/acl-checkpoints"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG"; }
fail_freeze() {
  local phase="$1" reason="$2" detail="${3:-}"
  log "HARD_FAILURE phase=$phase reason=$reason"
  RP_GATE5_V8_FREEZE_PHASE="$phase" RP_GATE5_V8_FREEZE_REASON="$reason" \
    RP_GATE5_V8_FREEZE_DETAIL="$detail" python3 "$SCRIPT_DIR/gate5-v8-freeze.py" | tee -a "$LOG"
  exit 1
}

acl_checkpoint() {
  local name="$1"
  local evid="$ROOT/acl-checkpoints/${name}"
  mkdir -p "$evid"
  log "ACL read-only checkpoint: $name"
  # Force mutation disabled
  unset RP_GATE5_V7_ACL_RECONCILE || true
  unset RP_GATE5_V7_ACL_PRUNE || true
  if ! RP_GATE5_V7_EVIDENCE_ROOT="$evid" bash "$SCRIPT_DIR/gate5-v7-acl-bootstrap.sh" independent-verify \
      >"$evid/acl-checkpoint.log" 2>&1; then
    fail_freeze "acl_checkpoint_$name" "ACL_VERIFY_FAILED" "$(tail -c 2000 "$evid/acl-checkpoint.log")"
  fi
  local summary="$REPO_ROOT/reports/kafka/gate5-v7-acl-bootstrap-summary.json"
  python3 - "$summary" "$evid/checkpoint-summary.json" <<'PY' || exit 1
import json, sys
from pathlib import Path
s = json.loads(Path(sys.argv[1]).read_text())
Path(sys.argv[2]).write_text(json.dumps(s, indent=2) + "\n")
req = [
  ("preexisting_read_only_exact_match", True),
  ("mutation_attempted", False),
  ("expected_acl_rows", 72),
  ("actual_managed_acl_rows", 72),
  ("manifest_vs_live_delta", 0),
]
bad = []
for k, v in req:
  if s.get(k) != v:
    bad.append(f"{k}={s.get(k)} want {v}")
for k in ("missing_acl_rows","unexpected_acl_rows","duplicate_acl_rows","unknown_principal_rows"):
  if s.get(k, 0) not in (0, None) and s.get(k, 0) != 0:
    bad.append(f"{k}={s.get(k)}")
if bad:
  print("ACL_CHECKPOINT_FAIL " + "; ".join(bad))
  raise SystemExit(1)
print("ACL_CHECKPOINT_OK")
PY
  cp -f "$summary" "$evid/acl-bootstrap-summary.json"
  log "ACL checkpoint OK: $name"
}

copy_report() {
  local src="$1" dest="$2"
  mkdir -p "$(dirname "$dest")"
  if [[ -f "$src" ]]; then
    cp -f "$src" "$dest"
  fi
}

log "=== Gate 5 v8 matrix runner start root=$ROOT ==="

# 0. Seal preflight (idempotent reseal allowed for same runner process restart)
log "Sealing preflight"
if [[ -f "$ROOT/preflight/preflight-manifest.sha256" ]]; then
  log "preflight already sealed; verifying pin"
  python3 - <<'PY' || fail_freeze "seal_preflight" "PREFLIGHT_PIN_DRIFT"
import hashlib, json, sys
from pathlib import Path
root=Path("/tmp/record-platform-runtime-heartbeat-gate5-v8")
man=root/"preflight/preflight-manifest.json"
want=(root/"preflight/preflight-manifest.sha256").read_text().strip()
got=hashlib.sha256(man.read_bytes()).hexdigest()
assert want==got, (want, got)
body=json.loads(man.read_text())
assert body.get("exact_controller_sha")=="c7e71bd749654b2526eab1b5e064d8dccaeb91de"
print("PREFLIGHT_SEAL_OK")
PY
else
  python3 "$SCRIPT_DIR/gate5-v8-seal-preflight.py" | tee -a "$LOG" || fail_freeze "seal_preflight" "SEAL_FAILED"
fi

# 1. Close denominators
log "Closing final denominators"
python3 "$SCRIPT_DIR/gate5-v8-close-denominators.py" | tee -a "$LOG" || fail_freeze "denominators" "DENOMINATOR_CONTRACT_OPEN"

# 2. ACL before matrices
acl_checkpoint "00-before-matrices"

# 3. Positive mTLS 36
log "Positive mTLS 12x3"
export RP_GATE5_V7_ACCEPTANCE=1
export RP_GATE5_V7_CANARY_EVIDENCE_ROOT="$ROOT/matrices/identity-canary"
if ! bash "$SCRIPT_DIR/gate5-v7-identity-canary.sh" >"$ROOT/logs/identity-canary.log" 2>&1; then
  fail_freeze "positive_mtls" "IDENTITY_CANARY_FAILED" "$(tail -c 2000 "$ROOT/logs/identity-canary.log")"
fi
copy_report "$REPO_ROOT/reports/kafka/gate5-v7-identity-canary-summary.json" "$ROOT/matrices/identity-canary-summary.json"
python3 - <<'PY' || exit 1
import json
from pathlib import Path
import os
root=Path(os.environ["RP_GATE5_V8_ROOT"])
s=json.loads((root/"matrices/identity-canary-summary.json").read_text())
e,t,p=s.get("positive_rows_expected"),s.get("positive_rows_tested"),s.get("positive_rows_passed")
assert (e,t,p)==(36,36,36), (e,t,p)
print("MTLS_36_OK")
PY
acl_checkpoint "01-after-positive-mtls"

# 4. TLS negatives (twelve-by-three includes negatives)
log "TLS negatives via prove-kafka-twelve-by-three-mtls + untrusted"
if ! bash "$SCRIPT_DIR/prove-kafka-twelve-by-three-mtls.sh" >"$ROOT/logs/twelve-by-three.log" 2>&1; then
  fail_freeze "tls_negatives" "TWELVE_BY_THREE_FAILED" "$(tail -c 2000 "$ROOT/logs/twelve-by-three.log")"
fi
copy_report "$REPO_ROOT/reports/kafka/gate5-v7-twelve-by-three-mtls-matrix.json" "$ROOT/matrices/twelve-by-three-mtls-matrix.json"
copy_report "$REPO_ROOT/reports/kafka/gate5-v7-kafka-tls-negatives.json" "$ROOT/matrices/kafka-tls-negatives.json"
if ! bash "$SCRIPT_DIR/prove-live-untrusted-kafka-negatives.sh" >"$ROOT/logs/untrusted-negatives.log" 2>&1; then
  fail_freeze "tls_untrusted" "UNTRUSTED_NEGATIVES_FAILED" "$(tail -c 2000 "$ROOT/logs/untrusted-negatives.log")"
fi
copy_report "$REPO_ROOT/reports/kafka/gate5-v7-live-untrusted-negatives.json" "$ROOT/matrices/live-untrusted-negatives.json"
acl_checkpoint "02-after-tls-negatives"

# 5. Authorization matrix (effect-aware)
log "Authorization canary (effect-aware verdict)"
export RP_GATE5_V7_AUTHZ_EVIDENCE_ROOT="$ROOT/matrices/authorization-canary"
set +e
bash "$SCRIPT_DIR/gate5-v7-authorization-canary.sh" >"$ROOT/logs/authorization-canary.log" 2>&1
authz_rc=$?
set -e
copy_report "$REPO_ROOT/reports/kafka/gate5-v7-authorization-canary-summary.json" "$ROOT/matrices/authorization-canary-summary.json"
if [[ "$authz_rc" -eq 2 ]] || grep -q 'HARNESS_CANNOT_DISTINGUISH\|AUTHZ_HARD_FAILURE' "$ROOT/logs/authorization-canary.log"; then
  fail_freeze "authorization" "HARNESS_CANNOT_DISTINGUISH_DENIED_VS_DELIVERED" "$(tail -c 3000 "$ROOT/logs/authorization-canary.log")"
fi
if [[ "$authz_rc" -ne 0 ]]; then
  fail_freeze "authorization" "AUTHORIZATION_MATRIX_FAILED" "$(tail -c 3000 "$ROOT/logs/authorization-canary.log")"
fi
python3 - <<'PY' || exit 1
import json
from pathlib import Path
import os
s=json.loads(Path(os.environ["RP_GATE5_V8_ROOT"],"matrices/authorization-canary-summary.json").read_text())
assert s.get("passed") is True
assert s.get("unauthorized_records_written",0)==0
assert s.get("indistinguishable_rows",0)==0
assert s.get("process_exit_code_authoritative") is False
print("AUTHZ_EFFECT_AWARE_OK")
PY
acl_checkpoint "03-after-authorization"

# 6. Nineteen-role rediscovery (corrected: bare suffix may repeat; contract/live IDs must not)
log "Nineteen-role rediscovery"
python3 "$SCRIPT_DIR/lib/gate5_role_census.py" production \
  >"$ROOT/matrices/nineteen-role-census.json" \
  || fail_freeze "nineteen_roles" "ROLE_CENSUS_FAILED" "$(tail -c 1500 "$ROOT/matrices/nineteen-role-census.json" 2>/dev/null || true)"
python3 - <<'PY' || fail_freeze "nineteen_roles" "ROLE_CENSUS_MISMATCH"
import json, os
from pathlib import Path
root = Path(os.environ["RP_GATE5_V8_ROOT"])
body = json.loads((root / "matrices/nineteen-role-census.json").read_text())
assert body.get("ok") is True
assert body.get("roles_expected") == 19 and body.get("roles_discovered") == 19
assert body.get("unique_contract_role_keys") == 19
assert body.get("unique_required_client_id_forms") == 19
assert body.get("duplicate_live_client_ids") == []
assert body.get("generic_client_ids") == 0
assert body.get("missing_role_suffix") == 0
assert body.get("unique_bare_role_suffixes") != body.get("roles_expected")
print(json.dumps({
  "ok": True,
  "roles_expected_discovered": f"{body['roles_expected']}/{body['roles_discovered']}",
  "unique_contract_role_keys": body["unique_contract_role_keys"],
  "unique_required_client_id_forms": body["unique_required_client_id_forms"],
  "unique_bare_role_suffixes": body["unique_bare_role_suffixes"],
  "duplicate_bare_role_suffixes": body["duplicate_bare_role_suffixes"],
  "bare_role_suffix_counts": body["bare_role_suffix_counts"],
}, indent=2))
PY

# 7. Broker-specific produce/consume/offset — three-broker acceptance still stub; use lightweight admin job
log "Broker-specific metadata/produce/consume/offset proof"
bash "$SCRIPT_DIR/gate5-v8-broker-matrix.sh" >"$ROOT/logs/broker-matrix.log" 2>&1 \
  || fail_freeze "broker_matrix" "BROKER_MATRIX_FAILED" "$(tail -c 3000 "$ROOT/logs/broker-matrix.log")"
acl_checkpoint "04-after-broker-matrix"

# 8. Event/outbox contract audit (real lineage partial — freeze if cannot prove)
log "Event/outbox contract audit"
REPORT_DIR="$ROOT/matrices/event-outbox" bash "$SCRIPT_DIR/audit-rp-event-outbox-contract.sh" \
  >"$ROOT/logs/event-outbox.log" 2>&1 \
  || fail_freeze "event_outbox" "EVENT_OUTBOX_CONTRACT_FAILED" "$(tail -c 3000 "$ROOT/logs/event-outbox.log")"

# Mark progress checkpoint — remaining recovery/obs phases continue in same runner if present
log "Phase transport+authz+broker+outbox-contract complete; continuing recovery if scripts present"
if [[ -f "$SCRIPT_DIR/gate5-v8-recovery-matrix.sh" ]]; then
  bash "$SCRIPT_DIR/gate5-v8-recovery-matrix.sh" >"$ROOT/logs/recovery-matrix.log" 2>&1 \
    || fail_freeze "recovery" "RECOVERY_MATRIX_FAILED" "$(tail -c 3000 "$ROOT/logs/recovery-matrix.log")"
  acl_checkpoint "05-after-recovery"
fi

acl_checkpoint "99-final"
log "Matrix runner finished intermediate phases — check STATUS for PASS eligibility"
echo "GATE5_V8_PHASES_COMPLETE_THROUGH=broker_event_acl"
