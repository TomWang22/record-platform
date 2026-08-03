#!/usr/bin/env bash
# Outside-v9 RCA: staged analytics → direct broker + 20/5/5 repetition.
# Exact endpoint only: kafka-{n}.kafka.record-platform.svc.cluster.local:9093
# Does not mutate Gate 5 v9. No multi-broker bootstrap fallback.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RCA="${RP_GATE5_V9_RCA_ROOT:-/tmp/record-platform-gate5-v9-positive-mtls-rca-v1}"
NS="${HOUSING_NS:-record-platform}"
IMAGE="${KAFKA_IMAGE:-confluentinc/cp-kafka:7.5.0}"
SECRET="kafka-client-tls-analytics-service"
RUN_ID="$(date -u +%Y%m%d%H%M%S)-$$"
JOB="g5v9rca${RUN_ID: -8}"
OUT_DIR="${RCA}/reproducer/${RUN_ID}"
mkdir -p "$OUT_DIR" "$RCA/repetition" "$RCA/logs"

kubectl -n "$NS" delete job "$JOB" --ignore-not-found >/dev/null 2>&1 || true
kubectl -n "$NS" delete configmap "${JOB}-ca" "${JOB}-probe" --ignore-not-found >/dev/null 2>&1 || true
kubectl -n "$NS" create configmap "${JOB}-ca" \
  --from-file=dev-root.pem="$REPO_ROOT/certs/dev-root.pem" \
  --from-file=dev-intermediate.pem="$REPO_ROOT/certs/dev-intermediate.pem" >/dev/null

PROBE="${OUT_DIR}/staged-probe.sh"
cat >"$PROBE" <<'PROBE'
#!/usr/bin/env bash
set -euo pipefail
RESULTS=/tmp/results.jsonl
REPS=/tmp/reps.jsonl
: > "$RESULTS"
: > "$REPS"

now_ms() { python3 -c 'import time;print(int(time.time()*1000))'; }

stage() {
  python3 - "$@" <<'PY'
import json,sys
name,expected,actual,rc,ms,classification,detail=sys.argv[1:8]
print(json.dumps({
  "stage":name,"expected_result":expected,"actual_result":actual,
  "exit_code":int(rc),"duration_ms":int(ms),"classification":classification,"detail":detail
}))
PY
}

classify_kafka_err() {
  local out="$1" rc="$2"
  echo "$out" | grep -qi 'AuthorizerNotReadyException' && { echo AUTHORIZER_NOT_READY; return; }
  echo "$out" | grep -qi 'ClusterAuthorizationException' && { echo CLUSTER_AUTHORIZATION; return; }
  echo "$out" | grep -qiE 'SSLHandshakeException|handshake_failure|bad_certificate|certificate_unknown' && { echo TLS_HANDSHAKE_FAILED; return; }
  echo "$out" | grep -qiE 'UnknownHostException|Name or service not known|No route' && { echo DNS_OR_ROUTE; return; }
  echo "$out" | grep -qi 'Connection refused' && { echo CONNECTION_REFUSED; return; }
  echo "$out" | grep -qiE 'Connection reset|Broken pipe' && { echo CONNECTION_RESET; return; }
  echo "$out" | grep -qiE 'disconnected|DisconnectException' && { echo BROKER_DISCONNECTED; return; }
  echo "$out" | grep -qiE 'TimeoutException|Timed out|timeout' && { echo REQUEST_TIMEOUT; return; }
  [[ "$rc" -ne 0 ]] && { echo KAFKA_COMMAND_FAILED; return; }
  echo OK
}

build_ks() {
  rm -f /tmp/t.jks /tmp/c.jks /tmp/c.p12
  keytool -importcert -noprompt -storetype JKS -alias record-platform-root -file /tls/ca/dev-root.pem -keystore /tmp/t.jks -storepass changeit >/dev/null
  keytool -importcert -noprompt -storetype JKS -alias record-platform-intermediate -file /tls/ca/dev-intermediate.pem -keystore /tmp/t.jks -storepass changeit >/dev/null
  openssl pkcs12 -export -inkey /tls/client/tls.key -in /tls/client/tls.crt -certfile /tls/ca/dev-intermediate.pem -out /tmp/c.p12 -passout pass:changeit -name c
  keytool -importkeystore -noprompt -srckeystore /tmp/c.p12 -srcstoretype PKCS12 -srcstorepass changeit -destkeystore /tmp/c.jks -deststoretype JKS -deststorepass changeit >/dev/null
}

