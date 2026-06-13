#!/usr/bin/env bash
# T15.4S-2 — Kafka 3-broker TLS producer/consumer contract.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

NS="${HOUSING_NS:-record-platform}"
REPORT_DIR="${REPORT_DIR:-$REPO_ROOT/bench_logs/security-contract}"
REPORT_MD="${REPORT_MD:-$REPORT_DIR/kafka-3broker-producer-consumer-contract.md}"
FAIL=0
pass() { echo "✅ $*"; }
fail() { echo "❌ $*"; FAIL=1; }
say() { printf "\n\033[1m%s\033[0m\n" "$*"; }

# Canonical 3-broker seeds (headless service `kafka` → kafka-N.kafka.ns.svc)
SEEDS=(
  "kafka-0.kafka.${NS}.svc.cluster.local:9093"
  "kafka-1.kafka.${NS}.svc.cluster.local:9093"
  "kafka-2.kafka.${NS}.svc.cluster.local:9093"
)
ALT_HEADLESS=(
  "kafka-0.kafka-headless.${NS}.svc.cluster.local:9093"
  "kafka-1.kafka-headless.${NS}.svc.cluster.local:9093"
  "kafka-2.kafka-headless.${NS}.svc.cluster.local:9093"
)

PRODUCERS=(
  analytics-service
  auction-monitor
  notification-service
  python-ai-service
  listings-service
  messaging-service
  shopping-service
)

mkdir -p "$REPORT_DIR"
say "=== audit-rp-kafka-producer-consumer-contract ==="

bash "$SCRIPT_DIR/verify-kafka-ready.sh" && pass "verify-kafka-ready" || fail "verify-kafka-ready"
bash "$SCRIPT_DIR/rp-verify-kafka-cert-chain.sh" && pass "rp-verify-kafka-cert-chain" || fail "rp-verify-kafka-cert-chain"

kubectl get pods -n "$NS" -l app=kafka -o wide 2>/dev/null | tee "$REPORT_DIR/kafka-pods-wide.txt" || fail "kafka pods"
[[ "$(kubectl get pods -n "$NS" -l app=kafka --no-headers 2>/dev/null | wc -l | tr -d ' ')" == "3" ]] \
  && pass "3 kafka broker pods" || fail "expected 3 kafka pods"

# app-config broker CSV must include all three per-broker seeds
BROKER_CSV="$(kubectl get configmap app-config -n "$NS" -o jsonpath='{.data.KAFKA_BROKER}' 2>/dev/null || true)"
[[ -n "$BROKER_CSV" ]] || fail "app-config KAFKA_BROKER empty"
echo "$BROKER_CSV" | rg -q '9092' && fail "PLAINTEXT port 9092 in KAFKA_BROKER"
echo "$BROKER_CSV" | rg -q 'localhost' && fail "localhost in KAFKA_BROKER"
for seed in "${SEEDS[@]}"; do
  echo "$BROKER_CSV" | grep -qF "${seed%:*}" && pass "seed present: $seed" || fail "missing seed $seed in KAFKA_BROKER"
done

# Producer pods: CA + client cert + key + TLS handshake from inside pod
for dep in "${PRODUCERS[@]}"; do
  kubectl get deployment "$dep" -n "$NS" &>/dev/null || { echo "ℹ️  skip $dep"; continue; }
  env="$(kubectl get deployment "$dep" -n "$NS" -o jsonpath='{range .spec.template.spec.containers[0].env[*]}{.name}={.value}{"\n"}{end}' 2>/dev/null || true)"
  echo "$env" | grep -qE 'KAFKA_(SSL_ENABLED|USE_SSL)=true' || fail "$dep missing KAFKA_SSL_ENABLED/USE_SSL"
  echo "$env" | grep -qE 'KAFKA_(CA_CERT|SSL_CA_CERT)=/etc/kafka/secrets/ca-cert.pem' && pass "$dep kafka CA env" || fail "$dep KAFKA_CA_CERT"
  if kubectl get deployment "$dep" -n "$NS" -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null | grep -q python-ai; then
    : # python-ai may be consumer-only via analytics jobs
  else
    echo "$env" | grep -q 'KAFKA_CLIENT_CERT=/etc/kafka/secrets/client.crt' && pass "$dep KAFKA_CLIENT_CERT" || fail "$dep KAFKA_CLIENT_CERT"
    echo "$env" | grep -q 'KAFKA_CLIENT_KEY=/etc/kafka/secrets/client.key' && pass "$dep KAFKA_CLIENT_KEY" || fail "$dep KAFKA_CLIENT_KEY"
  fi
  kubectl exec -n "$NS" "deployment/$dep" -- sh -c 'test -f /etc/kafka/secrets/ca-cert.pem && test -f /etc/kafka/secrets/client.crt && test -f /etc/kafka/secrets/client.key' \
    && pass "$dep kafka secret mounts" || fail "$dep kafka secret mounts"
  if kubectl exec -n "$NS" "deployment/$dep" -- sh -c 'command -v node >/dev/null' 2>/dev/null; then
    kubectl exec -n "$NS" "deployment/$dep" -- node -e "
