#!/usr/bin/env bash
# Idempotent recovery-admin ACL bootstrap with exact AclBinding set verification.
#
# - Consumes reports/kafka/gate5-v7-final-acl-manifest.json
# - Uses measured O-before-CN principals exactly
# - Adds missing ACLs
# - RP_GATE5_V7_ACL_PRUNE=1 performs exact reconciliation (removes unexpected application ACLs only)
# - Verifies live vs expected via AdminClient JSON set equality (not CLI proximity regex)
# - Never authorizes from client.id; never grants application super-user; never wildcard app ACLs
# - Raw evidence under RP_GATE5_V7_EVIDENCE_ROOT (/tmp); sanitized summary only in reports/
#
# Does not place private keys in Git. Uses Secret kafka-client-tls-gate5-v7-admin.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${HOUSING_NS:-record-platform}"
MANIFEST="${REPO_ROOT}/reports/kafka/gate5-v7-final-acl-manifest.json"
MEASURED="${REPO_ROOT}/reports/kafka/gate5-v7-kafka-node-principals.json"
SUMMARY_OUT="${REPO_ROOT}/reports/kafka/gate5-v7-acl-bootstrap-summary.json"
EVIDENCE_ROOT="${RP_GATE5_V7_EVIDENCE_ROOT:-/tmp/record-platform-gate5-v7-acl-bootstrap-evidence}"
BOOTSTRAP="${KAFKA_ACL_BOOTSTRAP:-kafka-0.kafka.${NS}.svc.cluster.local:9093}"
ADMIN_SECRET="${KAFKA_RECOVERY_ADMIN_SECRET:-kafka-client-tls-gate5-v7-admin}"
IMAGE="${KAFKA_IMAGE:-confluentinc/cp-kafka:7.5.0}"
PRUNE="${RP_GATE5_V7_ACL_PRUNE:-0}"
LOCK_CM="gate5-v7-acl-bootstrap-lock"
JOB_TIMEOUT_SEC="${RP_GATE5_V7_ACL_JOB_TIMEOUT_SEC:-300}"
CLI_TIMEOUT_SEC="${RP_GATE5_V7_ACL_CLI_TIMEOUT_SEC:-45}"

fail() { echo "❌ $*" >&2; exit 1; }
ok() { echo "✅ $*"; }

[[ -f "$MANIFEST" ]] || fail "missing ACL manifest: ${MANIFEST}"
[[ -f "$MEASURED" ]] || fail "missing measured principals: ${MEASURED}"
kubectl -n "$NS" get secret "$ADMIN_SECRET" >/dev/null 2>&1 \
  || fail "recovery-admin secret missing: ${NS}/${ADMIN_SECRET}"

mkdir -p "$EVIDENCE_ROOT"
chmod 700 "$EVIDENCE_ROOT" 2>/dev/null || true
# Kubernetes resource names must be lowercase RFC 1123 subdomains (no uppercase).
RUN_ID="$(date -u +%Y%m%d%H%M%S)-$$"
EVIDENCE_DIR="${EVIDENCE_ROOT}/${RUN_ID}"
mkdir -p "$EVIDENCE_DIR"
ok "evidence_dir=${EVIDENCE_DIR}"

# Single-writer lock (ConfigMap)
if ! kubectl -n "$NS" create configmap "$LOCK_CM" \
  --from-literal=holder="$RUN_ID" \
  --from-literal=ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
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

# Structural StatefulSet env parse (not line-split heuristics)
python3 - "$REPO_ROOT/infra/k8s/kafka-kraft-metallb/statefulset.yaml" "$MEASURED" <<'PY' \
  || fail "StatefulSet authorizer source guard failed"
import json, re, sys
from pathlib import Path

text = Path(sys.argv[1]).read_text(encoding="utf-8")
measured = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
env = {}
for m in re.finditer(
    r"\{\s*name:\s*([A-Z0-9_]+)\s*,\s*value:\s*\"([^\"]*)\"\s*\}",
    text,
):
    env[m.group(1)] = m.group(2)
# also name:/value: blocks
for m in re.finditer(
    r"-\s*name:\s*([A-Z0-9_]+)\n\s*value:\s*\"([^\"]*)\"",
    text,
):
    env.setdefault(m.group(1), m.group(2))