write_props() {
  local cid="$1"
  cat >/tmp/client.props <<EOF
security.protocol=SSL
ssl.keystore.location=/tmp/c.jks
ssl.keystore.password=changeit
ssl.key.password=changeit
ssl.truststore.location=/tmp/t.jks
ssl.truststore.password=changeit
ssl.endpoint.identification.algorithm=HTTPS
client.id=${cid}
request.timeout.ms=30000
default.api.timeout.ms=40000
EOF
}

apiversions_once() {
  local bid="$1" cid="$2"
  local DNS="kafka-${bid}.kafka.record-platform.svc.cluster.local"
  local BOOT="${DNS}:9093"
  build_ks
  write_props "$cid"
  local t0; t0=$(now_ms)
  set +e
  local out; out=$(timeout 25 kafka-broker-api-versions --bootstrap-server "$BOOT" --command-config /tmp/client.props 2>&1)
  local rc=$?
  set -e
  local t1; t1=$(now_ms)
  local cls; cls=$(classify_kafka_err "$out" "$rc")
  local ok=0
  if [[ $rc -eq 0 ]] && echo "$out" | grep -qiE 'ApiVersion|id@[0-9]+'; then ok=1; cls=PASS; fi
  if [[ $ok -eq 0 && "$cls" != "TLS_HANDSHAKE_FAILED" ]]; then
    cls="TLS_HANDSHAKE_COMPLETE_KAFKA_PROTOCOL_FAILED:${cls}"
  fi
  python3 - "$bid" "$ok" "$cls" "$((t1-t0))" "$rc" "$out" <<'PY' >> "$REPS"
import json,sys
bid,ok,cls,ms,rc,out=sys.argv[1:7]
print(json.dumps({
  "broker":int(bid),"apiversions_ok":int(ok),"classification":cls,
  "duration_ms":int(ms),"exit_code":int(rc),"stderr_tail":out[-2000:]
}))
PY
  echo "REP broker=$bid ok=$ok cls=$cls rc=$rc ms=$((t1-t0))"
}

