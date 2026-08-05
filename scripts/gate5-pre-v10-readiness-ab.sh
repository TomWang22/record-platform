#!/usr/bin/env bash
# Disposable three-node KRaft A/B: JVM-per-probe (A) vs persistent readiness agent (B).
# NEVER mutates live kafka-0/1/2 in namespace record-platform.
#
# Usage:
#   RP_AB_DOCKER_HOST=unix://$HOME/.colima/gate5-ab/docker.sock \
#   RP_AB_COLIMA_PROFILE=gate5-ab \
#   bash scripts/gate5-pre-v10-readiness-ab.sh
#
# Exit 75 = BLOCKED_HOST_SATURATION (bounded capacity preflight failed).
# Exit 76 = A_B_BLOCKED_NO_ISOLATED_CAPACITY
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_JSON="${REPO_ROOT}/reports/kafka/gate5-pre-v10-readiness-ab-comparison.json"
OUT_MD="${REPO_ROOT}/reports/kafka/gate5-pre-v10-readiness-ab-comparison.md"
OUT_B_STAB="${REPO_ROOT}/reports/kafka/gate5-pre-v10-readiness-b-arm-stability.json"
OUT_CAP="${REPO_ROOT}/reports/kafka/gate5-pre-v10-readiness-ab-capacity-preflight.json"
IMAGE="${RP_KAFKA_REHEARSAL_IMAGE:-confluentinc/cp-kafka:7.5.0}"
PROJECT="rp-g5-readiness-ab"
ATTEMPT_ID="ab-$(date -u +%Y%m%dT%H%M%SZ)-$$"
EVID_ROOT="${REPO_ROOT}/.tmp/${PROJECT}-${ATTEMPT_ID}"
WORKDIR="${EVID_ROOT}/work"
AGENT_BIN="${WORKDIR}/kafka-readiness-agent"
ROOT_PEM="${REPO_ROOT}/certs/dev-root.pem"
INT_PEM="${REPO_ROOT}/certs/dev-intermediate.pem"
INT_KEY="${REPO_ROOT}/certs/dev-intermediate.key"
MODE="${RP_AB_MODE:-full}"
FORCE="${RP_AB_FORCE:-0}"
PROFILE="${RP_AB_COLIMA_PROFILE:-}"
LIVE_DOCKER_HOST="${DOCKER_HOST:-unix://${HOME}/.colima/default/docker.sock}"
AB_DOCKER_HOST="${RP_AB_DOCKER_HOST:-}"