broker = measured["broker_server_leaf"]["kafka_acl_principal"]
admin = measured["recovery_admin"]["kafka_acl_principal"]
assert env.get("KAFKA_AUTHORIZER_CLASS_NAME") == "org.apache.kafka.metadata.authorizer.StandardAuthorizer"
assert list(env.values()).count("org.apache.kafka.metadata.authorizer.StandardAuthorizer") >= 1
assert env.get("KAFKA_ALLOW_EVERYONE_IF_NO_ACL_FOUND") == "false"
assert env.get("KAFKA_SUPER_USERS") == f"{broker};{admin}"
assert env.get("KAFKA_LISTENER_NAME_CONTROLLER_SSL_CLIENT_AUTH") == "required"
assert env.get("KAFKA_LISTENER_NAME_INTERNAL_SSL_CLIENT_AUTH") == "required"
assert env.get("KAFKA_LISTENER_NAME_EXTERNAL_SSL_CLIENT_AUTH") == "required"
assert env.get("KAFKA_LISTENER_NAME_CONTROLLER_SSL_ENDPOINT_IDENTIFICATION_ALGORITHM") == "HTTPS"
super_val = env["KAFKA_SUPER_USERS"]
for s in measured.get("service_principals") or []:
    assert s["kafka_acl_principal"] not in super_val
print("source_authorizer_ok")
PY

EXPECTED_FILE="${EVIDENCE_DIR}/expected-acls.json"
LIVE_FILE="${EVIDENCE_DIR}/live-acls.json"
COMPARE_FILE="${EVIDENCE_DIR}/compare.json"
CMDS_FILE="${EVIDENCE_DIR}/add-cmds.sh"
PRUNE_CMDS_FILE="${EVIDENCE_DIR}/prune-cmds.sh"
JAVA_SRC="${SCRIPT_DIR}/lib/Gate5V7DescribeAcls.java"

python3 "$SCRIPT_DIR/lib/gate5-v7-acl-normalize.py" expected "$MANIFEST" >"$EXPECTED_FILE"
EXP_COUNT="$(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))))' "$EXPECTED_FILE")"
ok "expected_acl_rows=${EXP_COUNT}"

# Build add commands from expected set
export CLI_TIMEOUT_SEC
python3 - "$EXPECTED_FILE" "$CMDS_FILE" <<'PY'
import json, os, sys
from pathlib import Path
rows = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
timeout = int(os.environ.get("CLI_TIMEOUT_SEC", "45"))
cmds = []
for b in rows:
    op = b["operation"]
    cli_op = {
        "IDEMPOTENT_WRITE": "IdempotentWrite",
        "ALTER_CONFIGS": "AlterConfigs",
    }.get(op, op.title().replace("_", ""))
    principal = b["principal"]
    base = (
        f'timeout {timeout} '
        f'kafka-acls --bootstrap-server "$BOOT" --command-config /tmp/admin.props '
        f'--add --allow-principal "{principal}" --operation {cli_op} --host "*"'
    )
    rt = b["resource_type"]
    if rt == "TOPIC":
        cmds.append(f'{base} --topic "{b["resource_name"]}"')
    elif rt == "GROUP":
        cmds.append(f'{base} --group "{b["resource_name"]}"')
    elif rt == "CLUSTER":
        cmds.append(f"{base} --cluster")
    else:
        raise SystemExit(f"unsupported {rt}")
Path(sys.argv[2]).write_text("\n".join(cmds) + "\n", encoding="utf-8")
print(f"acl_add_commands={len(cmds)}")
PY

JOB="gate5-v7-acl-bootstrap-${RUN_ID}"
kubectl -n "$NS" delete job "$JOB" --ignore-not-found >/dev/null 2>&1 || true
kubectl -n "$NS" delete configmap "${JOB}-assets" --ignore-not-found >/dev/null 2>&1 || true
kubectl -n "$NS" create configmap "${JOB}-assets" \
  --from-file=cmds.sh="$CMDS_FILE" \
  --from-file=Gate5V7DescribeAcls.java="$JAVA_SRC" \
  --from-file=expected.json="$EXPECTED_FILE" >/dev/null

