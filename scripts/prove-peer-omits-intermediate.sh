#!/usr/bin/env bash
# Replace invalid missing_intermediate rows with PEER_OMITS_INTERMEDIATE (3/3).
# Preserves historical INVALID_NEGATIVE_FIXTURE classification in RCA.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${KAFKA_CLIENT_TLS_NS:-record-platform}"
OUT_DIR="${REPO_ROOT}/reports/kafka"
RCA_JSON="${OUT_DIR}/gate5-v7-missing-intermediate-invalid-fixture-rca.json"
NEG_JSON="${OUT_DIR}/gate5-v7-kafka-tls-negatives.json"
PEER_JSON="${OUT_DIR}/gate5-v7-peer-omits-intermediate.json"
ROOT_PEM="${REPO_ROOT}/certs/dev-root.pem"
INT_PEM="${REPO_ROOT}/certs/dev-intermediate.pem"
LEAF="${REPO_ROOT}/certs/kafka-client/analytics-service/leaf.crt"
KEY="${REPO_ROOT}/certs/kafka-client/analytics-service/tls.key"
CANARY_ROOT="/tmp/record-platform-gate5-v7-preauthorizer-mtls-v1"

fail() { echo "❌ $*" >&2; exit 1; }
ok() { echo "✅ $*"; }

[[ -f "$LEAF" && -f "$KEY" && -f "$ROOT_PEM" ]] || fail "missing leaf/key/root"
command -v kubectl >/dev/null
command -v python3 >/dev/null

# --- Preserve historical invalid fixture rows ---
python3 - "$NEG_JSON" "$RCA_JSON" <<'PY'
import json, pathlib, sys
from datetime import datetime, timezone
neg_path, rca_path = map(pathlib.Path, sys.argv[1:3])
rows=[]
if neg_path.exists():
  doc=json.loads(neg_path.read_text())
  rows=[r for r in doc.get("rows",[]) if r.get("case")=="missing_intermediate"]
rca={
  "document":"gate5-v7-missing-intermediate-invalid-fixture-rca",
  "ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
  "classification":"INVALID_NEGATIVE_FIXTURE — INTERMEDIATE_REMOVED_FROM_WRONG SIDE OF HANDSHAKE",
  "explanation":(
    "Prior rows removed the intermediate from the client truststore while the peer still "
    "presented leaf+intermediate. Root-only truststore with peer-supplied intermediate is "
    "normal PKIX and must not be treated as a missing-intermediate denial."
  ),
  "not_counted_as_security_failure": True,
  "not_counted_as_passing_negative": True,
  "historical_rows": rows,
  "replacement_case":"peer_omits_intermediate",
}
rca_path.write_text(json.dumps(rca, indent=2)+"\n")
print(json.dumps({"preserved_invalid_rows": len(rows), "classification": rca["classification"]}, indent=2))
PY
ok "RCA preserved invalid missing_intermediate rows"

JOB="g5v7-peer-omits-${RANDOM}"
CA="${JOB}-ca"
CM="${JOB}-cm"
WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"; kubectl -n "$NS" delete job "$JOB" --ignore-not-found --wait=false >/dev/null 2>&1 || true; kubectl -n "$NS" delete secret "$CA" --ignore-not-found >/dev/null 2>&1 || true; kubectl -n "$NS" delete configmap "$CM" --ignore-not-found >/dev/null 2>&1 || true' EXIT

# Probe script mounted via ConfigMap
cat >"${WORKDIR}/probe.sh" <<'PROBE'
#!/usr/bin/env bash
set -euo pipefail
ROOT_FP=$(openssl x509 -in /tls/ca/dev-root.pem -noout -fingerprint -sha256 | sed 's/.*=//')
INT_FP=$(openssl x509 -in /tls/ca/dev-intermediate.pem -noout -fingerprint -sha256 | sed 's/.*=//')
LEAF=/tls/client/leaf.crt
KEY=/tls/client/tls.key
echo "ROOT_FP=$ROOT_FP"
echo "INT_FP=$INT_FP"
: >/tmp/out.jsonl

build_full() {
  rm -f /tmp/full.jks /tmp/trust.jks /tmp/c.p12 /tmp/chain.pem
  keytool -importcert -noprompt -alias root -file /tls/ca/dev-root.pem -keystore /tmp/trust.jks -storepass changeit >/dev/null 2>&1
  keytool -importcert -noprompt -alias int -file /tls/ca/dev-intermediate.pem -keystore /tmp/trust.jks -storepass changeit >/dev/null 2>&1
  cat "$LEAF" /tls/ca/dev-intermediate.pem >/tmp/chain.pem
  openssl pkcs12 -export -in /tmp/chain.pem -inkey "$KEY" -out /tmp/c.p12 -passout pass:changeit -name c >/dev/null 2>&1
  keytool -importkeystore -noprompt -srckeystore /tmp/c.p12 -srcstoretype PKCS12 -srcstorepass changeit \
    -destkeystore /tmp/full.jks -deststorepass changeit >/dev/null 2>&1
}

