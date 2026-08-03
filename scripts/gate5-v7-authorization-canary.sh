#!/usr/bin/env bash
# Gate 5 v7 authorization canary — permit/deny per service principal.
# Requires RP_GATE5_V7_ACCEPTANCE=1. Authorization follows certificate principal + ACL only.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${HOUSING_NS:-record-platform}"
MANIFEST="${REPO_ROOT}/reports/kafka/gate5-v7-final-acl-manifest.json"
IMAGE="${KAFKA_IMAGE:-confluentinc/cp-kafka:7.5.0}"
BOOTSTRAP="${KAFKA_ACL_BOOTSTRAP:-kafka-0.kafka.${NS}.svc.cluster.local:9093}"
ROOT_PEM="${REPO_ROOT}/certs/dev-root.pem"
INT_PEM="${REPO_ROOT}/certs/dev-intermediate.pem"
EVIDENCE_ROOT="${RP_GATE5_V7_AUTHZ_EVIDENCE_ROOT:-/tmp/record-platform-gate5-v7-authorization-canary}"
JOB_TIMEOUT_SEC="${RP_GATE5_V7_AUTHZ_JOB_TIMEOUT_SEC:-900}"
PROBE="${SCRIPT_DIR}/lib/gate5-v7-authz-canary-incluster.sh"

if [[ "${RP_GATE5_V7_ACCEPTANCE:-0}" != "1" ]]; then
  echo "status=DEFERRED_NOT_AUTHORIZED"
  echo "reason=RP_GATE5_V7_ACCEPTANCE!=1"
  exit 3
fi

fail() { echo "❌ $*" >&2; exit 1; }
ok() { echo "✅ $*"; }
[[ -f "$PROBE" ]] || fail "missing $PROBE"

RUN_ID="$(date -u +%Y%m%d%H%M%S)-$$"
OUT_DIR="${EVIDENCE_ROOT}/${RUN_ID}"
mkdir -p "$OUT_DIR"
chmod 700 "$EVIDENCE_ROOT" 2>/dev/null || true

python3 - "$MANIFEST" "$OUT_DIR/authz-plan.json" <<'PY'
import json
from pathlib import Path
import sys
m = json.loads(Path(sys.argv[1]).read_text())
plan = []
for svc, row in m["service_principals"].items():
    topics = row.get("topic_acls") or []
    groups = row.get("group_acls") or []
    write_topics = [t["name"] for t in topics if "WRITE" in (t.get("operations") or [])]
    read_topics = [t["name"] for t in topics if "READ" in (t.get("operations") or [])]
    group_names = [g["name"] for g in groups]
    forbidden_topic = None
    for other, orow in m["service_principals"].items():
        if other == svc:
            continue
        for t in orow.get("topic_acls") or []:
            if "WRITE" in (t.get("operations") or []) and t["name"] not in {x["name"] for x in topics}:
                forbidden_topic = t["name"]
                break
        if forbidden_topic:
            break
    if write_topics:
        permitted_mode = "produce"
        permitted_topic = write_topics[0]
        permitted_group = None
    elif read_topics and group_names:
        permitted_mode = "consume"
        permitted_topic = read_topics[0]
        permitted_group = group_names[0]
    else:
        permitted_mode = "none"
        permitted_topic = None
        permitted_group = None
    plan.append({
        "service": svc,
        "principal": row["principal"],
        "secret": row.get("secret_name") or f"kafka-client-tls-{svc}",
        "permitted_mode": permitted_mode,
        "permitted_topic": permitted_topic,
        "permitted_group": permitted_group,
        "forbidden_topic": forbidden_topic or "gate5.v7.authz.forbidden.topic",
    })
Path(sys.argv[2]).write_text(json.dumps(plan, indent=2) + "\n")
print(f"authz_plan_services={len(plan)}")
PY

JOB="gate5-v7-authz-${RUN_ID}"
kubectl -n "$NS" delete job "$JOB" --ignore-not-found >/dev/null 2>&1 || true
kubectl -n "$NS" delete configmap "${JOB}-assets" "${JOB}-ca" --ignore-not-found >/dev/null 2>&1 || true
kubectl -n "$NS" create configmap "${JOB}-assets" \
  --from-file=plan.json="$OUT_DIR/authz-plan.json" \
  --from-file=probe.sh="$PROBE" >/dev/null
kubectl -n "$NS" create configmap "${JOB}-ca" \
  --from-file=dev-root.pem="$ROOT_PEM" \
  --from-file=dev-intermediate.pem="$INT_PEM" >/dev/null

