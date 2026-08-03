#!/usr/bin/env bash
# Gate 5 ACL bootstrap / verify — describe ≠ reconcile.
#
# Default (acceptance): READ-ONLY pre-mutation snapshot + exact managed-universe compare.
# Mutation only when RP_GATE5_V7_ACL_RECONCILE=1 (creates missing + deletes unexpected managed).
# After reconcile, always re-describe and compare; then optional independent verify process.
#
# Raw evidence under RP_GATE5_V7_EVIDENCE_ROOT (/tmp). Git gets sanitized summary only.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${HOUSING_NS:-record-platform}"
MANIFEST="${REPO_ROOT}/reports/kafka/gate5-v7-final-acl-manifest.json"
MEASURED="${REPO_ROOT}/reports/kafka/gate5-v7-kafka-node-principals.json"
SCOPE="${REPO_ROOT}/reports/kafka/gate5-v8-acl-scope-contract.json"
SUMMARY_OUT="${REPO_ROOT}/reports/kafka/gate5-v7-acl-bootstrap-summary.json"
EVIDENCE_ROOT="${RP_GATE5_V7_EVIDENCE_ROOT:-/tmp/record-platform-gate5-v7-acl-bootstrap-evidence}"
BOOTSTRAP="${KAFKA_ACL_BOOTSTRAP:-kafka-0.kafka.${NS}.svc.cluster.local:9093}"
ADMIN_SECRET="${KAFKA_RECOVERY_ADMIN_SECRET:-kafka-client-tls-gate5-v7-admin}"
IMAGE="${KAFKA_IMAGE:-confluentinc/cp-kafka:7.5.0}"
RECONCILE="${RP_GATE5_V7_ACL_RECONCILE:-0}"
# Legacy alias — maps to reconcile
if [[ "${RP_GATE5_V7_ACL_PRUNE:-0}" == "1" ]]; then
  RECONCILE=1
fi
LOCK_CM="gate5-v7-acl-bootstrap-lock"
JOB_TIMEOUT_SEC="${RP_GATE5_V7_ACL_JOB_TIMEOUT_SEC:-300}"
CLI_TIMEOUT_SEC="${RP_GATE5_V7_ACL_CLI_TIMEOUT_SEC:-180}"
MODE="${1:-verify}" # verify | reconcile | independent-verify

fail() { echo "❌ $*" >&2; exit 1; }
ok() { echo "✅ $*"; }

[[ -f "$MANIFEST" ]] || fail "missing ACL manifest: ${MANIFEST}"
[[ -f "$MEASURED" ]] || fail "missing measured principals: ${MEASURED}"
[[ -f "$SCOPE" ]] || fail "missing ACL scope contract: ${SCOPE}"
kubectl -n "$NS" get secret "$ADMIN_SECRET" >/dev/null 2>&1 \
  || fail "recovery-admin secret missing: ${NS}/${ADMIN_SECRET}"

if [[ "$MODE" == "reconcile" ]]; then
  RECONCILE=1
fi
if [[ "$MODE" == "independent-verify" ]]; then
  RECONCILE=0
  unset RP_GATE5_V7_ACL_RECONCILE RP_GATE5_V7_ACL_PRUNE 2>/dev/null || true
fi
if [[ "$MODE" == "verify" || "$MODE" == "independent-verify" ]] && [[ "$RECONCILE" == "1" ]]; then
  fail "acceptance verify forbids RP_GATE5_V7_ACL_RECONCILE=1 / prune"
fi

mkdir -p "$EVIDENCE_ROOT"
chmod 700 "$EVIDENCE_ROOT" 2>/dev/null || true
RUN_ID="$(date -u +%Y%m%d%H%M%S)-$$"
EVIDENCE_DIR="${EVIDENCE_ROOT}/${RUN_ID}"
mkdir -p "${EVIDENCE_DIR}/acl"
ok "evidence_dir=${EVIDENCE_DIR}"