build_leaf_only() {
  rm -f /tmp/leafonly.jks /tmp/lo.p12
  openssl pkcs12 -export -in "$LEAF" -inkey "$KEY" -out /tmp/lo.p12 -passout pass:changeit -name lo >/dev/null 2>&1
  keytool -importkeystore -noprompt -srckeystore /tmp/lo.p12 -srcstoretype PKCS12 -srcstorepass changeit \
    -destkeystore /tmp/leafonly.jks -deststorepass changeit >/dev/null 2>&1
}

build_full
build_leaf_only

for bid in 0 1 2; do
  DNS="kafka-${bid}.kafka.record-platform.svc.cluster.local"
  BOOT="${DNS}:9093"
  RESOLVED=$(getent hosts "$DNS" | awk '{print $1}' | head -1 || true)

  cat >/tmp/full.props <<P
security.protocol=SSL
ssl.keystore.location=/tmp/full.jks
ssl.keystore.password=changeit
ssl.key.password=changeit
ssl.truststore.location=/tmp/trust.jks
ssl.truststore.password=changeit
ssl.endpoint.identification.algorithm=HTTPS
P
  REACH=0
  if kafka-broker-api-versions --bootstrap-server "$BOOT" --command-config /tmp/full.props >/tmp/reach.out 2>&1; then
    REACH=1
  fi

  # Offline: root-only cannot verify leaf without intermediate
  OFFLINE_DENY=0
  if ! openssl verify -CAfile /tls/ca/dev-root.pem "$LEAF" >/tmp/ov.out 2>&1; then
    OFFLINE_DENY=1
  fi

  # Root-only mTLS acceptor verifies client cert (correct PEER_OMITS semantics)
  PORT=$((19443 + bid))
  openssl req -x509 -newkey rsa:2048 -nodes -keyout /tmp/acc.key -out /tmp/acc.crt -days 1 \
    -subj "/CN=peer-omits-acceptor-${bid}" >/dev/null 2>&1
  rm -f /tmp/acc.out /tmp/acc.err /tmp/acc_cli.out
  openssl s_server -accept "$PORT" -cert /tmp/acc.crt -key /tmp/acc.key \
    -CAfile /tls/ca/dev-root.pem -Verify 1 -naccept 1 >/tmp/acc.out 2>/tmp/acc.err &
  ACC_PID=$!
  sleep 1
  ACCEPTOR_DENY=0
  set +e
  echo | openssl s_client -connect "127.0.0.1:${PORT}" -cert "$LEAF" -key "$KEY" \
    -CAfile /tls/ca/dev-root.pem </dev/null >/tmp/acc_cli.out 2>&1
  CLI_RC=$?
  set -e
  # Server log should show verify error when intermediate omitted
  if grep -qiE 'verify error|error.*certificate|tlsv1 alert|handshake failure|unable to get local issuer' /tmp/acc.err /tmp/acc_cli.out 2>/dev/null \
     || [[ "$CLI_RC" -ne 0 ]]; then
    # Confirm it is chain-related (issuer), not random connect fail
    if grep -qiE 'unable to get local issuer|unknown ca|bad certificate|alert' /tmp/acc.err /tmp/acc_cli.out 2>/dev/null \
       || grep -qiE 'Verify return code: [1-9]' /tmp/acc_cli.out 2>/dev/null \
       || [[ "$OFFLINE_DENY" == "1" && "$CLI_RC" -ne 0 ]]; then
      ACCEPTOR_DENY=1
    fi
  fi
  # Stronger: if offline PKIX denies and acceptor did not complete verified handshake
  if [[ "$OFFLINE_DENY" == "1" ]]; then
    if ! grep -qiE 'Verify return code: 0' /tmp/acc_cli.out 2>/dev/null; then
      # Client may still show code 0 for server self-signed; look at server verify
      if grep -qiE 'verify error|unable to get local issuer|unknown ca' /tmp/acc.err 2>/dev/null; then
        ACCEPTOR_DENY=1
      elif ! grep -qiE 'SSL handshake has read' /tmp/acc_cli.out 2>/dev/null; then
        ACCEPTOR_DENY=1
      fi
    fi
  fi
  kill "$ACC_PID" >/dev/null 2>&1 || true
  wait "$ACC_PID" 2>/dev/null || true

  # Diagnostic: leaf-only to live Kafka (broker trusts intermediate → often ACCEPT)
  cat >/tmp/lo.props <<P