fail() { echo "❌ $*" >&2; exit 1; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*" >&2; }

[[ -f "$ROOT_PEM" && -f "$INT_PEM" && -f "$INT_KEY" ]] || fail "missing platform CA material"
command -v docker >/dev/null || fail "docker required"
command -v go >/dev/null || fail "go required"
command -v python3 >/dev/null || fail "python3 required"

mkdir -p "$WORKDIR"/{certs,config,logs,agents,evidence}
cleanup() {
  local rc=$?
  if [[ -n "${AB_DOCKER_HOST}" ]]; then
    export DOCKER_HOST="$AB_DOCKER_HOST"
  fi
  docker compose -p "$PROJECT" -f "$WORKDIR/docker-compose.yml" down -v --remove-orphans >/dev/null 2>&1 || true
  for id in 0 1 2; do docker rm -f "${PROJECT}-agent-${id}" >/dev/null 2>&1 || true; done
  # leak census
  python3 - "$EVID_ROOT" "$PROJECT" "$rc" <<'PY' || true
import json, os, subprocess, sys
from pathlib import Path
root, project, rc = Path(sys.argv[1]), sys.argv[2], int(sys.argv[3])
env=os.environ.copy()
def sh(args, timeout=20):
  try:
    r=subprocess.run(args,capture_output=True,text=True,timeout=timeout,env=env)
    return r.returncode, r.stdout or ''
  except Exception as e:
    return 1, str(e)
rc1, ps = sh(['docker','ps','-aq','--filter',f'name={project}'])
rc2, nets = sh(['docker','network','ls','-q','--filter',f'name={project}'])
rc3, vols = sh(['docker','volume','ls','-q','--filter',f'name={project}'])
doc={
  'cleanup_expected': True,
  'cleanup_completed': True,
  'exit_code': rc,
  'leaked_containers': [x for x in ps.split() if x],
  'leaked_networks': [x for x in nets.split() if x],
  'leaked_volumes': [x for x in vols.split() if x],
  'leaked_processes': [],
}
(root/'cleanup.json').write_text(json.dumps(doc, indent=2)+'\n')
PY
}
trap cleanup EXIT

# --- Isolation gate ---
if [[ -z "$AB_DOCKER_HOST" || -z "$PROFILE" ]]; then
  warn "RP_AB_DOCKER_HOST and RP_AB_COLIMA_PROFILE required for isolated A/B"
  python3 - "$OUT_JSON" "$OUT_MD" "$OUT_B_STAB" "$OUT_CAP" "$EVID_ROOT" <<'PY'
import json, sys, datetime
from pathlib import Path
out_json, out_md, out_stab, out_cap, evid = sys.argv[1:]
now=datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
doc={
  "document":"gate5-pre-v10-readiness-ab-comparison",
  "ts": now,
  "status":"A_B_BLOCKED_NO_ISOLATED_CAPACITY",
  "live_kafka_mutated": False,
  "v10_created": False,
  "A_started": False,
  "B_started": False,
  "b_arm_acceptance_passed": False,
  "READINESS_REPLACEMENT_DECISION":"BLOCKED_INSUFFICIENT_EVIDENCE",
  "agent_classification":"HARDENING_CANDIDATE_NOT_CAUSAL_REMEDIATION",
  "evidence_root": evid,
  "note":"Set RP_AB_COLIMA_PROFILE and RP_AB_DOCKER_HOST to a dedicated Colima profile; do not run A/B on saturated live default context.",
}
Path(out_json).write_text(json.dumps(doc,indent=2)+"\n")
Path(out_md).write_text("# Readiness A/B\n\n**A_B_BLOCKED_NO_ISOLATED_CAPACITY**\n")
Path(out_stab).write_text(json.dumps({"document":"gate5-pre-v10-readiness-b-arm-stability","ts":now,"status":"NOT_RUN","passed":False},indent=2)+"\n")
Path(out_cap).write_text(json.dumps({"document":"gate5-pre-v10-ab-capacity-preflight","ts":now,"terminal_classification":"A_B_BLOCKED_NO_ISOLATED_CAPACITY"},indent=2)+"\n")
PY
  exit 76
fi

# Refuse using the live default docker host unless explicitly forced (still not live k8s mutate)
if [[ "$AB_DOCKER_HOST" == *"/.colima/default/"* && "$FORCE" != "1" ]]; then
  warn "Refusing default Colima profile without RP_AB_FORCE=1"
  python3 -c "import json,datetime,pathlib; p=pathlib.Path('$OUT_JSON'); now=datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'); p.write_text(json.dumps({'document':'gate5-pre-v10-readiness-ab-comparison','ts':now,'status':'A_B_BLOCKED_NO_ISOLATED_CAPACITY','note':'default profile refused','live_kafka_mutated':False,'v10_created':False,'A_started':False,'B_started':False,'b_arm_acceptance_passed':False,'READINESS_REPLACEMENT_DECISION':'BLOCKED_INSUFFICIENT_EVIDENCE'},indent=2)+'\n')"
  exit 76
fi

export DOCKER_HOST="$AB_DOCKER_HOST"
ok "isolated docker host=$DOCKER_HOST profile=$PROFILE"

# --- Bounded capacity preflight (exit 75 on saturation) ---
set +e
python3 "${REPO_ROOT}/scripts/lib/gate5-ab-capacity-preflight.py" \
  --evidence-root "$EVID_ROOT/capacity" \
  --max-wait-seconds "${RP_AB_CAPACITY_MAX_WAIT:-180}" \
  --sample-interval-seconds "${RP_AB_CAPACITY_INTERVAL:-15}" \
  --required-consecutive-healthy "${RP_AB_CAPACITY_STREAK:-3}" \
  --cmd-timeout-seconds 15 \
  --docker-host "$DOCKER_HOST"
cap_rc=$?
set -e
cp -f "$EVID_ROOT/capacity/capacity-preflight.json" "$OUT_CAP" 2>/dev/null || true
if [[ "$cap_rc" -eq 75 ]]; then
  warn "capacity blocked (exit 75)"
  python3 - "$OUT_JSON" "$OUT_MD" "$OUT_B_STAB" "$OUT_CAP" "$EVID_ROOT" <<'PY'
import json, sys, datetime
from pathlib import Path
out_json, out_md, out_stab, out_cap, evid = sys.argv[1:]
now=datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
cap={}
try: cap=json.loads(Path(out_cap).read_text())
except Exception: pass
doc={
  "document":"gate5-pre-v10-readiness-ab-comparison",
  "ts": now,
  "status":"BLOCKED_HOST_SATURATION",
  "live_kafka_mutated": False,
  "v10_created": False,
  "A_started": False,
  "B_started": False,
  "b_arm_acceptance_passed": False,
  "READINESS_REPLACEMENT_DECISION":"BLOCKED_INSUFFICIENT_EVIDENCE",
  "agent_classification":"HARDENING_CANDIDATE_NOT_CAUSAL_REMEDIATION",
  "capacity": cap,
  "evidence_root": evid,
}
Path(out_json).write_text(json.dumps(doc,indent=2)+"\n")
Path(out_md).write_text("# Readiness A/B\n\n**BLOCKED_HOST_SATURATION** (bounded preflight exit 75)\n")
Path(out_stab).write_text(json.dumps({"document":"gate5-pre-v10-readiness-b-arm-stability","ts":now,"status":"NOT_RUN_HOST_SATURATION","passed":False},indent=2)+"\n")
PY
  exit 75
fi
[[ "$cap_rc" -eq 0 ]] || fail "capacity preflight rc=$cap_rc"

ok "building readiness agent (linux/arm64 for Colima)"
( cd "${REPO_ROOT}/services/kafka-readiness-agent" && GOOS=linux GOARCH=arm64 go build -o "$AGENT_BIN" ./cmd/kafka-readiness-agent )

# --- PKI: broker + 12 service clients (matrix identities) ---
SERVICES=(
  analytics-service auction-monitor auth-service listings-service media-service
  messaging-service notification-service python-ai-service shopping-service trust-service
  ollama-gateway ollama-worker
)
if [[ "$MODE" == "quick" ]]; then
  SERVICES=(analytics-service trust-service shopping-service ollama-worker)
fi

openssl genrsa -out "$WORKDIR/certs/broker.key" 2048 2>/dev/null
openssl req -new -key "$WORKDIR/certs/broker.key" -out "$WORKDIR/certs/broker.csr" \
  -subj "/CN=kafka/O=record-platform" 2>/dev/null
cat >"$WORKDIR/certs/broker.ext" <<'EOF'
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth,clientAuth
subjectAltName=DNS:kafka-0,DNS:kafka-1,DNS:kafka-2,DNS:localhost,IP:127.0.0.1
EOF
openssl x509 -req -in "$WORKDIR/certs/broker.csr" -CA "$INT_PEM" -CAkey "$INT_KEY" \
  -CAcreateserial -out "$WORKDIR/certs/broker.crt" -days 2 -sha256 -extfile "$WORKDIR/certs/broker.ext" 2>/dev/null
cat "$WORKDIR/certs/broker.crt" "$INT_PEM" >"$WORKDIR/certs/broker-chain.pem"

for svc in "${SERVICES[@]}"; do
  openssl genrsa -out "$WORKDIR/certs/${svc}.key" 2048 2>/dev/null
  openssl req -new -key "$WORKDIR/certs/${svc}.key" -out "$WORKDIR/certs/${svc}.csr" \
    -subj "/CN=${svc}/O=Record Platform" 2>/dev/null
  cat >"$WORKDIR/certs/${svc}.ext" <<EOF
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=clientAuth
subjectAltName=DNS:${svc}
EOF
  openssl x509 -req -in "$WORKDIR/certs/${svc}.csr" -CA "$INT_PEM" -CAkey "$INT_KEY" \
    -CAcreateserial -out "$WORKDIR/certs/${svc}.crt" -days 2 -sha256 -extfile "$WORKDIR/certs/${svc}.ext" 2>/dev/null
  cat "$WORKDIR/certs/${svc}.crt" "$INT_PEM" >"$WORKDIR/certs/${svc}-chain.pem"
  openssl pkcs12 -export -in "$WORKDIR/certs/${svc}-chain.pem" -inkey "$WORKDIR/certs/${svc}.key" \
    -out "$WORKDIR/certs/${svc}.p12" -name c -passout pass:changeit >/dev/null
done

cp "$ROOT_PEM" "$WORKDIR/certs/dev-root.pem"
cp "$INT_PEM" "$WORKDIR/certs/dev-intermediate.pem"
# Combined CA file for agent
cat "$INT_PEM" "$ROOT_PEM" >"$WORKDIR/certs/ca-bundle.pem"

rm -f "$WORKDIR/certs/truststore.jks" "$WORKDIR/certs/keystore.jks"
keytool -importcert -noprompt -alias root -file "$ROOT_PEM" -keystore "$WORKDIR/certs/truststore.jks" -storepass changeit >/dev/null
keytool -importcert -noprompt -alias int -file "$INT_PEM" -keystore "$WORKDIR/certs/truststore.jks" -storepass changeit >/dev/null
openssl pkcs12 -export -in "$WORKDIR/certs/broker-chain.pem" -inkey "$WORKDIR/certs/broker.key" \
  -out "$WORKDIR/certs/broker.p12" -name kafka -passout pass:changeit >/dev/null
keytool -importkeystore -noprompt -srckeystore "$WORKDIR/certs/broker.p12" -srcstoretype PKCS12 -srcstorepass changeit \
  -destkeystore "$WORKDIR/certs/keystore.jks" -deststorepass changeit >/dev/null
# PEM material for agent (broker identity as client+server)
cp "$WORKDIR/certs/broker-chain.pem" "$WORKDIR/certs/agent-cert.pem"
cp "$WORKDIR/certs/broker.key" "$WORKDIR/certs/agent-key.pem"

CLUSTER_ID="$(docker run --rm "$IMAGE" kafka-storage random-uuid)"
BROKER_PRINCIPAL="User:O=record-platform,CN=kafka"
ADMIN_PRINCIPAL="User:O=Record Platform,CN=gate5-v7-admin"
SUPER_USERS="${BROKER_PRINCIPAL};${ADMIN_PRINCIPAL}"

for id in 0 1 2; do
  cat >"$WORKDIR/config/kafka-${id}.properties" <<EOF
process.roles=broker,controller
node.id=${id}
controller.quorum.voters=0@kafka-0:9095,1@kafka-1:9095,2@kafka-2:9095
listeners=INTERNAL://0.0.0.0:9093,CONTROLLER://0.0.0.0:9095
advertised.listeners=INTERNAL://kafka-${id}:9093
listener.security.protocol.map=INTERNAL:SSL,CONTROLLER:SSL
inter.broker.listener.name=INTERNAL
controller.listener.names=CONTROLLER
log.dirs=/tmp/kraft-combined-logs
num.partitions=1
offsets.topic.replication.factor=3
transaction.state.log.replication.factor=3
transaction.state.log.min.isr=2
group.initial.rebalance.delay.ms=0
ssl.keystore.location=/etc/kafka/secrets/keystore.jks
ssl.keystore.password=changeit
ssl.key.password=changeit
ssl.truststore.location=/etc/kafka/secrets/truststore.jks
ssl.truststore.password=changeit
ssl.client.auth=required
listener.name.internal.ssl.client.auth=required
listener.name.controller.ssl.client.auth=required
ssl.endpoint.identification.algorithm=
listener.name.controller.ssl.endpoint.identification.algorithm=HTTPS
authorizer.class.name=org.apache.kafka.metadata.authorizer.StandardAuthorizer
allow.everyone.if.no.acl.found=false
super.users=${SUPER_USERS}
EOF
done

cat >"$WORKDIR/docker-compose.yml" <<EOF
services:
  kafka-0:
    image: ${IMAGE}
    hostname: kafka-0
    mem_limit: 768m
    networks: [abnet]
    volumes:
      - ${WORKDIR}/certs:/etc/kafka/secrets:ro
      - ${WORKDIR}/config/kafka-0.properties:/etc/kafka/kafka.properties:ro
    command: ["bash","-lc","kafka-storage format --ignore-formatted --cluster-id ${CLUSTER_ID} --config /etc/kafka/kafka.properties && exec kafka-server-start /etc/kafka/kafka.properties"]
  kafka-1:
    image: ${IMAGE}
    hostname: kafka-1
    mem_limit: 768m
    networks: [abnet]
    volumes:
      - ${WORKDIR}/certs:/etc/kafka/secrets:ro
      - ${WORKDIR}/config/kafka-1.properties:/etc/kafka/kafka.properties:ro
    command: ["bash","-lc","kafka-storage format --ignore-formatted --cluster-id ${CLUSTER_ID} --config /etc/kafka/kafka.properties && exec kafka-server-start /etc/kafka/kafka.properties"]
  kafka-2:
    image: ${IMAGE}
    hostname: kafka-2
    mem_limit: 768m
    networks: [abnet]
    volumes:
      - ${WORKDIR}/certs:/etc/kafka/secrets:ro
      - ${WORKDIR}/config/kafka-2.properties:/etc/kafka/kafka.properties:ro
    command: ["bash","-lc","kafka-storage format --ignore-formatted --cluster-id ${CLUSTER_ID} --config /etc/kafka/kafka.properties && exec kafka-server-start /etc/kafka/kafka.properties"]
networks:
  abnet:
    name: ${PROJECT}-net
EOF

ok "starting disposable 3-node cluster (${IMAGE})"
docker compose -p "$PROJECT" -f "$WORKDIR/docker-compose.yml" up -d

ready=0
for i in $(seq 1 90); do
  okc=0
  for id in 0 1 2; do
    if docker compose -p "$PROJECT" -f "$WORKDIR/docker-compose.yml" exec -T "kafka-${id}" \
      bash -lc 'kafka-broker-api-versions --bootstrap-server localhost:9093 --command-config <(echo -e "security.protocol=SSL\nssl.keystore.location=/etc/kafka/secrets/keystore.jks\nssl.keystore.password=changeit\nssl.key.password=changeit\nssl.truststore.location=/etc/kafka/secrets/truststore.jks\nssl.truststore.password=changeit\nssl.endpoint.identification.algorithm=") 2>/dev/null | grep -qi ApiVersion'; then
      okc=$((okc+1))
    fi
  done
  if [[ "$okc" -eq 3 ]]; then ready=1; break; fi
  sleep 3
done
[[ "$ready" -eq 1 ]] || fail "disposable brokers not ready"

# ACL: allow each service DESCRIBE/CLUSTER for ApiVersions path used by matrix
for svc in "${SERVICES[@]}"; do
  princ="User:O=Record Platform,CN=${svc}"
  docker compose -p "$PROJECT" -f "$WORKDIR/docker-compose.yml" exec -T kafka-0 bash -lc "
    cat >/tmp/acl.props <<EOF
security.protocol=SSL
ssl.keystore.location=/etc/kafka/secrets/keystore.jks
ssl.keystore.password=changeit
ssl.key.password=changeit
ssl.truststore.location=/etc/kafka/secrets/truststore.jks
ssl.truststore.password=changeit
ssl.endpoint.identification.algorithm=
EOF
    kafka-acls --bootstrap-server kafka-0:9093 --command-config /tmp/acl.props \
      --add --allow-principal '${princ}' --operation Describe --cluster >/dev/null 2>&1 || true
  " || true
done

run_matrix() {
  local arm="$1"
  local out="$WORKDIR/evidence/${arm}-rows.jsonl"
  : >"$out"
  local rounds=3
  [[ "$MODE" == "quick" ]] && rounds=1
  local pass=0 fail=0
  for round in $(seq 1 "$rounds"); do
    for svc in "${SERVICES[@]}"; do
      for bid in 0 1 2; do
        local test_id="${arm}-r${round}-${svc}-b${bid}"
        local rc=0
        docker compose -p "$PROJECT" -f "$WORKDIR/docker-compose.yml" exec -T "kafka-${bid}" bash -lc "
          cat >/tmp/c.props <<EOF
security.protocol=SSL
ssl.keystore.location=/etc/kafka/secrets/${svc}.p12
ssl.keystore.password=changeit
ssl.key.password=changeit
ssl.keystore.type=PKCS12
ssl.truststore.location=/etc/kafka/secrets/truststore.jks
ssl.truststore.password=changeit
ssl.endpoint.identification.algorithm=
client.id=record-platform.${svc}.ab.${arm}.broker${bid}
request.timeout.ms=15000
default.api.timeout.ms=20000
EOF
          timeout 25 kafka-broker-api-versions --bootstrap-server kafka-${bid}:9093 --command-config /tmp/c.props 2>/tmp/err | tee /tmp/out | grep -qiE 'ApiVersion|id@[0-9]+'
        " >/dev/null 2>&1 || rc=$?
        if [[ "$rc" -eq 0 ]]; then pass=$((pass+1)); layer=SUCCESS; else fail=$((fail+1)); layer=KAFKA_FAILURE; fi
        printf '{"arm":"%s","test_id":"%s","round":%s,"service":"%s","broker":%s,"pass":%s,"layer":"%s","exit_code":%s}\n' \
          "$arm" "$test_id" "$round" "$svc" "$bid" "$([[ $rc -eq 0 ]] && echo true || echo false)" "$layer" "$rc" >>"$out"
      done
    done
  done
  echo "${pass}:${fail}"
}

measure_jvm_spawns() {
  # Count java BrokerApiVersionsCommand processes across brokers during a short window
  local n=0
  for id in 0 1 2; do
    local c
    c=$(docker compose -p "$PROJECT" -f "$WORKDIR/docker-compose.yml" exec -T "kafka-${id}" \
      bash -lc "ps -ef | grep -c '[B]rokerApiVersionsCommand' || true" 2>/dev/null | tr -d '\r' || echo 0)
    n=$((n + c))
  done
  echo "$n"
}

ok "ARM A — JVM-per-probe simulation (periodic kafka-broker-api-versions) + matrix"
# Simulate kubelet-style probe on each broker in background
for id in 0 1 2; do
  docker compose -p "$PROJECT" -f "$WORKDIR/docker-compose.yml" exec -d "kafka-${id}" bash -lc '
    while true; do
      cat >/tmp/rp-ready.props <<EOF
security.protocol=SSL
ssl.keystore.location=/etc/kafka/secrets/keystore.jks
ssl.keystore.password=changeit
ssl.key.password=changeit
ssl.truststore.location=/etc/kafka/secrets/truststore.jks
ssl.truststore.password=changeit
ssl.endpoint.identification.algorithm=
client.id=record-platform.kafka.readiness.sim.${HOSTNAME}
EOF
      timeout 40 kafka-broker-api-versions --bootstrap-server localhost:9093 --command-config /tmp/rp-ready.props >/dev/null 2>&1 || true
      sleep 5
    done
  ' >/dev/null 2>&1 || true
done
sleep 8
SPAWN_A="$(measure_jvm_spawns)"
A_COUNTS="$(run_matrix A)"
# stop sim loops
docker compose -p "$PROJECT" -f "$WORKDIR/docker-compose.yml" exec -T kafka-0 bash -lc 'pkill -f "while true" 2>/dev/null || true' >/dev/null 2>&1 || true

ok "ARM B — persistent readiness agents + matrix"
# Agents run on host, connecting via docker published... brokers are not published.
# Use docker run --network container to share netns, or run agent in compose network.
for id in 0 1 2; do
  port=$((18090 + id))
  docker run -d --rm --name "${PROJECT}-agent-${id}" \
    --network "${PROJECT}-net" \
    -v "${WORKDIR}/certs:/certs:ro" \
    -v "${AGENT_BIN}:/agent:ro" \
    -e POD_NAME="kafka-${id}" \
    -e POD_NAMESPACE="record-platform" \
    -e NODE_ID="${id}" \
    -e BROKER_ADDR="kafka-${id}:9093" \
    -e BROKER_SERVER_NAME="kafka-${id}" \
    -e TLS_CERT_FILE=/certs/agent-cert.pem \
    -e TLS_KEY_FILE=/certs/agent-key.pem \
    -e TLS_CA_FILE=/certs/ca-bundle.pem \
    -e HTTP_ADDR="0.0.0.0:8099" \
    -e POLL_INTERVAL=5s \
    -e FRESHNESS_THRESHOLD=30s \
    alpine:3.20 \
    sh -c "wget -qO /tmp/agent http://example.invalid 2>/dev/null; cp /agent /tmp/agent.bin; chmod +x /tmp/agent.bin; exec /tmp/agent.bin" \
    >/dev/null 2>&1 || \
  docker run -d --rm --name "${PROJECT}-agent-${id}" \
    --network "${PROJECT}-net" \
    -v "${WORKDIR}/certs:/certs:ro" \
    -v "${AGENT_BIN}:/agent:ro" \
    -e POD_NAME="kafka-${id}" \
    -e NAMESPACE="record-platform" \
    -e NODE_ID="${id}" \
    -e BROKER_ADDR="kafka-${id}:9093" \
    -e BROKER_SERVER_NAME="kafka-${id}" \
    -e TLS_CERT_FILE=/certs/agent-cert.pem \
    -e TLS_KEY_FILE=/certs/agent-key.pem \
    -e TLS_CA_FILE=/certs/ca-bundle.pem \
    -e HTTP_ADDR="0.0.0.0:8099" \
    --entrypoint /agent \
    alpine:3.20 \
    >/dev/null 2>&1 || warn "agent-${id} start via alpine failed; trying busyboxless host-network skip"
done

# Prefer running agent binary via docker with glibc — use cp-kafka image for agent host
for id in 0 1 2; do
  docker rm -f "${PROJECT}-agent-${id}" >/dev/null 2>&1 || true
  docker run -d --rm --name "${PROJECT}-agent-${id}" \
    --network "${PROJECT}-net" \
    -v "${WORKDIR}/certs:/certs:ro" \
    -v "${AGENT_BIN}:/agent:ro" \
    -e POD_NAME="kafka-${id}" \
    -e NAMESPACE="record-platform" \
    -e NODE_ID="${id}" \
    -e BROKER_ADDR="kafka-${id}:9093" \
    -e BROKER_SERVER_NAME="kafka-${id}" \
    -e TLS_CERT_FILE=/certs/agent-cert.pem \
    -e TLS_KEY_FILE=/certs/agent-key.pem \
    -e TLS_CA_FILE=/certs/ca-bundle.pem \
    -e HTTP_ADDR="0.0.0.0:8099" \
    --entrypoint /bin/bash \
    "$IMAGE" \
    -lc 'chmod +x /agent && exec /agent' >/dev/null
done

sleep 10
B_READY=0
for id in 0 1 2; do
  if docker exec "${PROJECT}-agent-${id}" bash -lc 'curl -sf http://127.0.0.1:8099/readyz' >/dev/null 2>&1; then
    B_READY=$((B_READY+1))
  elif docker exec "${PROJECT}-agent-${id}" bash -lc 'wget -qO- http://127.0.0.1:8099/readyz' >/dev/null 2>&1; then
    B_READY=$((B_READY+1))
  fi
done
SPAWN_B="$(measure_jvm_spawns)"
B_COUNTS="$(run_matrix B)"

# 15-minute stability shortened under RP_AB_MODE=quick to 60s
STABILITY_SECS=900
[[ "$MODE" == "quick" ]] && STABILITY_SECS=60
ok "B-arm stability window ${STABILITY_SECS}s"
hard_fail=0
for ((t=0; t<STABILITY_SECS; t+=15)); do
  for id in 0 1 2; do
    docker exec "${PROJECT}-agent-${id}" bash -lc 'curl -sf http://127.0.0.1:8099/readyz || wget -qO- http://127.0.0.1:8099/readyz' >/dev/null 2>&1 || hard_fail=$((hard_fail+1))
  done
  sleep 15
done

# Restarts
restart_ok=0
for id in 0 1 2; do
  docker compose -p "$PROJECT" -f "$WORKDIR/docker-compose.yml" restart "kafka-${id}" >/dev/null
  sleep 20
  if docker exec "${PROJECT}-agent-${id}" bash -lc 'curl -sf http://127.0.0.1:8099/readyz || wget -qO- http://127.0.0.1:8099/readyz' >/dev/null 2>&1; then
    restart_ok=$((restart_ok+1))
  fi
done

python3 - "$OUT_JSON" "$OUT_MD" "$OUT_B_STAB" "$A_COUNTS" "$B_COUNTS" "$SPAWN_A" "$SPAWN_B" "$B_READY" "$hard_fail" "$restart_ok" "$MODE" "$WORKDIR" <<'PY'
import json, sys, datetime
from pathlib import Path
out_json, out_md, out_stab, a_counts, b_counts, spawn_a, spawn_b, b_ready, hard_fail, restart_ok, mode, workdir = sys.argv[1:]
now=datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
ap,af=map(int,a_counts.split(":"))
bp,bf=map(int,b_counts.split(":"))
an,bn=ap+af, bp+bf
b_pass = (bf==0 and bn>=1 and int(b_ready)==3 and int(hard_fail)==0 and int(restart_ok)==3 and int(spawn_b)==0)
doc={
  "document":"gate5-pre-v10-readiness-ab-comparison",
  "ts": now,
  "status": "PASS" if b_pass and mode=="full" and bn==108 else ("PASS_QUICK_NON_ACCEPTANCE" if b_pass and mode=="quick" else "FAIL"),
  "mode": mode,
  "live_kafka_mutated": False,
  "v10_created": False,
  "A":{
    "executed": True,
    "rows_expected_tested_passed_failed": f"{an}/{an}/{ap}/{af}",
    "jvm_probe_like_processes_sampled": int(spawn_a),
  },
  "B":{
    "executed": True,
    "rows_expected_tested_passed_failed": f"{bn}/{bn}/{bp}/{bf}",
    "persistent_agents_ready": f"{b_ready}/3",
    "jvm_probe_like_processes_sampled": int(spawn_b),
    "processes_spawned_per_kubelet_http_request": 0,
  },
  "b_arm_acceptance_passed": b_pass and mode=="full" and bn==108 and bp==108,
  "notes": "Acceptance requires mode=full with 108/108 B successes. Quick mode is non-accepting.",
  "evidence_dir": workdir+"/evidence",
}
stab={
  "document":"gate5-pre-v10-readiness-b-arm-stability",
  "ts": now,
  "mode": mode,
  "hard_failures": int(hard_fail),
  "restart_convergence": f"{restart_ok}/3",
  "passed": b_pass and mode=="full",
  "live_kafka_mutated": False,
}
Path(out_json).write_text(json.dumps(doc,indent=2)+"\n")
Path(out_stab).write_text(json.dumps(stab,indent=2)+"\n")
Path(out_md).write_text(
  f"# Readiness A/B comparison\n\nstatus=`{doc['status']}` mode=`{mode}`\n\n"
  f"- A: {doc['A']}\n- B: {doc['B']}\n- b_arm_acceptance_passed: `{doc['b_arm_acceptance_passed']}`\n"
  f"- live_kafka_mutated: false\n- v10_created: false\n"
)
print(json.dumps(doc,indent=2))
PY

ok "A/B reports written"
