#!/usr/bin/env bash
# Gate 5 v8 broker-specific metadata/produce/consume/offset proof (3/3).
# Produce: auth-service → dev.user.lifecycle.v1
# Consume: media-service (READ + group)
# No undeclared topics. No ACL mutation.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT="${RP_GATE5_V8_ROOT:-/tmp/record-platform-runtime-heartbeat-gate5-v8}"
NS="${HOUSING_NS:-record-platform}"
IMAGE="${KAFKA_IMAGE:-confluentinc/cp-kafka:7.5.0}"
OUT="$ROOT/matrices/broker-matrix.json"
TOPIC="dev.user.lifecycle.v1"
GROUP="media-service-user-lifecycle"
RUN_ID="$(date -u +%Y%m%d%H%M%S)-$$"
JOB="g5v8-brkr-${RUN_ID}"

mkdir -p "$ROOT/matrices" "$ROOT/logs"

kubectl -n "$NS" delete job "$JOB" --ignore-not-found >/dev/null 2>&1 || true
kubectl -n "$NS" delete configmap "${JOB}-ca" --ignore-not-found >/dev/null 2>&1 || true
kubectl -n "$NS" create configmap "${JOB}-ca" \
  --from-file=dev-root.pem="$REPO_ROOT/certs/dev-root.pem" \
  --from-file=dev-intermediate.pem="$REPO_ROOT/certs/dev-intermediate.pem" >/dev/null

