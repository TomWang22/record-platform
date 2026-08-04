#!/usr/bin/env bash
# Cross-broker readiness JVM synchronization measurement (attribution only).
# Does not mutate frozen Gate 5 roots. Does not change the probe design.
set -euo pipefail
RCA="${RP_GATE5_ATTR_ROOT:-/tmp/record-platform-gate5-pre-v10-failure-attribution-v1}"
NS="${HOUSING_NS:-record-platform}"
OUT="${RCA}/probe-overlap"
N="${PROBE_SYNC_N:-30}"
mkdir -p "$OUT"

# Launch concurrent measurement jobs on all three brokers roughly synchronized
for b in 0 1 2; do
  kubectl -n "$NS" exec "kafka-$b" -c kafka -- bash -lc "
set -euo pipefail
N=$N
KS=/etc/kafka/secrets
PASS=\$(cat \$KS/kafka.keystore-password)
TPASS=\$(cat \$KS/kafka.truststore-password)
HOST=\${HOSTNAME}.kafka.record-platform.svc.cluster.local
ms(){ python3 -c 'import time;print(int(time.time()*1000))'; }
i=0
while [ \$i -lt \$N ]; do
  i=\$((i+1))
  spawn=\$(ms)
  {
    echo security.protocol=SSL
    echo ssl.keystore.location=\$KS/kafka.keystore.jks
    echo ssl.keystore.password=\$PASS
    echo ssl.key.password=\$PASS
    echo ssl.truststore.location=\$KS/kafka.truststore.jks
    echo ssl.truststore.password=\$TPASS
    echo ssl.endpoint.identification.algorithm=HTTPS
    echo client.id=record-platform.kafka.readiness.sync.\${HOSTNAME}.\$i
    echo request.timeout.ms=25000
    echo default.api.timeout.ms=30000
  } >/tmp/rp-ready-sync.props
  jvm_start=\$(ms)
  set +e
  OUT=\$(timeout 40 kafka-broker-api-versions --bootstrap-server \${HOST}:9093 --command-config /tmp/rp-ready-sync.props 2>&1)
  RC=\$?
  set -e
  jvm_exit=\$(ms)
  ok=0; echo \"\$OUT\" | grep -qiE 'ApiVersion|id@[0-9]+' && ok=1 || true
  echo \"SYNC broker=$b i=\$i spawn_ms=\$spawn jvm_start_ms=\$jvm_start jvm_exit_ms=\$jvm_exit duration_ms=\$((jvm_exit-spawn)) rc=\$RC ok=\$ok\"
  # emulate kubelet period spacing lightly so we observe natural cadence too
  sleep 1
done
" >"$OUT/broker-$b.log" 2>&1 &
  echo $! >"$OUT/broker-$b.pid"
done
wait
echo ALL_BROKER_SYNCS_DONE