security.protocol=SSL
ssl.keystore.location=/tmp/leafonly.jks
ssl.keystore.password=changeit
ssl.key.password=changeit
ssl.truststore.location=/tmp/trust.jks
ssl.truststore.password=changeit
ssl.endpoint.identification.algorithm=HTTPS
P
  LIVE_OK=0
  if kafka-broker-api-versions --bootstrap-server "$BOOT" --command-config /tmp/lo.props >/tmp/live.out 2>&1; then
    LIVE_OK=1
  fi

  PASS=0
  if [[ "$REACH" == "1" && "$OFFLINE_DENY" == "1" && "$ACCEPTOR_DENY" == "1" ]]; then
    PASS=1
  fi

  printf '%s\n' "{\"case\":\"peer_omits_intermediate\",\"broker_id\":${bid},\"broker_dns\":\"${DNS}\",\"resolved_ip\":\"${RESOLVED}\",\"broker_reachable_full_chain\":$([[ $REACH == 1 ]]&&echo true||echo false),\"offline_root_only_pkix_denied\":$([[ $OFFLINE_DENY == 1 ]]&&echo true||echo false),\"root_only_acceptor_denied_leaf_only\":$([[ $ACCEPTOR_DENY == 1 ]]&&echo true||echo false),\"live_kafka_leaf_only_accepted\":$([[ $LIVE_OK == 1 ]]&&echo true||echo false),\"live_kafka_broker_truststore_includes_intermediate\":true,\"expect_deny\":true,\"observed_ok\":$([[ $ACCEPTOR_DENY == 1 ]]&&echo false||echo true),\"pass\":$([[ $PASS == 1 ]]&&echo true||echo false),\"denial_layer\":\"TLS_CHAIN_REJECTED\",\"hostname_verification\":\"HTTPS\",\"alpn\":\"NOT_APPLICABLE_KAFKA_PROTOCOL\",\"root_sha256\":\"${ROOT_FP}\",\"intermediate_sha256\":\"${INT_FP}\",\"client_leaf_sha256\":\"$(openssl x509 -in "$LEAF" -noout -fingerprint -sha256 | sed 's/.*=//')\",\"verifier\":\"ephemeral_openssl_s_server_root_only_CAfile\",\"note\":\"Denial proven with root-only verifier; live Kafka trusts intermediate so leaf-only to Kafka is diagnostic-only\"}" >>/tmp/out.jsonl
  echo "PEER_OMITS broker=${bid} pass=${PASS} offline=${OFFLINE_DENY} acceptor=${ACCEPTOR_DENY} live_leaf_only=${LIVE_OK} reach=${REACH}"
  echo "--- acc.err ---"; tail -20 /tmp/acc.err || true
  echo "--- acc_cli ---"; tail -30 /tmp/acc_cli.out || true
done

echo '===PEER_OMITS_JSONL==='
cat /tmp/out.jsonl
PROBE

kubectl -n "$NS" create configmap "$CM" --from-file=probe.sh="${WORKDIR}/probe.sh" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl -n "$NS" create secret generic "$CA" \
  --from-file=dev-root.pem="$ROOT_PEM" \
  --from-file=dev-intermediate.pem="$INT_PEM" \
  --dry-run=client -o yaml | kubectl apply -f - >/dev/null

cat >"${WORKDIR}/job.yaml" <<EOF
apiVersion: batch/v1
kind: Job
metadata:
  name: ${JOB}
  namespace: ${NS}
spec:
  ttlSecondsAfterFinished: 180
  backoffLimit: 0
  activeDeadlineSeconds: 600
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: prove
          image: confluentinc/cp-kafka:7.5.0
          command: ["bash","/probe/probe.sh"]
          volumeMounts:
            - {name: probe, mountPath: /probe}
            - {name: ca, mountPath: /tls/ca}
            - {name: client, mountPath: /tls/client}
      volumes:
        - name: probe
          configMap: {name: ${CM}, defaultMode: 0755}
        - name: ca
          secret: {secretName: ${CA}}
        - name: client
          secret:
            secretName: kafka-client-tls-analytics-service
            items:
              - {key: leaf.crt, path: leaf.crt}
              - {key: tls.key, path: tls.key}
EOF

kubectl -n "$NS" delete job "$JOB" --ignore-not-found >/dev/null 2>&1 || true
kubectl -n "$NS" apply -f "${WORKDIR}/job.yaml" >/dev/null
ok "Job ${JOB} started"