staged() {
  local bid="$1"
  local DNS="kafka-${bid}.kafka.record-platform.svc.cluster.local"
  local BOOT="${DNS}:9093"
  local CID="record-platform.analytics-service.rca.staged.broker${bid}"

  local t0 t1 rc ip out cls ok snippet bro_fp cli_fp verify
  t0=$(now_ms)
  set +e
  ip=$(getent hosts "$DNS" | awk '{print $1}' | head -1)
  rc=$?
  set -e
  t1=$(now_ms)
  if [[ -n "${ip:-}" ]]; then stage "01_DNS_RESOLUTION_b${bid}" "A_record" "ok:$ip" "$rc" "$((t1-t0))" "PASS" "$ip" >>"$RESULTS"
  else stage "01_DNS_RESOLUTION_b${bid}" "A_record" "fail" "$rc" "$((t1-t0))" "DNS_RESOLUTION_FAILURE" "" >>"$RESULTS"; return; fi

  t0=$(now_ms)
  set +e
  timeout 5 bash -c "echo >/dev/tcp/${ip}/9093" 2>/tmp/tcp.err
  rc=$?
  set -e
  t1=$(now_ms)
  if [[ $rc -eq 0 ]]; then stage "02_TCP_CONNECT_b${bid}" "connect" "ok" 0 "$((t1-t0))" "PASS" "$ip:9093" >>"$RESULTS"
  else stage "02_TCP_CONNECT_b${bid}" "connect" "fail" "$rc" "$((t1-t0))" "TCP_CONNECT_DENIED" "$(cat /tmp/tcp.err)" >>"$RESULTS"; return; fi

  build_ks
  write_props "$CID"
  t0=$(now_ms)
  set +e
  echo | timeout 20 openssl s_client -connect "$BOOT" -servername "$DNS" -verify_hostname "$DNS" \
    -CAfile /tls/ca/dev-root.pem -cert /tls/client/tls.crt -key /tls/client/tls.key -showcerts \
    >/tmp/sc.out 2>/tmp/sc.err
  rc=$?
  set -e
  t1=$(now_ms)
  verify=FAIL
  grep -qi 'Verify return code: 0' /tmp/sc.err /tmp/sc.out 2>/dev/null && verify=PASS || true
  awk 'BEGIN{p=0} /BEGIN CERTIFICATE/{p=1} p{print} /END CERTIFICATE/{if(p){exit}}' /tmp/sc.out >/tmp/broker-leaf.pem || true
  bro_fp=""; [[ -s /tmp/broker-leaf.pem ]] && bro_fp=$(openssl x509 -in /tmp/broker-leaf.pem -noout -fingerprint -sha256 | sed 's/.*=//')
  cli_fp=$(openssl x509 -in /tls/client/tls.crt -noout -fingerprint -sha256 | sed 's/.*=//')
  if [[ "$verify" == "PASS" ]]; then
    stage "03_OPENSSL_TLS_HANDSHAKE_b${bid}" "verify0" "ok" "$rc" "$((t1-t0))" "PASS" "broker_fp=$bro_fp client_fp=$cli_fp" >>"$RESULTS"
    stage "04_CLIENT_CERTIFICATE_PRESENTATION_b${bid}" "presented" "ok" 0 0 "PASS" "$cli_fp" >>"$RESULTS"
    stage "05_SERVER_CERTIFICATE_PRESENTATION_b${bid}" "presented" "ok" 0 0 "PASS" "$bro_fp" >>"$RESULTS"
    stage "06_HOSTNAME_AND_SAN_VERIFICATION_b${bid}" "verify_hostname" "ok" 0 0 "PASS" "$DNS" >>"$RESULTS"
  else
    stage "03_OPENSSL_TLS_HANDSHAKE_b${bid}" "verify0" "fail" "$rc" "$((t1-t0))" "TLS_HANDSHAKE_FAILED" "$(tail -c 400 /tmp/sc.err)" >>"$RESULTS"
    return
  fi

  t0=$(now_ms)
  set +e
  out=$(timeout 25 kafka-broker-api-versions --bootstrap-server "$BOOT" --command-config /tmp/client.props 2>&1)
  rc=$?
  set -e
  t1=$(now_ms)
  cls=$(classify_kafka_err "$out" "$rc")
  ok=0
  if [[ $rc -eq 0 ]] && echo "$out" | grep -qiE 'ApiVersion|id@[0-9]+'; then ok=1; cls=PASS; fi
  snippet=$(printf '%s' "$out" | tail -c 4000)
  if [[ $ok -eq 1 ]]; then
    stage "07_KAFKA_APIVERSIONS_b${bid}" "ApiVersions_ok" "ok" "$rc" "$((t1-t0))" "PASS" "$snippet" >>"$RESULTS"
  else
    if [[ "$cls" == "TLS_HANDSHAKE_FAILED" ]]; then
      stage "07_KAFKA_APIVERSIONS_b${bid}" "ApiVersions_ok" "fail" "$rc" "$((t1-t0))" "TLS_HANDSHAKE_FAILED" "$snippet" >>"$RESULTS"
    else
      stage "07_KAFKA_APIVERSIONS_b${bid}" "ApiVersions_ok" "fail" "$rc" "$((t1-t0))" "TLS_HANDSHAKE_COMPLETE_KAFKA_PROTOCOL_FAILED:${cls}" "$snippet" >>"$RESULTS"
    fi
  fi

  t0=$(now_ms)
  set +e
  out=$(timeout 25 kafka-topics --bootstrap-server "$BOOT" --command-config /tmp/client.props --list 2>&1)
  rc=$?
  set -e
  t1=$(now_ms)
  cls=$(classify_kafka_err "$out" "$rc")
  snippet=$(printf '%s' "$out" | tail -c 2000)
  if [[ $rc -eq 0 ]]; then stage "08_KAFKA_METADATA_b${bid}" "topic_list" "ok" "$rc" "$((t1-t0))" "PASS" "$snippet" >>"$RESULTS"
  else stage "08_KAFKA_METADATA_b${bid}" "topic_list" "fail" "$rc" "$((t1-t0))" "$cls" "$snippet" >>"$RESULTS"
  fi

  t0=$(now_ms)
  set +e
  out=$(timeout 25 kafka-topics --bootstrap-server "$BOOT" --command-config /tmp/client.props --describe --topic __consumer_offsets 2>&1)
  rc=$?
  set -e
  t1=$(now_ms)
  cls=$(classify_kafka_err "$out" "$rc")
  snippet=$(printf '%s' "$out" | tail -c 1500)
  stage "09_AUTHORIZED_TOPIC_DESCRIBE_b${bid}" "describe" "rc=$rc" "$rc" "$((t1-t0))" "$cls" "$snippet" >>"$RESULTS"
}