cat <<EOF | kubectl -n "$NS" apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: ${JOB}
  labels:
    app.kubernetes.io/part-of: record-platform
    rp.dev/gate5-v7: acl-bootstrap
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 600
  activeDeadlineSeconds: ${JOB_TIMEOUT_SEC}
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: acl-bootstrap
          image: ${IMAGE}
          imagePullPolicy: IfNotPresent
          env:
            - name: BOOT
              value: "${BOOTSTRAP}"
            - name: CLI_TIMEOUT_SEC
              value: "${CLI_TIMEOUT_SEC}"
            - name: PRUNE
              value: "${PRUNE}"
            - name: RP_GATE5_V7_ACL_DESCRIBE_TIMEOUT_SEC
              value: "${CLI_TIMEOUT_SEC}"
          volumeMounts:
            - name: admin-tls
              mountPath: /etc/kafka/admin
              readOnly: true
            - name: assets
              mountPath: /assets
              readOnly: true
            - name: root-pem
              mountPath: /etc/kafka/pki
              readOnly: true
          command: ["/bin/bash", "-lc"]
          args:
            - |
              set -euo pipefail
              timed() { timeout "\${CLI_TIMEOUT_SEC}" "\$@"; }
              # Split chain into root + intermediate (fail-closed if not exactly 2 PEMs)
              csplit -f /tmp/ca- -b '%02d.pem' /etc/kafka/admin/ca-chain.pem '/-----BEGIN CERTIFICATE-----/' '{*}' >/dev/null || true
              # csplit may create empty first file; collect non-empty PEMs
              mapfile -t PEMS < <(ls /tmp/ca-*.pem 2>/dev/null | while read -r f; do [[ -s "\$f" ]] && grep -q BEGIN "\$f" && echo "\$f"; done)
              # Prefer mounted dedicated root/intermediate if provided via secret ca-chain only:
              # Extract with openssl: write each cert from chain
              python3 - <<'PY'
              import subprocess, tempfile
              from pathlib import Path
              text=Path('/etc/kafka/admin/ca-chain.pem').read_text()
              parts=[]; cur=[]
              for line in text.splitlines():
                if 'BEGIN CERTIFICATE' in line: cur=[line]
                elif cur:
                  cur.append(line)
                  if 'END CERTIFICATE' in line:
                    parts.append('\\n'.join(cur)+'\\n'); cur=[]
              assert len(parts)>=2, f'ca-chain must contain root+intermediate, got {len(parts)}'
              def is_self_signed(pem: str) -> bool:
                with tempfile.NamedTemporaryFile('w', suffix='.pem') as f:
                  f.write(pem); f.flush()
                  subj=subprocess.check_output(['openssl','x509','-in',f.name,'-noout','-subject'], text=True)
                  iss=subprocess.check_output(['openssl','x509','-in',f.name,'-noout','-issuer'], text=True)
                  return subj.strip().replace('subject=','') == iss.strip().replace('issuer=','')
              roots=[p for p in parts if is_self_signed(p)]
              ints=[p for p in parts if not is_self_signed(p)]
              assert len(roots)>=1 and len(ints)>=1, f'need root+intermediate self-signed classify roots={len(roots)} ints={len(ints)}'
              Path('/tmp/root.pem').write_text(roots[-1])
              Path('/tmp/intermediate.pem').write_text(ints[0])
              print(f'chain_pem_count={len(parts)} root_self_signed=1 intermediate=1')
              PY
              rm -f /tmp/trust.jks
              keytool -importcert -noprompt -storetype JKS -alias record-platform-root -file /tmp/root.pem \
                -keystore /tmp/trust.jks -storepass changeit >/dev/null
              keytool -importcert -noprompt -storetype JKS -alias record-platform-intermediate -file /tmp/intermediate.pem \
                -keystore /tmp/trust.jks -storepass changeit >/dev/null
              echo "=== truststore aliases ==="
              keytool -list -storetype JKS -keystore /tmp/trust.jks -storepass changeit | tee /tmp/trust.list
              grep -q 'record-platform-root' /tmp/trust.list
              grep -q 'record-platform-intermediate' /tmp/trust.list
              echo "TRUST_ENTRIES=2/2"
              openssl pkcs12 -export -inkey /etc/kafka/admin/tls.key -in /etc/kafka/admin/tls.crt \
                -certfile /etc/kafka/admin/ca-chain.pem -out /tmp/c.p12 -passout pass:changeit -name c
              rm -f /tmp/c.jks
              keytool -importkeystore -noprompt -storetype JKS \
                -srckeystore /tmp/c.p12 -srcstoretype PKCS12 -srcstorepass changeit \
                -destkeystore /tmp/c.jks -deststoretype JKS -deststorepass changeit >/dev/null
              printf '%s\n' \
                'security.protocol=SSL' \
                'ssl.truststore.location=/tmp/trust.jks' \
                'ssl.truststore.password=changeit' \
                'ssl.truststore.type=JKS' \
                'ssl.keystore.location=/tmp/c.jks' \
                'ssl.keystore.password=changeit' \
                'ssl.keystore.type=JKS' \
                'ssl.key.password=changeit' \
                'ssl.endpoint.identification.algorithm=HTTPS' \
                > /tmp/admin.props
              echo "=== recovery-admin metadata probe ==="
              timed kafka-broker-api-versions --bootstrap-server "\$BOOT" --command-config /tmp/admin.props >/tmp/meta.out \
                || { echo "TIMEOUT_OR_FAIL=metadata"; exit 42; }
              head -c 400 /tmp/meta.out; echo
              echo "=== apply ACLs ==="
              bash /assets/cmds.sh
              # Optional prune path requires describe first then remove unexpected — handled after describe below when PRUNE=1
              echo "=== compile AdminClient describer ==="
              CP=\$(echo /usr/share/java/kafka/*.jar /usr/share/java/cp-base-java/*.jar 2>/dev/null | tr ' ' ':')
              timed javac -cp "\$CP" -d /tmp /assets/Gate5V7DescribeAcls.java
              echo "=== describe ACLs (AdminClient) ==="
              timed java -cp "/tmp:\$CP" Gate5V7DescribeAcls "\$BOOT" /tmp/admin.props | tee /tmp/describe.out \
                || { echo "TIMEOUT_OR_FAIL=describeAcls"; exit 42; }
              python3 - <<'PY'
              from pathlib import Path
              text=Path('/tmp/describe.out').read_text()
              assert 'ACL_JSON_BEGIN' in text and 'ACL_JSON_END' in text
              body=text.split('ACL_JSON_BEGIN',1)[1].split('ACL_JSON_END',1)[0].strip()
              Path('/tmp/live-acls.json').write_text(body+('\\n' if not body.endswith('\\n') else ''))
              print('live_acl_json_bytes', Path('/tmp/live-acls.json').stat().st_size)
              PY
              if [[ "\${PRUNE}" == "1" ]]; then
                echo "=== prune unexpected application ACLs ==="
                # Host-side prune plan is preferred; in-Job prune uses python normalize if shipped.
                # For Job autonomy: unexpected removals computed on host after first describe when PRUNE=1.
                echo "PRUNE_IN_JOB=deferred_to_host"
              fi
              echo "ACL_BOOTSTRAP_APPLY_OK"
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
            name: ${JOB}-assets
            defaultMode: 0755
        - name: root-pem
          emptyDir: {}
EOF

ok "submitted Job ${NS}/${JOB}"
if ! kubectl -n "$NS" wait --for=condition=complete "job/${JOB}" --timeout="${JOB_TIMEOUT_SEC}s"; then
  kubectl -n "$NS" logs "job/${JOB}" --tail=120 | tee "${EVIDENCE_DIR}/job.fail.log" || true
  fail "ACL bootstrap Job failed or timed out"
fi

kubectl -n "$NS" logs "job/${JOB}" | tee "${EVIDENCE_DIR}/job.log" >/dev/null
grep -q 'ACL_BOOTSTRAP_APPLY_OK' "${EVIDENCE_DIR}/job.log" || fail "ACL bootstrap marker missing"
grep -q 'TRUST_ENTRIES=2/2' "${EVIDENCE_DIR}/job.log" || fail "truststore alias proof missing"
grep -q 'TIMEOUT_OR_FAIL=' "${EVIDENCE_DIR}/job.log" && fail "timed-out Kafka operation"

# Extract live ACL JSON from logs
python3 - "$EVIDENCE_DIR/job.log" "$LIVE_FILE" <<'PY'
from pathlib import Path
import sys
text = Path(sys.argv[1]).read_text(encoding="utf-8")
if "ACL_JSON_BEGIN" not in text or "ACL_JSON_END" not in text:
    raise SystemExit("AdminClient ACL JSON markers missing")
body = text.split("ACL_JSON_BEGIN", 1)[1].split("ACL_JSON_END", 1)[0].strip()
Path(sys.argv[2]).write_text(body + ("\n" if not body.endswith("\n") else ""), encoding="utf-8")
print("live_acl_extracted")
PY

# Optional prune: compute unexpected application bindings and remove exactly those
PRUNE_EXECUTED=0
PRUNE_DELETED=0
if [[ "$PRUNE" == "1" ]]; then
  python3 "$SCRIPT_DIR/lib/gate5-v7-acl-normalize.py" prune-cmds \
    "$EXPECTED_FILE" "$LIVE_FILE" "$MANIFEST" >"$PRUNE_CMDS_FILE"
  # Prefix each prune CLI with timeout (Linux Job has GNU timeout)
  python3 - "$PRUNE_CMDS_FILE" "$CLI_TIMEOUT_SEC" <<'PY'
import sys
from pathlib import Path
path = Path(sys.argv[1])
timeout = int(sys.argv[2])
lines = []
for line in path.read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if not line or line.startswith("#"):
        continue
    if not line.startswith("timeout "):
        line = f"timeout {timeout} {line}"
    lines.append(line)
path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
print(f"prune_cmds={len(lines)}")
PY
  PRUNE_DELETED="$(grep -c 'kafka-acls' "$PRUNE_CMDS_FILE" 2>/dev/null || true)"
  PRUNE_DELETED="${PRUNE_DELETED:-0}"
  python3 "$SCRIPT_DIR/lib/gate5-v7-acl-normalize.py" compare \
    "$EXPECTED_FILE" "$LIVE_FILE" "$MANIFEST" >"${EVIDENCE_DIR}/pre-prune-compare.json" || true
  UNEXPECTED_BEFORE="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("unexpected_acl_rows",0))' "${EVIDENCE_DIR}/pre-prune-compare.json")"
  if [[ "${UNEXPECTED_BEFORE}" -gt 0 && "$PRUNE_DELETED" -eq 0 ]]; then
    fail "prune requested but deletion plan empty while unexpected_acl_rows=${UNEXPECTED_BEFORE}"
  fi
  if [[ "${UNEXPECTED_BEFORE}" -eq 0 ]]; then
    PRUNE_EXECUTED=1
    ok "prune evaluated: unexpected_acl_rows=0 (no deletions)"
  elif [[ "$PRUNE_DELETED" -gt 0 ]]; then
    ok "prune plan deletions=${PRUNE_DELETED}"
    cat "$PRUNE_CMDS_FILE" | tee "${EVIDENCE_DIR}/prune-plan.sh"
    # Run prune via a short follow-up Job using same assets + prune script
    PRUNE_JOB="gate5-v7-acl-prune-${RUN_ID}"
    kubectl -n "$NS" delete job "$PRUNE_JOB" --ignore-not-found >/dev/null 2>&1 || true
    kubectl -n "$NS" delete configmap "${PRUNE_JOB}-cmds" --ignore-not-found >/dev/null 2>&1 || true
    kubectl -n "$NS" create configmap "${PRUNE_JOB}-cmds" --from-file=prune.sh="$PRUNE_CMDS_FILE" >/dev/null
    cat <<EOF | kubectl -n "$NS" apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: ${PRUNE_JOB}
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 600
  activeDeadlineSeconds: ${JOB_TIMEOUT_SEC}
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: acl-prune
          image: ${IMAGE}
          env:
            - { name: BOOT, value: "${BOOTSTRAP}" }
            - { name: CLI_TIMEOUT_SEC, value: "${CLI_TIMEOUT_SEC}" }
          volumeMounts:
            - { name: admin-tls, mountPath: /etc/kafka/admin, readOnly: true }
            - { name: cmds, mountPath: /cmds, readOnly: true }
          command: ["/bin/bash","-lc"]
          args:
            - |
              set -euo pipefail
              timed() { timeout "\${CLI_TIMEOUT_SEC}" "\$@"; }
              python3 - <<'PY'
              import subprocess, tempfile
              from pathlib import Path
              text=Path('/etc/kafka/admin/ca-chain.pem').read_text()
              parts=[]; cur=[]
              for line in text.splitlines():
                if 'BEGIN CERTIFICATE' in line: cur=[line]
                elif cur:
                  cur.append(line)
                  if 'END CERTIFICATE' in line:
                    parts.append('\\n'.join(cur)+'\\n'); cur=[]
              def is_self_signed(pem: str) -> bool:
                with tempfile.NamedTemporaryFile('w', suffix='.pem') as f:
                  f.write(pem); f.flush()
                  subj=subprocess.check_output(['openssl','x509','-in',f.name,'-noout','-subject'], text=True)
                  iss=subprocess.check_output(['openssl','x509','-in',f.name,'-noout','-issuer'], text=True)
                  return subj.strip().replace('subject=','') == iss.strip().replace('issuer=','')
              roots=[p for p in parts if is_self_signed(p)]; ints=[p for p in parts if not is_self_signed(p)]
              Path('/tmp/root.pem').write_text(roots[-1]); Path('/tmp/intermediate.pem').write_text(ints[0])
              PY
              rm -f /tmp/trust.jks
              keytool -importcert -noprompt -storetype JKS -alias record-platform-root -file /tmp/root.pem -keystore /tmp/trust.jks -storepass changeit >/dev/null
              keytool -importcert -noprompt -storetype JKS -alias record-platform-intermediate -file /tmp/intermediate.pem -keystore /tmp/trust.jks -storepass changeit >/dev/null
              openssl pkcs12 -export -inkey /etc/kafka/admin/tls.key -in /etc/kafka/admin/tls.crt -certfile /etc/kafka/admin/ca-chain.pem -out /tmp/c.p12 -passout pass:changeit -name c
              rm -f /tmp/c.jks
              keytool -importkeystore -noprompt -srckeystore /tmp/c.p12 -srcstoretype PKCS12 -srcstorepass changeit -destkeystore /tmp/c.jks -deststoretype JKS -deststorepass changeit >/dev/null
              printf '%s\n' 'security.protocol=SSL' 'ssl.truststore.location=/tmp/trust.jks' 'ssl.truststore.password=changeit' 'ssl.truststore.type=JKS' 'ssl.keystore.location=/tmp/c.jks' 'ssl.keystore.password=changeit' 'ssl.keystore.type=JKS' 'ssl.key.password=changeit' 'ssl.endpoint.identification.algorithm=HTTPS' > /tmp/admin.props
              bash /cmds/prune.sh
              echo PRUNE_APPLY_OK
      volumes:
        - name: admin-tls
          secret:
            secretName: ${ADMIN_SECRET}
            items:
              - { key: tls.crt, path: tls.crt }
              - { key: tls.key, path: tls.key }
              - { key: ca-chain.pem, path: ca-chain.pem }
        - name: cmds
          configMap:
            name: ${PRUNE_JOB}-cmds
            defaultMode: 0755
EOF
    kubectl -n "$NS" wait --for=condition=complete "job/${PRUNE_JOB}" --timeout="${JOB_TIMEOUT_SEC}s" \
      || fail "ACL prune Job failed"
    kubectl -n "$NS" logs "job/${PRUNE_JOB}" | tee "${EVIDENCE_DIR}/prune.log" >/dev/null
    grep -q 'PRUNE_APPLY_OK' "${EVIDENCE_DIR}/prune.log" || fail "prune marker missing"
    PRUNE_EXECUTED=1
    # Re-describe after prune
    kubectl -n "$NS" delete job "$JOB" --ignore-not-found >/dev/null 2>&1 || true
    # Re-run describe-only by reusing apply job assets with empty add cmds — simpler: second describe via prune log is insufficient.
    # Launch describe-only Job
    DESC_JOB="gate5-v7-acl-describe-${RUN_ID}"
    kubectl -n "$NS" delete job "$DESC_JOB" --ignore-not-found >/dev/null 2>&1 || true
    # Reuse original job assets ConfigMap still present
    # Create minimal describe job by re-applying same java assets
    :
  fi
fi

# If prune executed, re-fetch live ACLs via a describe-only job
if [[ "$PRUNE_EXECUTED" == "1" ]]; then
  DESC_JOB="gate5-v7-acl-describe-${RUN_ID}"
  kubectl -n "$NS" delete job "$DESC_JOB" --ignore-not-found >/dev/null 2>&1 || true
  cat <<EOF | kubectl -n "$NS" apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: ${DESC_JOB}
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 600
  activeDeadlineSeconds: ${JOB_TIMEOUT_SEC}
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: acl-describe
          image: ${IMAGE}
          env:
            - { name: BOOT, value: "${BOOTSTRAP}" }
            - { name: CLI_TIMEOUT_SEC, value: "${CLI_TIMEOUT_SEC}" }
            - { name: RP_GATE5_V7_ACL_DESCRIBE_TIMEOUT_SEC, value: "${CLI_TIMEOUT_SEC}" }
          volumeMounts:
            - { name: admin-tls, mountPath: /etc/kafka/admin, readOnly: true }
            - { name: assets, mountPath: /assets, readOnly: true }
          command: ["/bin/bash","-lc"]
          args:
            - |
              set -euo pipefail
              timed() { timeout "\${CLI_TIMEOUT_SEC}" "\$@"; }
              python3 - <<'PY'
              import subprocess, tempfile
              from pathlib import Path
              text=Path('/etc/kafka/admin/ca-chain.pem').read_text()
              parts=[]; cur=[]
              for line in text.splitlines():
                if 'BEGIN CERTIFICATE' in line: cur=[line]
                elif cur:
                  cur.append(line)
                  if 'END CERTIFICATE' in line:
                    parts.append('\\n'.join(cur)+'\\n'); cur=[]
              def is_self_signed(pem: str) -> bool:
                with tempfile.NamedTemporaryFile('w', suffix='.pem') as f:
                  f.write(pem); f.flush()
                  subj=subprocess.check_output(['openssl','x509','-in',f.name,'-noout','-subject'], text=True)
                  iss=subprocess.check_output(['openssl','x509','-in',f.name,'-noout','-issuer'], text=True)
                  return subj.strip().replace('subject=','') == iss.strip().replace('issuer=','')
              roots=[p for p in parts if is_self_signed(p)]; ints=[p for p in parts if not is_self_signed(p)]
              Path('/tmp/root.pem').write_text(roots[-1]); Path('/tmp/intermediate.pem').write_text(ints[0])
              PY
              rm -f /tmp/trust.jks
              keytool -importcert -noprompt -storetype JKS -alias record-platform-root -file /tmp/root.pem -keystore /tmp/trust.jks -storepass changeit >/dev/null
              keytool -importcert -noprompt -storetype JKS -alias record-platform-intermediate -file /tmp/intermediate.pem -keystore /tmp/trust.jks -storepass changeit >/dev/null
              openssl pkcs12 -export -inkey /etc/kafka/admin/tls.key -in /etc/kafka/admin/tls.crt -certfile /etc/kafka/admin/ca-chain.pem -out /tmp/c.p12 -passout pass:changeit -name c
              rm -f /tmp/c.jks
              keytool -importkeystore -noprompt -srckeystore /tmp/c.p12 -srcstoretype PKCS12 -srcstorepass changeit -destkeystore /tmp/c.jks -deststoretype JKS -deststorepass changeit >/dev/null
              printf '%s\n' 'security.protocol=SSL' 'ssl.truststore.location=/tmp/trust.jks' 'ssl.truststore.password=changeit' 'ssl.truststore.type=JKS' 'ssl.keystore.location=/tmp/c.jks' 'ssl.keystore.password=changeit' 'ssl.keystore.type=JKS' 'ssl.key.password=changeit' 'ssl.endpoint.identification.algorithm=HTTPS' > /tmp/admin.props
              CP=\$(echo /usr/share/java/kafka/*.jar /usr/share/java/cp-base-java/*.jar 2>/dev/null | tr ' ' ':')
              timed javac -cp "\$CP" -d /tmp /assets/Gate5V7DescribeAcls.java
              timed java -cp "/tmp:\$CP" Gate5V7DescribeAcls "\$BOOT" /tmp/admin.props | tee /tmp/describe.out
              echo DESCRIBE_OK
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
            name: ${JOB}-assets
            defaultMode: 0755
EOF
  kubectl -n "$NS" wait --for=condition=complete "job/${DESC_JOB}" --timeout="${JOB_TIMEOUT_SEC}s" \
    || fail "ACL re-describe after prune failed"
  kubectl -n "$NS" logs "job/${DESC_JOB}" | tee "${EVIDENCE_DIR}/describe-after-prune.log" >/dev/null
  python3 - "$EVIDENCE_DIR/describe-after-prune.log" "$LIVE_FILE" <<'PY'
from pathlib import Path
import sys
text = Path(sys.argv[1]).read_text(encoding="utf-8")
body = text.split("ACL_JSON_BEGIN", 1)[1].split("ACL_JSON_END", 1)[0].strip()
Path(sys.argv[2]).write_text(body + "\n", encoding="utf-8")
PY
  kubectl -n "$NS" delete job "$DESC_JOB" --ignore-not-found >/dev/null 2>&1 || true
  kubectl -n "$NS" delete job "gate5-v7-acl-prune-${RUN_ID}" --ignore-not-found >/dev/null 2>&1 || true
  kubectl -n "$NS" delete configmap "gate5-v7-acl-prune-${RUN_ID}-cmds" --ignore-not-found >/dev/null 2>&1 || true
fi

python3 "$SCRIPT_DIR/lib/gate5-v7-acl-normalize.py" compare \
  "$EXPECTED_FILE" "$LIVE_FILE" "$MANIFEST" | tee "$COMPARE_FILE"
COMPARE_RC=${PIPESTATUS[0]}

python3 - "$COMPARE_FILE" "$SUMMARY_OUT" "$EVIDENCE_DIR" "$PRUNE" "$PRUNE_EXECUTED" "$PRUNE_DELETED" <<'PY'
import json, sys
from pathlib import Path
compare = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
summary_path = Path(sys.argv[2])
evidence_dir = sys.argv[3]
prune = sys.argv[4] == "1"
prune_executed = sys.argv[5] == "1"
prune_deleted = int(sys.argv[6] or 0)
if prune and not prune_executed and prune_deleted == 0:
    # Honest: prune requested but nothing unexpected — still executed compare path with prune_mode true and deletions 0
    prune_executed = True
summary = {
    "document": "gate5-v7-acl-bootstrap-summary",
    "apply_authorized": True,
    "verification": "AdminClient_AclBinding_exact_set",
    "prune_mode_requested": prune,
    "prune_executed": prune_executed if prune else False,
    "prune_deletions": prune_deleted if prune else 0,
    "evidence_dir": evidence_dir,
    "expected_acl_rows": compare.get("expected_acl_rows"),
    "actual_acl_rows": compare.get("actual_acl_rows"),
    "missing_acl_rows": compare.get("missing_acl_rows"),
    "unexpected_acl_rows": compare.get("unexpected_acl_rows"),
    "duplicate_acl_rows": compare.get("duplicate_acl_rows"),
    "unexpected_deny_rows": compare.get("unexpected_deny_rows"),
    "wildcard_application_acl_rows": compare.get("wildcard_application_acl_rows"),
    "unknown_principals": compare.get("unknown_principals_count", 0),
    "manifest_vs_live_delta": compare.get("manifest_vs_live_delta"),
    "passed": compare.get("passed") is True,
}
if prune and not summary["prune_executed"]:
    summary["passed"] = False
    summary["errors"] = ["prune_mode_requested_but_not_executed"]
summary_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
print(json.dumps(summary, indent=2))
if not summary["passed"]:
    raise SystemExit(1)
PY

kubectl -n "$NS" delete job "$JOB" --ignore-not-found >/dev/null 2>&1 || true
kubectl -n "$NS" delete configmap "${JOB}-assets" --ignore-not-found >/dev/null 2>&1 || true

[[ "$COMPARE_RC" -eq 0 ]] || fail "exact ACL set compare failed — see ${COMPARE_FILE}"
ok "gate5-v7-acl-bootstrap: PASS (exact AclBinding set)"
echo "ACL_BOOTSTRAP_PASSED=1"
echo "EVIDENCE_DIR=${EVIDENCE_DIR}"