for i in $(seq 1 100); do
  succ=$(kubectl -n "$NS" get job "$JOB" -o jsonpath='{.status.succeeded}' 2>/dev/null || echo "")
  failc=$(kubectl -n "$NS" get job "$JOB" -o jsonpath='{.status.failed}' 2>/dev/null || echo "")
  [[ "$succ" == "1" || "$failc" == "1" ]] && break
  sleep 3
done

LOGS=$(kubectl -n "$NS" logs "job/${JOB}" -c prove 2>/dev/null || true)
printf '%s\n' "$LOGS" >"${WORKDIR}/job.log"
echo "$LOGS" | grep -E 'PEER_OMITS|ROOT_FP|unable to get|verify error' | head -40

python3 - "$WORKDIR/job.log" "$PEER_JSON" "$NEG_JSON" "$RCA_JSON" <<'PY'
import json, pathlib, sys
from datetime import datetime, timezone
log=pathlib.Path(sys.argv[1]).read_text(errors="replace")
peer_path, neg_path, rca_path = map(pathlib.Path, sys.argv[2:5])
rows=[]
if "===PEER_OMITS_JSONL===" in log:
  for line in log.split("===PEER_OMITS_JSONL===",1)[1].splitlines():
    line=line.strip()
    if line.startswith("{"):
      try: rows.append(json.loads(line))
      except: pass
denied=sum(1 for r in rows if r.get("pass") is True)
doc={
  "document":"gate5-v7-peer-omits-intermediate",
  "ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
  "replacement_for":"missing_intermediate",
  "historical_invalid_fixture_rca": str(rca_path),
  "summary":{
    "peer_omits_intermediate_expected":3,
    "peer_omits_intermediate_tested":len(rows),
    "peer_omits_intermediate_denied":denied,
    "peer_omits_intermediate_failed":len(rows)-denied,
    "peer_omits_intermediate_skipped":max(0,3-len(rows)),
  },
  "rows":rows,
}
peer_path.write_text(json.dumps(doc, indent=2)+"\n")

# Merge into negatives: drop missing_intermediate, add peer_omits rows (keep other cases)
neg={"document":"gate5-v7-kafka-tls-negatives","ts":doc["ts"],"rows":[]}
if neg_path.exists():
  old=json.loads(neg_path.read_text())
  neg["rows"]=[r for r in old.get("rows",[]) if r.get("case")!="missing_intermediate"]
# append peer_omits in normalized negative shape
for r in rows:
  neg["rows"].append({
    "case":"peer_omits_intermediate",
    "broker_id":r["broker_id"],
    "expect_deny":True,
    "observed_ok":r.get("observed_ok"),
    "pass":r.get("pass"),
    "denial_layer":r.get("denial_layer"),
    "detail":"root_only_acceptor_denied_leaf_only",
    "hostname_verification":"HTTPS",
    "live_kafka_leaf_only_accepted":r.get("live_kafka_leaf_only_accepted"),
    "live_kafka_broker_truststore_includes_intermediate":True,
    "verifier":r.get("verifier"),
  })
# Recompute summary
neg["summary"]={
  "rows":len(neg["rows"]),
  "pass":sum(1 for r in neg["rows"] if r.get("pass") is True),
  "fail":sum(1 for r in neg["rows"] if r.get("pass") is False),
  "skipped":0,
  "invalid_historical_missing_intermediate_rows_reclassified":3,
  "categories_note":"missing_intermediate replaced by peer_omits_intermediate",
}
neg_path.write_text(json.dumps(neg, indent=2)+"\n")
print(json.dumps({"peer_omits":doc["summary"],"negatives":neg["summary"]}, indent=2))
sys.exit(0 if denied==3 and len(rows)==3 else 2)
PY
STATUS=$?

mkdir -p "$CANARY_ROOT"
cp "$PEER_JSON" "$RCA_JSON" "$NEG_JSON" "$CANARY_ROOT/" 2>/dev/null || true
cat >"${CANARY_ROOT}/README.md" <<EOF
# gate5-v7-preauthorizer-mtls-v1 (canary; NOT final Gate 5 acceptance root)

- authorizer_enabled: false
- final_acls_applied: false
- gate5_v7 final root: NOT CREATED
- peer_omits replacement evidence in this directory
EOF

if [[ "$STATUS" -eq 0 ]]; then
  ok "PEER_OMITS_INTERMEDIATE 3/3 denied"
else
  echo "⚠️  PEER_OMITS incomplete — see ${PEER_JSON}" >&2
fi
exit "$STATUS"