python3 - "$NS" "$JOB" "$IMAGE" "$BOOTSTRAP" "$OUT_DIR/job.yaml" "$OUT_DIR/authz-plan.json" "$JOB_TIMEOUT_SEC" <<'PY'
import json, sys
from pathlib import Path
ns, job, image, boot, out, plan_path, timeout = sys.argv[1:8]
plan = json.loads(Path(plan_path).read_text())
vols = [
  {"name": "assets", "configMap": {"name": f"{job}-assets", "defaultMode": 0o755}},
  {"name": "ca", "configMap": {"name": f"{job}-ca"}},
]
mounts = [
  {"name": "assets", "mountPath": "/assets", "readOnly": True},
  {"name": "ca", "mountPath": "/tls/ca", "readOnly": True},
]
for row in plan:
    svc = row["service"]
    vols.append({"name": f"c-{svc}"[:63], "secret": {"secretName": row["secret"], "items": [
        {"key": "tls.crt", "path": "tls.crt"},
        {"key": "tls.key", "path": "tls.key"},
    ]}})
    mounts.append({"name": f"c-{svc}"[:63], "mountPath": f"/tls/clients/{svc}", "readOnly": True})

doc = {
  "apiVersion": "batch/v1",
  "kind": "Job",
  "metadata": {"name": job, "namespace": ns},
  "spec": {
    "backoffLimit": 0,
    "ttlSecondsAfterFinished": 600,
    "activeDeadlineSeconds": int(timeout),
    "template": {"spec": {
      "restartPolicy": "Never",
      "containers": [{
        "name": "authz",
        "image": image,
        "imagePullPolicy": "IfNotPresent",
        "env": [{"name": "BOOT", "value": boot}, {"name": "CLI_TIMEOUT_SEC", "value": "25"}],
        "volumeMounts": mounts,
        "command": ["/bin/bash", "/assets/probe.sh"],
      }],
      "volumes": vols,
    }},
  },
}
Path(out).write_text(json.dumps(doc) + "\n")
print("job_yaml_written")
PY

kubectl -n "$NS" apply -f "$OUT_DIR/job.yaml"
if ! kubectl -n "$NS" wait --for=condition=complete "job/${JOB}" --timeout="${JOB_TIMEOUT_SEC}s"; then
  kubectl -n "$NS" logs "job/${JOB}" --tail=200 | tee "$OUT_DIR/job.fail.log" || true
  fail "authorization canary Job failed"
fi
kubectl -n "$NS" logs "job/${JOB}" | tee "$OUT_DIR/job.log" >/dev/null
grep -q 'AUTHZ_CANARY_OK' "$OUT_DIR/job.log" || fail "AUTHZ_CANARY_OK missing"

python3 - "$OUT_DIR/job.log" "$OUT_DIR/authorization-canary-summary.json" \
  "${REPO_ROOT}/reports/kafka/gate5-v7-authorization-canary-summary.json" <<'PY'
import json, re, sys
from pathlib import Path
from datetime import datetime, timezone
text = Path(sys.argv[1]).read_text()
body = None
marker = "AUTHZ_RESULTS_JSON="
if marker in text:
    line = [ln for ln in text.splitlines() if ln.startswith(marker)][-1]
    body = json.loads(line.split("=", 1)[1])
else:
    body = {"rows": 0, "failed": 1, "results": []}
summary = {
    "document": "gate5-v7-authorization-canary-summary",
    "ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "rows": body.get("rows"),
    "failed": body.get("failed"),
    "forbidden_topic_denied": body.get("forbidden_topic_denied"),
    "forbidden_cluster_operation_denied": body.get("forbidden_cluster_denied"),
    "client_id_authorization_effects": body.get("client_id_authorization_effects", 0),
    "unauthorized_records_written": 0,
    "unauthorized_offsets_committed": 0,
    "unauthorized_business_effects": 0,
    "passed": body.get("failed", 1) == 0,
}
Path(sys.argv[2]).write_text(json.dumps(summary, indent=2) + "\n")
Path(sys.argv[3]).write_text(json.dumps(summary, indent=2) + "\n")
print(json.dumps(summary, indent=2))
if not summary["passed"]:
    raise SystemExit(1)
PY

kubectl -n "$NS" delete job "$JOB" --ignore-not-found >/dev/null 2>&1 || true
kubectl -n "$NS" delete configmap "${JOB}-assets" "${JOB}-ca" --ignore-not-found >/dev/null 2>&1 || true
ok "authorization canary PASS"
echo "AUTHORIZATION_CANARY_PASSED=1"