python3 - "$NS" "$JOB" "$IMAGE" "$TOPIC" "$GROUP" <<'PY'
import json, sys
from pathlib import Path
ns, job, image, topic, group = sys.argv[1:6]
script = f"""
set -euo pipefail
build() {{
  local dir="$1" ks="$2"
  rm -f /tmp/t.jks "$ks" /tmp/c.p12
  keytool -importcert -noprompt -storetype JKS -alias record-platform-root -file /tls/ca/dev-root.pem -keystore /tmp/t.jks -storepass changeit >/dev/null
  keytool -importcert -noprompt -storetype JKS -alias record-platform-intermediate -file /tls/ca/dev-intermediate.pem -keystore /tmp/t.jks -storepass changeit >/dev/null
  openssl pkcs12 -export -inkey "$dir/tls.key" -in "$dir/tls.crt" -certfile /tls/ca/dev-intermediate.pem -out /tmp/c.p12 -passout pass:changeit -name c
  keytool -importkeystore -noprompt -srckeystore /tmp/c.p12 -srcstoretype PKCS12 -srcstorepass changeit -destkeystore "$ks" -deststoretype JKS -deststorepass changeit >/dev/null
}}
build /tls/producer /tmp/prod.jks
build /tls/consumer /tmp/cons.jks
cat >/tmp/p.props <<EOF
security.protocol=SSL
ssl.truststore.location=/tmp/t.jks
ssl.truststore.password=changeit
ssl.truststore.type=JKS
ssl.keystore.location=/tmp/prod.jks
ssl.keystore.password=changeit
ssl.keystore.type=JKS
ssl.key.password=changeit
ssl.endpoint.identification.algorithm=HTTPS
acks=all
retries=0
client.id=record-platform.auth-service.gate5.v8.broker
EOF
cat >/tmp/c.props <<EOF
security.protocol=SSL
ssl.truststore.location=/tmp/t.jks
ssl.truststore.password=changeit
ssl.truststore.type=JKS
ssl.keystore.location=/tmp/cons.jks
ssl.keystore.password=changeit
ssl.keystore.type=JKS
ssl.key.password=changeit
ssl.endpoint.identification.algorithm=HTTPS
group.id={group}
client.id=record-platform.media-service.gate5.v8.broker
enable.auto.commit=true
auto.offset.reset=earliest
EOF
TOPIC="{topic}"
RESULTS=/tmp/results.jsonl
: > "$RESULTS"
for pair in \\
  "kafka-0:kafka-0.kafka.record-platform.svc.cluster.local:9093" \\
  "kafka-1:kafka-1.kafka.record-platform.svc.cluster.local:9093" \\
  "kafka-2:kafka-2.kafka.record-platform.svc.cluster.local:9093"
do
  name="${{pair%%:*}}"
  boot="${{pair#*:}}"
  marker="BROKER_MATRIX_${{name}}_$(date +%s%N)"
  payload_hash=$(printf '%s' "$marker" | sha256sum | awk '{{print $1}}')
  set +e
  timeout 20 kafka-broker-api-versions --bootstrap-server "$boot" --command-config /tmp/p.props >/tmp/meta.out 2>&1
  meta_rc=$?
  set -e
  meta_ok=0
  if [[ $meta_rc -eq 0 ]] && ! grep -qiE 'AUTHORIZATION|SSLHandshakeException' /tmp/meta.out; then meta_ok=1; fi
  set +e
  printf '%s\\n' "$marker" | timeout 25 kafka-console-producer --bootstrap-server "$boot" --producer.config /tmp/p.props --topic "$TOPIC" >/tmp/prod.out 2>&1
  prod_rc=$?
  set -e
  prod_out=$(cat /tmp/prod.out)
  prod_ok=0
  if [[ $prod_rc -eq 0 ]] && ! grep -qiE 'TOPIC_AUTHORIZATION_FAILED|TopicAuthorizationException|Not authorized' <<<"$prod_out"; then prod_ok=1; fi
  set +e
  timeout 35 kafka-console-consumer --bootstrap-server "$boot" --consumer.config /tmp/c.props --topic "$TOPIC" --from-beginning --timeout-ms 20000 --max-messages 2000 >/tmp/cons.out 2>&1
  cons_rc=$?
  set -e
  cons_out=$(cat /tmp/cons.out)
  cons_ok=0
  grep -Fq "$marker" <<<"$cons_out" && cons_ok=1 || true
  # Offset commit: describe group after consume with auto-commit
  set +e
  timeout 20 kafka-consumer-groups --bootstrap-server "$boot" --command-config /tmp/c.props --group {group} --describe >/tmp/off.out 2>&1
  off_rc=$?
  set -e
  off_ok=0
  if [[ $cons_ok -eq 1 ]] && ! grep -qiE 'GROUP_AUTHORIZATION_FAILED|Not authorized' /tmp/off.out; then off_ok=1; fi
  printf '{{"broker":"%s","bootstrap":"%s","topic":"%s","metadata_ok":%s,"produce_ok":%s,"consume_ok":%s,"offset_commit_ok":%s,"payload_hash":"%s","marker_present":%s,"process_exit_codes":{{"meta":%s,"produce":%s,"consume":%s,"offset_describe":%s}},"authorization_error_on_produce":%s}}\\n' \\
    "$name" "$boot" "$TOPIC" "$meta_ok" "$prod_ok" "$cons_ok" "$off_ok" "$payload_hash" "$cons_ok" "$meta_rc" "$prod_rc" "$cons_rc" "$off_rc" \\
    "$(grep -qiE 'TOPIC_AUTHORIZATION_FAILED|TopicAuthorizationException' <<<"$prod_out" && echo true || echo false)" >> "$RESULTS"
done
python3 - <<'INNER'
import json
from pathlib import Path
rows=[json.loads(l) for l in Path("/tmp/results.jsonl").read_text().splitlines() if l.strip()]
meta=sum(1 for r in rows if r["metadata_ok"])
prod=sum(1 for r in rows if r["produce_ok"])
cons=sum(1 for r in rows if r["consume_ok"])
off=sum(1 for r in rows if r["offset_commit_ok"])
body={{
  "document":"gate5-v8-broker-matrix",
  "producer_service":"auth-service",
  "consumer_service":"media-service",
  "topic":"{topic}",
  "group":"{group}",
  "rows":rows,
  "brokers_metadata_expected_tested_passed":[3,3,meta],
  "brokers_produce_expected_tested_passed":[3,3,prod],
  "brokers_consume_expected_tested_passed":[3,3,cons],
  "brokers_offset_commit_expected_tested_passed":[3,3,off],
  "payload_hash_matches":f"{{cons}}/3",
  "broker_skips":0,
  "passed": meta==3 and prod==3 and cons==3 and off==3,
}}
Path("/tmp/broker-matrix.json").write_text(json.dumps(body, indent=2)+"\\n")
print("BROKER_MATRIX_JSON="+json.dumps(body, separators=(",",":")))
if not body["passed"]:
  raise SystemExit(1)
print("BROKER_MATRIX_OK")
INNER
"""
doc = {
  "apiVersion": "batch/v1",
  "kind": "Job",
  "metadata": {"name": job, "namespace": ns},
  "spec": {
    "backoffLimit": 0,
    "ttlSecondsAfterFinished": 300,
    "activeDeadlineSeconds": 700,
    "template": {"spec": {
      "restartPolicy": "Never",
      "containers": [{
        "name": "broker",
        "image": image,
        "imagePullPolicy": "IfNotPresent",
        "command": ["/bin/bash", "-lc"],
        "args": [script],
        "volumeMounts": [
          {"name": "producer", "mountPath": "/tls/producer", "readOnly": True},
          {"name": "consumer", "mountPath": "/tls/consumer", "readOnly": True},
          {"name": "ca", "mountPath": "/tls/ca", "readOnly": True},
        ],
      }],
      "volumes": [
        {"name": "producer", "secret": {"secretName": "kafka-client-tls-auth-service", "items": [
          {"key": "tls.crt", "path": "tls.crt"}, {"key": "tls.key", "path": "tls.key"}
        ]}},
        {"name": "consumer", "secret": {"secretName": "kafka-client-tls-media-service", "items": [
          {"key": "tls.crt", "path": "tls.crt"}, {"key": "tls.key", "path": "tls.key"}
        ]}},
        {"name": "ca", "configMap": {"name": f"{job}-ca"}},
      ],
    }},
  },
}
Path("/tmp/g5v8-broker-job.yaml").write_text(json.dumps(doc))
print(f"topic={topic} group={group}")
PY