echo "=== STAGED ==="
staged 0
staged 1
staged 2
echo "=== REP kafka-0 x20 ==="
for i in $(seq 1 20); do apiversions_once 0 "record-platform.analytics-service.rca.rep0.${i}"; done
echo "=== REP kafka-1 x5 ==="
for i in $(seq 1 5); do apiversions_once 1 "record-platform.analytics-service.rca.rep1.${i}"; done
echo "=== REP kafka-2 x5 ==="
for i in $(seq 1 5); do apiversions_once 2 "record-platform.analytics-service.rca.rep2.${i}"; done

python3 - <<'PY'
import json
from pathlib import Path
from collections import Counter
stages=[json.loads(l) for l in Path('/tmp/results.jsonl').read_text().splitlines() if l.strip()]
reps=[json.loads(l) for l in Path('/tmp/reps.jsonl').read_text().splitlines() if l.strip()]
api={}
for s in stages:
  if s['stage'].startswith('07_KAFKA_APIVERSIONS_b'):
    api[int(s['stage'][-1])]=s

def stats(bid, expected):
  rows=[r for r in reps if r['broker']==bid]
  ok=sum(1 for r in rows if r['apiversions_ok']==1)
  return {
    'expected':expected,'tested':len(rows),'passed':ok,'failed':len(rows)-ok,
    'classifications':dict(Counter(r['classification'] for r in rows)),
    'latency_ms':sorted(r['duration_ms'] for r in rows),
    'rows':rows,
  }
body={
  'document':'gate5-v9-direct-row-repetition',
  'direct_endpoint':'kafka-{n}.kafka.record-platform.svc.cluster.local:9093',
  'no_bootstrap_fallback':True,
  'client':'analytics-service',
  'staged_stages':stages,
  'staged_apiversions':{str(k):{'classification':v['classification'],'exit_code':v['exit_code'],'duration_ms':v['duration_ms'],'detail_tail':(v.get('detail') or '')[-500:]} for k,v in api.items()},
  'repetition':{'kafka_0':stats(0,20),'kafka_1':stats(1,5),'kafka_2':stats(2,5)},
}
Path('/tmp/rca-summary.json').write_text(json.dumps(body))
# single-line emit
print('FULL_RCA_JSON='+json.dumps(body, separators=(',',':')))
r0,r1,r2=stats(0,20),stats(1,5),stats(2,5)
print('RCA_SUMMARY='+json.dumps({
  'staged_api':{str(k):v['classification'] for k,v in api.items()},
  'rep0':f"{r0['expected']}/{r0['tested']}/{r0['passed']}/{r0['failed']}",
  'rep1':f"{r1['expected']}/{r1['tested']}/{r1['passed']}/{r1['failed']}",
  'rep2':f"{r2['expected']}/{r2['tested']}/{r2['passed']}/{r2['failed']}",
}, separators=(',',':')))
print('RCA_PROBE_OK')
PY
PROBE

chmod +x "$PROBE"
kubectl -n "$NS" create configmap "${JOB}-probe" --from-file=staged-probe.sh="$PROBE" >/dev/null