if ! kubectl -n "$NS" create configmap "$LOCK_CM" \
  --from-literal=holder="$RUN_ID" \
  --from-literal=ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --from-literal=mode="$MODE" \
  -o name 2>/dev/null; then
  fail "ACL bootstrap lock held (${NS}/${LOCK_CM}); concurrent bootstrap forbidden"
fi
release_lock() {
  kubectl -n "$NS" delete configmap "$LOCK_CM" --ignore-not-found >/dev/null 2>&1 || true
}
trap 'release_lock' EXIT

bash "$SCRIPT_DIR/gate5-v7-authorizer-verify.sh" >/dev/null
python3 "$SCRIPT_DIR/gate5-v7-acl-offline-validate.py" >/dev/null \
  || fail "offline ACL validation failed"

EXPECTED_TSV="${EVIDENCE_DIR}/acl/expected-acls.tsv"
EXPECTED_META="${EVIDENCE_DIR}/acl/expected-meta.json"
LIVE_PRE="${EVIDENCE_DIR}/acl/pre-mutation-live-acls.json"
LIVE_PRE_SHA="${EVIDENCE_DIR}/acl/pre-mutation-live-acls.sha256"
COMPARE_PRE="${EVIDENCE_DIR}/acl/pre-mutation-compare.json"
PLAN_JSON="${EVIDENCE_DIR}/acl/reconcile-plan.json"
PLAN_TSV="${EVIDENCE_DIR}/acl/reconcile-plan.tsv"
LIVE_POST="${EVIDENCE_DIR}/acl/post-mutation-live-acls.json"
COMPARE_POST="${EVIDENCE_DIR}/acl/post-mutation-compare.json"
JAVA_SRC="${SCRIPT_DIR}/lib/Gate5V7AclAdmin.java"
ROOT_PEM="${REPO_ROOT}/certs/dev-root.pem"
INT_PEM="${REPO_ROOT}/certs/dev-intermediate.pem"

python3 "$SCRIPT_DIR/lib/gate5-v7-acl-normalize.py" expected-tsv "$MANIFEST" >"$EXPECTED_TSV"
python3 "$SCRIPT_DIR/lib/gate5-v7-acl-normalize.py" expected-json "$MANIFEST" >"$EXPECTED_META"
EXP_UNIQUE="$(python3 -c 'import json; print(json.load(open("'"$EXPECTED_META"'"))["meta"]["expected_rows_unique"])')"
ok "expected_acl_rows=${EXP_UNIQUE}"

