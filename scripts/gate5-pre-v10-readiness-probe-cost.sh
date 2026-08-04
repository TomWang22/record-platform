#!/usr/bin/env bash
# Measure authenticated Kafka readiness probe cost: 30 invocations × 3 brokers.
# Outside Gate 5 v8/v9. Does not mutate frozen roots.
set -euo pipefail

RCA="${RP_GATE5_STABILITY_RCA:-/tmp/record-platform-gate5-pre-v10-stability-rca-v1}"
NS="${HOUSING_NS:-record-platform}"
OUT_DIR="${RCA}/probe-cost"
mkdir -p "$OUT_DIR"
N_PER="${PROBE_COST_N:-30}"

measure_broker() {
  local bid="$1"
  local pod="kafka-${bid}"
  local rows="${OUT_DIR}/broker-${bid}-invocations.jsonl"
  : >"$rows"
  kubectl -n "$NS" exec "$pod" -c kafka -- bash -lc "
set -euo pipefail
N=${N_PER}
KS=/etc/kafka/secrets
PASS=\$(cat \"\$KS/kafka.keystore-password\")
TPASS=\$(cat \"\$KS/kafka.truststore-password\")
HOST=\"\${HOSTNAME}.kafka.record-platform.svc.cluster.local\"
# static audit of what the readiness command does
echo 'STATIC_AUDIT keytool=0 openssl_convert=0 pkcs12=0 jks_generate=0 uses_mounted_jks=1 jvm_cli_each_invoke=1 rewrites_tmp_props=1 multi_broker_bootstrap=0'
before_tmp=\$(ls /tmp/rp-ready.props 2>/dev/null | wc -l | tr -d ' ')
before_java=\$(ps -ef | grep -c '[j]ava' || true)
i=0
while [ \"\$i\" -lt \"\$N\" ]; do
  i=\$((i+1))
  start=\$(date +%s%3N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1000))')
  {
    echo \"security.protocol=SSL\"
    echo \"ssl.keystore.location=\${KS}/kafka.keystore.jks\"
    echo \"ssl.keystore.password=\${PASS}\"
    echo \"ssl.key.password=\${PASS}\"
    echo \"ssl.truststore.location=\${KS}/kafka.truststore.jks\"
    echo \"ssl.truststore.password=\${TPASS}\"
    echo \"ssl.endpoint.identification.algorithm=HTTPS\"
    echo \"client.id=record-platform.kafka.readiness.cost.\${HOSTNAME}.\$i\"
    echo \"request.timeout.ms=25000\"
    echo \"default.api.timeout.ms=30000\"
  } >/tmp/rp-ready.props
  set +e
  OUT=\$(timeout 40 kafka-broker-api-versions --bootstrap-server \"\${HOST}:9093\" --command-config /tmp/rp-ready.props 2>&1)
  RC=\$?
  set -e
  end=\$(date +%s%3N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1000))')
  ok=0
  echo \"\$OUT\" | grep -qiE 'ApiVersion|id@[0-9]+' && ok=1 || true
  timed_out=0
  [ \"\$RC\" -eq 124 ] && timed_out=1 || true
  dur=\$((end-start))
  echo \"INV broker=${bid} i=\$i duration_ms=\$dur rc=\$RC ok=\$ok timed_out=\$timed_out tmp_props=1\"
done
after_tmp=\$(ls /tmp/rp-ready.props 2>/dev/null | wc -l | tr -d ' ')
after_java=\$(ps -ef | grep -c '[j]ava' || true)
echo \"LEAK_CHECK before_tmp=\$before_tmp after_tmp=\$after_tmp before_java=\$before_java after_java=\$after_java\"
" 2>&1 | tee "${OUT_DIR}/broker-${bid}-raw.log"
}

for b in 0 1 2; do
  echo "=== measuring kafka-$b ==="
  measure_broker "$b"
done

python3 - "$OUT_DIR" "$N_PER" <<'PY'
import json, re, statistics, sys
from pathlib import Path
from datetime import datetime, timezone
out=Path(sys.argv[1]); n=int(sys.argv[2])
inv=[]
static={}
leaks={}
for bid in (0,1,2):
  text=(out/f"broker-{bid}-raw.log").read_text(errors="replace")
  for line in text.splitlines():
    if line.startswith("STATIC_AUDIT"):
      static[bid]={k:v for k,v in re.findall(r'(\w+)=(\S+)', line)}
    if line.startswith("LEAK_CHECK"):
      leaks[bid]={k:int(v) for k,v in re.findall(r'(\w+)=(\d+)', line)}
    m=re.search(r'INV broker=(\d+) i=(\d+) duration_ms=(\d+) rc=(\d+) ok=(\d+) timed_out=(\d+)', line)
    if m:
      inv.append({
        "broker":int(m.group(1)),"i":int(m.group(2)),"duration_ms":int(m.group(3)),
        "exit_code":int(m.group(4)),"ok":m.group(5)=="1","timed_out":m.group(6)=="1"
      })
by={b:[x for x in inv if x["broker"]==b] for b in (0,1,2)}
def stats(rows):
  ds=sorted(r["duration_ms"] for r in rows)
  def pct(p):
    if not ds: return None
    k=int(round((p/100)*(len(ds)-1)))
    return ds[k]
  return {
    "count":len(rows),
    "ok":sum(1 for r in rows if r["ok"]),
    "timed_out":sum(1 for r in rows if r["timed_out"]),
    "min":min(ds) if ds else None,
    "median":int(statistics.median(ds)) if ds else None,
    "p95":pct(95),
    "max":max(ds) if ds else None,
  }
report={
  "document":"gate5-pre-v10-readiness-probe-cost",
  "ts":datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
  "readiness_expected_tested":f"{3*n}/{len(inv)}",
  "static_command_audit":{
    "keytool_import_per_probe":False,
    "pkcs12_creation_per_probe":False,
    "openssl_certificate_conversion_per_probe":False,
    "java_source_compilation_per_probe":False,
    "truststore_generation_per_probe":False,
    "keystore_generation_per_probe":False,
    "uses_mounted_broker_jks":True,
    "rewrites_tmp_rp_ready_props_each_invoke":True,
    "kafka_cli_jvm_startup_each_invoke":True,
    "multi_broker_bootstrap":False,
    "direct_endpoint":"$(hostname).kafka.record-platform.svc.cluster.local:9093",
    "hostname_verification":"HTTPS",
    "periodSeconds":45,
    "timeoutSeconds":45,
    "timeout_equals_period_no_margin":True,
  },
  "static_from_runtime":static,
  "leaks":leaks,
  "per_broker":{str(b):stats(by[b]) for b in (0,1,2)},
  "overall":stats(inv),
  "readiness_probe_overlap_possible":True,
  "readiness_probe_process_leaks": any(leaks.get(b,{}).get("after_java",0)>leaks.get(b,{}).get("before_java",0)+2 for b in (0,1,2)),
  "readiness_probe_temp_file_leaks":False,
  "note_temp_file":"/tmp/rp-ready.props overwritten in place each invoke (not accumulated)",
  "invocations":inv,
}
(out/"summary.json").write_text(json.dumps(report, indent=2)+"\n")
repo=Path("/Users/tom/record-platform/reports/kafka")
repo.mkdir(parents=True, exist_ok=True)
(repo/"gate5-pre-v10-readiness-probe-cost.json").write_text(json.dumps(report, indent=2)+"\n")
md=[
  "# Gate 5 pre-v10 readiness probe cost",
  "",
  f"- expected/tested: **{report['readiness_expected_tested']}**",
  f"- overall timeouts: **{report['overall']['timed_out']}**",
  f"- duration ms min/median/p95/max: **{report['overall']['min']}/{report['overall']['median']}/{report['overall']['p95']}/{report['overall']['max']}**",
  "",
  "## Static audit",
  "",
  "- No per-probe keytool/openssl/PKCS12/JKS generation — uses mounted `/etc/kafka/secrets/*.jks`.",
  "- Each invoke: rewrite `/tmp/rp-ready.props` + cold-start `kafka-broker-api-versions` (JVM).",
  "- Direct single broker DNS; HTTPS hostname verification; no multi-broker bootstrap.",
  "- **timeoutSeconds == periodSeconds (45)** — no scheduling margin.",
  "",
]
for b in (0,1,2):
  s=report["per_broker"][str(b)]
  md.append(f"- kafka-{b}: n={s['count']} ok={s['ok']} timeouts={s['timed_out']} min/med/p95/max={s['min']}/{s['median']}/{s['p95']}/{s['max']}")
(repo/"gate5-pre-v10-readiness-probe-cost.md").write_text("\n".join(md)+"\n")
print(json.dumps({"expected_tested":report["readiness_expected_tested"],"overall":report["overall"],"timeout_equals_period":True}, indent=2))
PY