python3 - "$NS" "$JOB" "$IMAGE" "$SECRET" <<'PY'
import json,sys
from pathlib import Path
ns,job,image,secret=sys.argv[1:5]
doc={
  "apiVersion":"batch/v1","kind":"Job","metadata":{"name":job,"namespace":ns},
  "spec":{"backoffLimit":0,"ttlSecondsAfterFinished":600,"activeDeadlineSeconds":1800,
    "template":{"spec":{"restartPolicy":"Never","containers":[{
      "name":"rca","image":image,"imagePullPolicy":"IfNotPresent",
      "command":["/bin/bash","/probe/staged-probe.sh"],
      "volumeMounts":[
        {"name":"client","mountPath":"/tls/client","readOnly":True},
        {"name":"ca","mountPath":"/tls/ca","readOnly":True},
        {"name":"probe","mountPath":"/probe","readOnly":True},
      ],
    }],"volumes":[
      {"name":"client","secret":{"secretName":secret,"items":[{"key":"tls.crt","path":"tls.crt"},{"key":"tls.key","path":"tls.key"}]}},
      {"name":"ca","configMap":{"name":f"{job}-ca"}},
      {"name":"probe","configMap":{"name":f"{job}-probe","defaultMode":0o755}},
    ]}}},
}
Path('/tmp/g5v9-rca-job.yaml').write_text(json.dumps(doc))
print('job_ready', job)
PY

kubectl apply -f /tmp/g5v9-rca-job.yaml
echo "waiting for $JOB"
kubectl -n "$NS" wait --for=condition=complete "job/${JOB}" --timeout=1800s
kubectl -n "$NS" logs "job/${JOB}" | tee "$OUT_DIR/job.log" >/dev/null
grep -q RCA_PROBE_OK "$OUT_DIR/job.log"

python3 - "$OUT_DIR/job.log" "$OUT_DIR/rca-summary.json" \
  "$RCA/repetition/direct-row-repetition.json" \
  "$REPO_ROOT/reports/kafka/gate5-v9-direct-row-repetition.json" \
  "$REPO_ROOT/reports/kafka/gate5-v9-failed-row-three-broker-comparison.json" <<'PY'
import json,sys
from pathlib import Path
text=Path(sys.argv[1]).read_text()
full=json.loads([ln for ln in text.splitlines() if ln.startswith('FULL_RCA_JSON=')][-1].split('=',1)[1])
brief=json.loads([ln for ln in text.splitlines() if ln.startswith('RCA_SUMMARY=')][-1].split('=',1)[1])
Path(sys.argv[2]).write_text(json.dumps(full, indent=2)+'\n')
Path(sys.argv[3]).write_text(json.dumps(full, indent=2)+'\n')
# sanitized git copy without huge detail tails
san=json.loads(json.dumps(full))
for s in san.get('staged_stages') or []:
  if isinstance(s.get('detail'), str) and len(s['detail'])>400:
    s['detail']=s['detail'][-400:]
for key in ('kafka_0','kafka_1','kafka_2'):
  rows=(san.get('repetition') or {}).get(key,{}).get('rows') or []
  for r in rows:
    if isinstance(r.get('stderr_tail'), str) and len(r['stderr_tail'])>300:
      r['stderr_tail']=r['stderr_tail'][-300:]
Path(sys.argv[4]).write_text(json.dumps(san, indent=2)+'\n')
cmp={
  'document':'gate5-v9-failed-row-three-broker-comparison',
  'client':'analytics-service',
  'staged_apiversions':san.get('staged_apiversions'),
  'repetition_summary':{k:{kk:vv for kk,vv in v.items() if kk!='rows'} for k,v in (san.get('repetition') or {}).items()},
  'brief':brief,
}
Path(sys.argv[5]).write_text(json.dumps(cmp, indent=2)+'\n')
print(json.dumps(brief, indent=2))
PY

kubectl -n "$NS" delete job "$JOB" --ignore-not-found >/dev/null 2>&1 || true
kubectl -n "$NS" delete configmap "${JOB}-ca" "${JOB}-probe" --ignore-not-found >/dev/null 2>&1 || true
echo "DONE out=$OUT_DIR"