const tls=require('tls');const fs=require('fs');
const opts={host:'kafka-0.kafka.${NS}.svc.cluster.local',port:9093,servername:'kafka-0.kafka.${NS}.svc.cluster.local',ca:fs.readFileSync('/etc/kafka/secrets/ca-cert.pem'),cert:fs.readFileSync('/etc/kafka/secrets/client.crt'),key:fs.readFileSync('/etc/kafka/secrets/client.key'),rejectUnauthorized:true};
const s=tls.connect(opts,()=>{console.log('ok');s.end();process.exit(0);});
s.on('error',e=>{console.error(e.message);process.exit(1);});
setTimeout(()=>process.exit(1),8000);
" 2>/dev/null && pass "$dep TLS handshake kafka-0:9093" || fail "$dep TLS handshake"
  else
    kubectl exec -n "$NS" "deployment/$dep" -- openssl s_client -connect "kafka-0.kafka.${NS}.svc.cluster.local:9093" \
      -CAfile /etc/kafka/secrets/ca-cert.pem -cert /etc/kafka/secrets/client.crt -key /etc/kafka/secrets/client.key \
      -servername "kafka-0.kafka.${NS}.svc.cluster.local" -brief </dev/null 2>/dev/null \
      && pass "$dep TLS handshake (openssl) kafka-0:9093" || fail "$dep TLS handshake"
  fi
done

# Consumer groups
for grp in notification-service-group; do
  kubectl exec -n "$NS" kafka-0 -- sh -c "
cat >/tmp/client.properties <<EOF
security.protocol=SSL
ssl.truststore.location=/etc/kafka/secrets/kafka.truststore.jks
ssl.truststore.password=\$(cat /etc/kafka/secrets/kafka.truststore-password)
ssl.keystore.location=/etc/kafka/secrets/kafka.keystore.jks
ssl.keystore.password=\$(cat /etc/kafka/secrets/kafka.keystore-password)
ssl.key.password=\$(cat /etc/kafka/secrets/kafka.key-password)
EOF
/opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server kafka-0.kafka.${NS}.svc.cluster.local:9093 --command-config /tmp/client.properties --group $grp --describe 2>/dev/null | head -5
" 2>/dev/null | tee "$REPORT_DIR/kafka-consumer-group-${grp}.txt" && pass "consumer group $grp" || fail "consumer group $grp"
done

# Topic list from broker 0 with SSL client props
kubectl exec -n "$NS" kafka-0 -- sh -c "
cat >/tmp/client.properties <<EOF
security.protocol=SSL
ssl.truststore.location=/etc/kafka/secrets/kafka.truststore.jks
ssl.truststore.password=\$(cat /etc/kafka/secrets/kafka.truststore-password)
ssl.keystore.location=/etc/kafka/secrets/kafka.keystore.jks
ssl.keystore.password=\$(cat /etc/kafka/secrets/kafka.keystore-password)
ssl.key.password=\$(cat /etc/kafka/secrets/kafka.key-password)
EOF
/opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka-0.kafka.${NS}.svc.cluster.local:9093 --list --command-config /tmp/client.properties 2>/dev/null | head -20
" 2>/dev/null | tee "$REPORT_DIR/kafka-topics-list.txt" && pass "kafka-topics --list SSL" || fail "kafka-topics list"

{
  echo "# Kafka 3-broker producer/consumer contract"
  echo ""
  echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo ""
  echo "## Seeds (app-config)"
  echo "\`$BROKER_CSV\`"
  echo ""
  echo "Headless service: \`kafka\` (ClusterIP None) — equivalent to kafka-headless alias."
  echo ""
  echo "**RESULT: $([[ $FAIL -eq 0 ]] && echo PASS || echo FAIL)**"
} >"$REPORT_MD"

[[ "$FAIL" -eq 0 ]] || exit 1
pass "audit-rp-kafka-producer-consumer-contract complete"