run_admin_job() {
  local job_suffix="$1"
  local java_mode="$2"
  local plan_tsv="${3:-}"
  local out_log="$4"
  local job="gate5-v7-acl-${job_suffix}-${RUN_ID}"
  kubectl -n "$NS" delete job "$job" --ignore-not-found >/dev/null 2>&1 || true
  kubectl -n "$NS" delete configmap "${job}-assets" --ignore-not-found >/dev/null 2>&1 || true
  kubectl -n "$NS" delete configmap "${job}-ca" --ignore-not-found >/dev/null 2>&1 || true

  local cm_args=(--from-file=Gate5V7AclAdmin.java="$JAVA_SRC" --from-file=expected.tsv="$EXPECTED_TSV")
  if [[ -n "$plan_tsv" ]]; then
    cm_args+=(--from-file=plan.tsv="$plan_tsv")
  fi
  kubectl -n "$NS" create configmap "${job}-assets" "${cm_args[@]}" >/dev/null
  kubectl -n "$NS" create configmap "${job}-ca" \
    --from-file=dev-root.pem="$ROOT_PEM" \
    --from-file=dev-intermediate.pem="$INT_PEM" >/dev/null

  case "$java_mode" in
    describe|reconcile|apply) ;;
    *) fail "unknown java mode $java_mode" ;;
  esac

  cat <<EOF | kubectl -n "$NS" apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: ${job}
  labels:
    app.kubernetes.io/part-of: record-platform
    rp.dev/gate5-v7: acl-${job_suffix}
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 600
  activeDeadlineSeconds: ${JOB_TIMEOUT_SEC}
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: acl-admin
          image: ${IMAGE}
          imagePullPolicy: IfNotPresent
          env:
            - { name: BOOT, value: "${BOOTSTRAP}" }
            - { name: CLI_TIMEOUT_SEC, value: "${CLI_TIMEOUT_SEC}" }
            - { name: RP_GATE5_V7_ACL_DESCRIBE_TIMEOUT_SEC, value: "120" }
            - { name: JAVA_MODE, value: "${java_mode}" }
            - { name: EXPECTED_ROOT_FP, value: "$(openssl x509 -in "$ROOT_PEM" -noout -fingerprint -sha256 | sed 's/.*=//')" }
            - { name: EXPECTED_INT_FP, value: "$(openssl x509 -in "$INT_PEM" -noout -fingerprint -sha256 | sed 's/.*=//')" }
          volumeMounts:
            - { name: admin-tls, mountPath: /etc/kafka/admin, readOnly: true }
            - { name: assets, mountPath: /assets, readOnly: true }
            - { name: ca, mountPath: /tls/ca, readOnly: true }
          command: ["/bin/bash", "-lc"]
          args:
            - |
              set -euo pipefail
              timed() { timeout "\${CLI_TIMEOUT_SEC}" "\$@"; }
              cp /tls/ca/dev-root.pem /tmp/root.pem
              cp /tls/ca/dev-intermediate.pem /tmp/intermediate.pem
              rm -f /tmp/trust.jks
              keytool -importcert -noprompt -storetype JKS -alias record-platform-root -file /tmp/root.pem -keystore /tmp/trust.jks -storepass changeit >/dev/null
              keytool -importcert -noprompt -storetype JKS -alias record-platform-intermediate -file /tmp/intermediate.pem -keystore /tmp/trust.jks -storepass changeit >/dev/null
              keytool -list -storetype JKS -keystore /tmp/trust.jks -storepass changeit | tee /tmp/trust.list
              grep -q 'record-platform-root' /tmp/trust.list
              grep -q 'record-platform-intermediate' /tmp/trust.list
              ROOT_FP=\$(openssl x509 -in /tmp/root.pem -noout -fingerprint -sha256 | sed 's/.*=//' | tr -d ':' | tr 'a-f' 'A-F')
              INT_FP=\$(openssl x509 -in /tmp/intermediate.pem -noout -fingerprint -sha256 | sed 's/.*=//' | tr -d ':' | tr 'a-f' 'A-F')
              EXP_ROOT=\$(echo "\$EXPECTED_ROOT_FP" | tr -d ':' | tr 'a-f' 'A-F')
              EXP_INT=\$(echo "\$EXPECTED_INT_FP" | tr -d ':' | tr 'a-f' 'A-F')
              echo "TRUST_ENTRIES=2/2"
              echo "ROOT_ALIAS_PRESENT=true"
              echo "INTERMEDIATE_ALIAS_PRESENT=true"
              [[ "\$ROOT_FP" == "\$EXP_ROOT" ]] && echo "ROOT_FINGERPRINT_MATCHES=true" || { echo "ROOT_FINGERPRINT_MATCHES=false"; exit 43; }
              [[ "\$INT_FP" == "\$EXP_INT" ]] && echo "INTERMEDIATE_FINGERPRINT_MATCHES=true" || { echo "INTERMEDIATE_FINGERPRINT_MATCHES=false"; exit 43; }
              openssl pkcs12 -export -inkey /etc/kafka/admin/tls.key -in /etc/kafka/admin/tls.crt -certfile /etc/kafka/admin/ca-chain.pem -out /tmp/c.p12 -passout pass:changeit -name c
              rm -f /tmp/c.jks
              keytool -importkeystore -noprompt -srckeystore /tmp/c.p12 -srcstoretype PKCS12 -srcstorepass changeit -destkeystore /tmp/c.jks -deststoretype JKS -deststorepass changeit >/dev/null
              printf '%s\\n' 'security.protocol=SSL' 'ssl.truststore.location=/tmp/trust.jks' 'ssl.truststore.password=changeit' 'ssl.truststore.type=JKS' 'ssl.keystore.location=/tmp/c.jks' 'ssl.keystore.password=changeit' 'ssl.keystore.type=JKS' 'ssl.key.password=changeit' 'ssl.endpoint.identification.algorithm=HTTPS' > /tmp/admin.props
              timed kafka-broker-api-versions --bootstrap-server "\$BOOT" --command-config /tmp/admin.props >/tmp/meta.out \\
                || { echo "TIMEOUT_OR_FAIL=metadata"; exit 42; }
              CP=\$(echo /usr/share/java/kafka/*.jar /usr/share/java/cp-base-java/*.jar 2>/dev/null | tr ' ' ':')
              timed javac -cp "\$CP" -d /tmp /assets/Gate5V7AclAdmin.java
              case "\$JAVA_MODE" in
                describe) timed java -cp "/tmp:\$CP" Gate5V7AclAdmin describe "\$BOOT" /tmp/admin.props | tee /tmp/admin.out ;;
                reconcile) timed java -cp "/tmp:\$CP" Gate5V7AclAdmin reconcile "\$BOOT" /tmp/admin.props /assets/plan.tsv | tee /tmp/admin.out ;;
                apply) timed java -cp "/tmp:\$CP" Gate5V7AclAdmin apply "\$BOOT" /tmp/admin.props /assets/expected.tsv | tee /tmp/admin.out ;;
                *) echo "bad JAVA_MODE=\$JAVA_MODE"; exit 2 ;;
              esac || { echo "TIMEOUT_OR_FAIL=adminClient"; exit 42; }
              echo ACL_ADMIN_OK
      volumes:
        - name: admin-tls
          secret:
            secretName: ${ADMIN_SECRET}
            items:
              - { key: tls.crt, path: tls.crt }
              - { key: tls.key, path: tls.key }
              - { key: ca-chain.pem, path: ca-chain.pem }
        - name: assets
          configMap:
            name: ${job}-assets
            defaultMode: 0755
        - name: ca
          configMap:
            name: ${job}-ca
EOF

  if ! kubectl -n "$NS" wait --for=condition=complete "job/${job}" --timeout="${JOB_TIMEOUT_SEC}s"; then
    kubectl -n "$NS" logs "job/${job}" --tail=160 | tee "${out_log}.fail" || true
    fail "ACL admin Job ${job} failed or timed out"
  fi
  kubectl -n "$NS" logs "job/${job}" | tee "$out_log" >/dev/null
  grep -q 'ACL_ADMIN_OK' "$out_log" || fail "ACL_ADMIN_OK missing"
  grep -q 'TRUST_ENTRIES=2/2' "$out_log" || fail "truststore proof missing"
  grep -q 'ROOT_FINGERPRINT_MATCHES=true' "$out_log" || fail "root fingerprint mismatch"
  grep -q 'INTERMEDIATE_FINGERPRINT_MATCHES=true' "$out_log" || fail "intermediate fingerprint mismatch"
  grep -q 'TIMEOUT_OR_FAIL=' "$out_log" && fail "timed-out Kafka operation"
  kubectl -n "$NS" delete job "$job" --ignore-not-found >/dev/null 2>&1 || true
  kubectl -n "$NS" delete configmap "${job}-assets" --ignore-not-found >/dev/null 2>&1 || true
  kubectl -n "$NS" delete configmap "${job}-ca" --ignore-not-found >/dev/null 2>&1 || true
}

extract_acl_json() {
  local log="$1"
  local dest="$2"
  python3 - "$log" "$dest" <<'PY'
from pathlib import Path
import sys
text = Path(sys.argv[1]).read_text(encoding="utf-8")
if "ACL_JSON_BEGIN" not in text or "ACL_JSON_END" not in text:
    raise SystemExit("AdminClient ACL JSON markers missing")
body = text.split("ACL_JSON_BEGIN", 1)[1].split("ACL_JSON_END", 1)[0].strip()
Path(sys.argv[2]).write_text(body + ("\n" if not body.endswith("\n") else ""), encoding="utf-8")
print("live_acl_extracted")
PY
  python3 "$SCRIPT_DIR/lib/gate5-v7-acl-normalize.py" hash "$dest" | tee "${dest}.sha256" >/dev/null
  cp "${dest}.sha256" "${dest%.json}.sha256" 2>/dev/null || true
}

# A. PRE-MUTATION SNAPSHOT (describe only)
ok "pre-mutation describe (no mutation)"
run_admin_job "describe" "describe" "" "${EVIDENCE_DIR}/acl/describe-pre.log"
extract_acl_json "${EVIDENCE_DIR}/acl/describe-pre.log" "$LIVE_PRE"
python3 "$SCRIPT_DIR/lib/gate5-v7-acl-normalize.py" hash "$LIVE_PRE" >"$LIVE_PRE_SHA"
ok "pre-mutation sha256=$(cat "$LIVE_PRE_SHA")"

# B. READ-ONLY COMPARISON
set +e
python3 "$SCRIPT_DIR/lib/gate5-v7-acl-normalize.py" compare \
  "$EXPECTED_TSV" "$LIVE_PRE" "$MANIFEST" "$SCOPE" "$MEASURED" | tee "$COMPARE_PRE"
COMPARE_RC=${PIPESTATUS[0]}
set -e

MUTATION_ATTEMPTED=false
if [[ "$RECONCILE" == "1" ]]; then
  [[ "$COMPARE_RC" -eq 0 ]] && ok "already exact — reconcile still authorized but plan may be empty"
  python3 "$SCRIPT_DIR/lib/gate5-v7-acl-normalize.py" reconcile-plan \
    "$EXPECTED_TSV" "$LIVE_PRE" "$MANIFEST" "$SCOPE" "$MEASURED" | tee "$PLAN_JSON"
  python3 - "$PLAN_JSON" "$PLAN_TSV" <<'PY'
import json, sys
from pathlib import Path
plan = json.loads(Path(sys.argv[1]).read_text())
fields = ["resource_type","resource_name","resource_pattern_type","principal","host","operation","permission_type"]
lines = ["action\t" + "\t".join(fields)]
for b in plan["delete"]:
    lines.append("delete\t" + "\t".join(b[f] for f in fields))
for b in plan["create"]:
    lines.append("create\t" + "\t".join(b[f] for f in fields))
Path(sys.argv[2]).write_text("\n".join(lines) + "\n")
print(f"reconcile_plan delete={plan['delete_count']} create={plan['create_count']}")
PY
  ok "reconcile plan preserved at ${PLAN_JSON}"
  MUTATION_ATTEMPTED=true
  run_admin_job "reconcile" "reconcile" "${PLAN_TSV}" "${EVIDENCE_DIR}/acl/reconcile.log"
  run_admin_job "describe-post" "describe" "" "${EVIDENCE_DIR}/acl/describe-post.log"
  extract_acl_json "${EVIDENCE_DIR}/acl/describe-post.log" "$LIVE_POST"
  python3 "$SCRIPT_DIR/lib/gate5-v7-acl-normalize.py" compare \
    "$EXPECTED_TSV" "$LIVE_POST" "$MANIFEST" "$SCOPE" "$MEASURED" | tee "$COMPARE_POST"
  COMPARE_RC=${PIPESTATUS[0]}
  [[ "$COMPARE_RC" -eq 0 ]] || fail "post-mutation exact compare failed"
  FINAL_COMPARE="$COMPARE_POST"
  FINAL_LIVE="$LIVE_POST"
  CLASSIFICATION="RECONCILED_POST_MUTATION_MATCH"
else
  FINAL_COMPARE="$COMPARE_PRE"
  FINAL_LIVE="$LIVE_PRE"
  if [[ "$COMPARE_RC" -eq 0 ]]; then
    CLASSIFICATION="PREEXISTING_READ_ONLY_EXACT_MATCH"
  else
    CLASSIFICATION="READ_ONLY_DRIFT_DETECTED"
  fi
fi

python3 - "$FINAL_COMPARE" "$SUMMARY_OUT" "$EVIDENCE_DIR" "$RECONCILE" "$MUTATION_ATTEMPTED" "$CLASSIFICATION" "$MODE" <<'PY'
import json, sys
from pathlib import Path
compare = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
summary_path = Path(sys.argv[2])
evidence_dir = sys.argv[3]
reconcile = sys.argv[4] == "1"
mutation = sys.argv[5].lower() == "true"
classification = sys.argv[6]
mode = sys.argv[7]
preexisting = classification == "PREEXISTING_READ_ONLY_EXACT_MATCH" and not mutation
summary = {
    "document": "gate5-v7-acl-bootstrap-summary",
    "mode": mode,
    "verification": "AdminClient_describe_exact_managed_universe",
    "classification": classification,
    "preexisting_read_only_exact_match": preexisting,
    "mutation_attempted": mutation,
    "reconcile_mode_requested": reconcile,
    "apply_authorized": True,
    "evidence_dir": "/tmp/record-platform-gate5-v7-acl-bootstrap-evidence/<run-id>",
    "evidence_dir_runtime": evidence_dir,
    "expected_acl_rows": compare.get("expected_acl_rows"),
    "actual_managed_acl_rows": compare.get("actual_managed_acl_rows"),
    "missing_acl_rows": compare.get("missing_acl_rows"),
    "unexpected_acl_rows": compare.get("unexpected_acl_rows"),
    "duplicate_acl_rows": compare.get("duplicate_acl_rows"),
    "unexpected_deny_rows": compare.get("unexpected_deny_rows"),
    "wildcard_application_acl_rows": compare.get("wildcard_application_acl_rows"),
    "wrong_pattern_type_rows": compare.get("wrong_pattern_type_rows"),
    "wrong_host_rows": compare.get("wrong_host_rows"),
    "unknown_principal_rows": compare.get("unknown_principal_rows"),
    "stale_principals": compare.get("stale_principals"),
    "managed_resource_unknown_principal_rows": compare.get("managed_resource_unknown_principal_rows"),
    "forbidden_cluster_operation_rows": compare.get("forbidden_cluster_operation_rows"),
    "manifest_vs_live_delta": compare.get("manifest_vs_live_delta"),
    "passed": compare.get("passed") is True and (
        (mode in {"verify", "independent-verify"} and preexisting and not mutation)
        or (mode == "reconcile" and mutation and compare.get("passed") is True)
        or (mode == "verify" and not reconcile)  # allow reporting drift without claiming preexisting
    ),
}
# Acceptance verify modes require preexisting read-only match
if mode in {"verify", "independent-verify"}:
    summary["passed"] = preexisting and compare.get("passed") is True and not mutation
if mode == "reconcile":
    summary["passed"] = compare.get("passed") is True
summary_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
print(json.dumps(summary, indent=2))
if mode in {"verify", "independent-verify"} and not summary["passed"]:
    raise SystemExit(1)
if mode == "reconcile" and not summary["passed"]:
    raise SystemExit(1)
PY

if [[ "$MODE" == "independent-verify" || "$MODE" == "verify" ]]; then
  [[ "$(python3 -c 'import json; print(json.load(open("'"$SUMMARY_OUT"'"))["preexisting_read_only_exact_match"])')" == "True" ]] \
    || fail "preexisting_read_only_exact_match required for acceptance verify"
fi

ok "gate5-v7-acl-bootstrap: ${CLASSIFICATION}"
echo "ACL_CLASSIFICATION=${CLASSIFICATION}"
echo "MUTATION_ATTEMPTED=${MUTATION_ATTEMPTED}"
echo "EVIDENCE_DIR=${EVIDENCE_DIR}"