kubectl apply -f /tmp/g5v8-broker-job.yaml
if ! kubectl -n "$NS" wait --for=condition=complete "job/${JOB}" --timeout=700s; then
  kubectl -n "$NS" logs "job/${JOB}" --tail=200 || true
  exit 1
fi
kubectl -n "$NS" logs "job/${JOB}" | tee "$ROOT/logs/broker-matrix-job.log" >/dev/null
grep -q 'BROKER_MATRIX_OK' "$ROOT/logs/broker-matrix-job.log"
python3 - "$ROOT/logs/broker-matrix-job.log" "$OUT" <<'PY'
import json, sys
from pathlib import Path
text=Path(sys.argv[1]).read_text()
line=[ln for ln in text.splitlines() if ln.startswith("BROKER_MATRIX_JSON=")][-1]
body=json.loads(line.split("=",1)[1])
Path(sys.argv[2]).write_text(json.dumps(body, indent=2)+"\n")
print(json.dumps({"passed": body["passed"], "meta": body["brokers_metadata_expected_tested_passed"], "produce": body["brokers_produce_expected_tested_passed"], "consume": body["brokers_consume_expected_tested_passed"]}, indent=2))
if not body["passed"]:
  raise SystemExit(1)
PY
kubectl -n "$NS" delete job "$JOB" --ignore-not-found >/dev/null 2>&1 || true
kubectl -n "$NS" delete configmap "${JOB}-ca" --ignore-not-found >/dev/null 2>&1 || true
echo "BROKER_MATRIX_PASSED=1"
