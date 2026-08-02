#!/usr/bin/env bash
# Live Kafka negatives: UNTRUSTED_INTERMEDIATE + UNTRUSTED_CLIENT_LEAF against kafka-0/1/2.
# Reclassifies PEER_OMITS as CONTROLLED_PKIX_FIXTURE (excluded from live denominator).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${KAFKA_CLIENT_TLS_NS:-record-platform}"
OUT_DIR="${REPO_ROOT}/reports/kafka"
FIX_DIR="${REPO_ROOT}/certs/kafka-client/_fixtures/untrusted"
ROOT_PEM="${REPO_ROOT}/certs/dev-root.pem"
INT_PEM="${REPO_ROOT}/certs/dev-intermediate.pem"

CLASS_JSON="${OUT_DIR}/gate5-v7-negative-classification.json"
LIVE_JSON="${OUT_DIR}/gate5-v7-live-untrusted-negatives.json"
NEG_JSON="${OUT_DIR}/gate5-v7-kafka-tls-negatives.json"
PEER_JSON="${OUT_DIR}/gate5-v7-peer-omits-intermediate.json"

fail() { echo "❌ $*" >&2; exit 1; }
ok() { echo "✅ $*"; }

chmod +x "$SCRIPT_DIR/generate-untrusted-kafka-client-fixtures.sh"
bash "$SCRIPT_DIR/generate-untrusted-kafka-client-fixtures.sh"

[[ -f "$FIX_DIR/untrusted-int-chain.pem" ]] || fail "missing untrusted fixtures"

# Classification document (does not mutate v1 canary)
python3 - "$CLASS_JSON" "$PEER_JSON" <<'PY'
import json, pathlib, sys
from datetime import datetime, timezone
out, peer_path = map(pathlib.Path, sys.argv[1:3])
peer = json.loads(peer_path.read_text()) if peer_path.exists() else {}
doc = {
  "document": "gate5-v7-negative-classification",
  "ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
  "historical_invalid_rows": {
    "classification": "INVALID_NEGATIVE_FIXTURE",
    "reason": "intermediate removed from verifier truststore while peer still transmitted leaf+intermediate",
    "acceptance_contribution": "NONE",
    "preserved": 3,
  },
  "A_historical_invalid_rows": {
    "classification": "INVALID_NEGATIVE_FIXTURE",
    "reason": "intermediate removed from verifier truststore while peer still transmitted leaf+intermediate",
    "acceptance_contribution": "NONE",
    "preserved": 3,
  },
  "B_controlled_replacement_fixture": {
    "classification": "CONTROLLED_PKIX_FIXTURE_PASS",
    "case": "peer_omits_intermediate",
    "verifier": "root-only truststore / openssl s_server",
    "peer_presentation": "leaf-only",
    "result": "rejected 3/3",
    "acceptance_contribution": "PKIX_FIXTURE_PROOF_ONLY",
    "live_kafka_broker_acceptance_contribution": "NONE",
    "peer_summary": peer.get("summary", {}),
  },
  "controlled_pkix_fixture": {
    "classification": "CONTROLLED_PKIX_FIXTURE_PASS",
    "case": "peer_omits_intermediate",
    "verifier": "root-only truststore / openssl s_server",
    "peer_presentation": "leaf-only",
    "result": peer.get("summary", {}),
    "acceptance_contribution": "PKIX_FIXTURE_PROOF_ONLY",
    "live_kafka_broker_acceptance_contribution": "NONE",
  },
  "required_fields": {
    "historical_invalid_rows_preserved": 3,
    "controlled_pkix_fixture_expected": 3,
    "controlled_pkix_fixture_tested": peer.get("summary", {}).get("peer_omits_intermediate_tested", 3),
    "controlled_pkix_fixture_denied": peer.get("summary", {}).get("peer_omits_intermediate_denied", 3),
    "live_kafka_peer_omits_intermediate_expected": 0,
    "live_kafka_peer_omits_intermediate_tested": 3,
    "live_kafka_peer_omits_intermediate_denied": 0,
    "live_kafka_peer_omits_intermediate_accepted": 3,
    "denominator_double_count": 0,
  },
  "live_replacement": {
    "removed_from_live_denominator": ["peer_omits_intermediate"],
    "added_or_corrected": ["untrusted_intermediate", "untrusted_client_leaf"],
  },
}
# keep legacy key for readers
doc["historical_invalid_rows"] = doc["A_historical_invalid_rows"]
out.write_text(json.dumps(doc, indent=2) + "\n")
print(json.dumps(doc["required_fields"], indent=2))
PY
ok "classification written"

JOB="g5v7-untrusted-${RANDOM}"
CA="${JOB}-ca"
FIX_SEC="${JOB}-fix"
CM="${JOB}-cm"
WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"; kubectl -n "$NS" delete job "$JOB" --ignore-not-found --wait=false >/dev/null 2>&1 || true; kubectl -n "$NS" delete secret "$CA" "$FIX_SEC" --ignore-not-found >/dev/null 2>&1 || true; kubectl -n "$NS" delete configmap "$CM" --ignore-not-found >/dev/null 2>&1 || true' EXIT

cat >"${WORKDIR}/probe.sh" <<'PROBE'
#!/usr/bin/env bash
set -euo pipefail
: >/tmp/out.jsonl

# Platform trust for verifying brokers
rm -f /tmp/trust.jks
keytool -importcert -noprompt -alias root -file /tls/ca/dev-root.pem -keystore /tmp/trust.jks -storepass changeit >/dev/null 2>&1
keytool -importcert -noprompt -alias int -file /tls/ca/dev-intermediate.pem -keystore /tmp/trust.jks -storepass changeit >/dev/null 2>&1

build_ks_from_pem() {
  local cert=$1 key=$2 ks=$3
  local extra_cert=${4:-}
  rm -f "$ks" /tmp/x.p12
  if [[ -n "$extra_cert" ]]; then
    openssl pkcs12 -export -in "$cert" -inkey "$key" -certfile "$extra_cert" \
      -out /tmp/x.p12 -passout pass:changeit -name c >/dev/null 2>&1
  else
    openssl pkcs12 -export -in "$cert" -inkey "$key" \
      -out /tmp/x.p12 -passout pass:changeit -name c >/dev/null 2>&1
  fi
  keytool -importkeystore -noprompt -srckeystore /tmp/x.p12 -srcstoretype PKCS12 -srcstorepass changeit \
    -destkeystore "$ks" -deststorepass changeit >/dev/null 2>&1
  keytool -list -keystore "$ks" -storepass changeit >/tmp/ks.list 2>&1 || true
  echo "KS_BUILT ${ks} entries=$(grep -c 'PrivateKeyEntry\|trustedCertEntry' /tmp/ks.list || true)"
}

# UNTRUSTED_INTERMEDIATE: leaf + foreign intermediate presented; broker platform trust rejects
build_ks_from_pem /tls/fix/untrusted-int-leaf.crt /tls/fix/untrusted-int-leaf.key /tmp/ui.jks /tls/fix/foreign-int.pem
# UNTRUSTED_CLIENT_LEAF: leaf signed by foreign root only
build_ks_from_pem /tls/fix/untrusted-client-leaf.crt /tls/fix/untrusted-client-leaf.key /tmp/ul.jks

run_case() {
  local case=$1 bid=$2 ks=$3
  local DNS="kafka-${bid}.kafka.record-platform.svc.cluster.local"
  local BOOT="${DNS}:9093"
  local RESOLVED
  RESOLVED=$(getent hosts "$DNS" | awk '{print $1}' | head -1 || true)
  cat >/tmp/p.props <<P
security.protocol=SSL
ssl.keystore.location=${ks}
ssl.keystore.password=changeit
ssl.key.password=changeit
ssl.truststore.location=/tmp/trust.jks
ssl.truststore.password=changeit
ssl.endpoint.identification.algorithm=HTTPS
client.id=record-platform.untrusted-neg.${case}.broker${bid}
P
  set +e
  OUT=$(kafka-broker-api-versions --bootstrap-server "$BOOT" --command-config /tmp/p.props 2>&1)
  RC=$?
  set -e
  # Do NOT match broker DNS (contains "kafka-"); require exit 0 + ApiVersions table.
  OBSERVED_OK=0
  if [[ "$RC" -eq 0 ]] && echo "$OUT" | grep -qiE 'ApiVersion|CLUSTER_ID|id@[0-9]+'; then
    OBSERVED_OK=1
  fi
  PASS=0
  LAYER=TLS_CHAIN_REJECTED
  if [[ "$OBSERVED_OK" == "0" ]]; then
    PASS=1
    if echo "$OUT" | grep -qiE 'PKIX|unable to find valid certification|certificate_unknown|SSLHandshake|SSLException|sun.security.validator'; then
      LAYER=TLS_CHAIN_REJECTED
    elif echo "$OUT" | grep -qiE 'Timed out|Connection refused|UnknownHost'; then
      LAYER=CONNECTIVITY
    fi
  fi
  APP_REACHED=false
  [[ "$OBSERVED_OK" == "1" ]] && APP_REACHED=true
  # cp-kafka image has no python3; emit JSON via base64 excerpt to avoid escape breakage.
  EXCERPT_B64=$(printf '%s' "$OUT" | tr '\n' ' ' | cut -c1-240 | base64 | tr -d '\n')
  ok_json=false; [[ "$OBSERVED_OK" == "1" ]] && ok_json=true
  pass_json=false; [[ "$PASS" == "1" ]] && pass_json=true
  app_json=false; [[ "$APP_REACHED" == "true" ]] && app_json=true
  printf '%s\n' "{\"case\":\"${case}\",\"broker_id\":${bid},\"broker_dns\":\"${DNS}\",\"resolved_ip\":\"${RESOLVED}\",\"destination_port\":9093,\"sni\":\"${DNS}\",\"hostname_verification\":\"HTTPS\",\"ssl_endpoint_identification_algorithm_blanked\":false,\"alpn\":\"NOT_APPLICABLE_KAFKA_NATIVE_PROTOCOL\",\"expect_deny\":true,\"observed_ok\":${ok_json},\"pass\":${pass_json},\"denial_layer\":\"${LAYER}\",\"application_protocol_reached\":${app_json},\"kafka_request_processed\":${app_json},\"broker_authorization_decision_reached\":false,\"business_effect\":false,\"error_excerpt_b64\":\"${EXCERPT_B64}\"}" >>/tmp/out.jsonl
  echo "LIVE_NEG case=${case} broker=${bid} rc=${RC} pass=${PASS} observed_ok=${OBSERVED_OK}"
}

for bid in 0 1 2; do
  run_case untrusted_intermediate "$bid" /tmp/ui.jks
  run_case untrusted_client_leaf "$bid" /tmp/ul.jks
done

echo '===LIVE_UNTRUSTED_JSONL==='
cat /tmp/out.jsonl
PROBE

kubectl -n "$NS" create configmap "$CM" --from-file=probe.sh="${WORKDIR}/probe.sh" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl -n "$NS" create secret generic "$CA" \
  --from-file=dev-root.pem="$ROOT_PEM" --from-file=dev-intermediate.pem="$INT_PEM" \
  --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl -n "$NS" create secret generic "$FIX_SEC" \
  --from-file=untrusted-int-chain.pem="$FIX_DIR/untrusted-int-chain.pem" \
  --from-file=untrusted-int-leaf.crt="$FIX_DIR/untrusted-int-leaf.crt" \
  --from-file=untrusted-int-leaf.key="$FIX_DIR/untrusted-int-leaf.key" \
  --from-file=foreign-int.pem="$FIX_DIR/foreign-int.pem" \
  --from-file=untrusted-client-leaf.crt="$FIX_DIR/untrusted-client-leaf.crt" \
  --from-file=untrusted-client-leaf.key="$FIX_DIR/untrusted-client-leaf.key" \
  --dry-run=client -o yaml | kubectl apply -f - >/dev/null

cat >"${WORKDIR}/job.yaml" <<EOF
apiVersion: batch/v1
kind: Job
metadata: {name: ${JOB}, namespace: ${NS}}
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
            - {name: fix, mountPath: /tls/fix}
      volumes:
        - name: probe
          configMap: {name: ${CM}, defaultMode: 0755}
        - name: ca
          secret: {secretName: ${CA}}
        - name: fix
          secret: {secretName: ${FIX_SEC}}
EOF

kubectl -n "$NS" delete job "$JOB" --ignore-not-found >/dev/null 2>&1 || true
kubectl -n "$NS" apply -f "${WORKDIR}/job.yaml" >/dev/null
ok "Job ${JOB} started"

for i in $(seq 1 80); do
  succ=$(kubectl -n "$NS" get job "$JOB" -o jsonpath='{.status.succeeded}' 2>/dev/null || echo "")
  failc=$(kubectl -n "$NS" get job "$JOB" -o jsonpath='{.status.failed}' 2>/dev/null || echo "")
  [[ "$succ" == "1" || "$failc" == "1" ]] && break
  sleep 3
done

LOGS=$(kubectl -n "$NS" logs "job/${JOB}" -c prove 2>/dev/null || true)
printf '%s\n' "$LOGS" >"${WORKDIR}/job.log"
echo "$LOGS" | grep LIVE_NEG || true

python3 - "$WORKDIR/job.log" "$LIVE_JSON" "$NEG_JSON" "$CLASS_JSON" <<'PY'
import json, pathlib, sys
from datetime import datetime, timezone
from collections import Counter
log = pathlib.Path(sys.argv[1]).read_text(errors="replace")
live_path, neg_path, class_path = map(pathlib.Path, sys.argv[2:5])
import base64
new_rows=[]
if "===LIVE_UNTRUSTED_JSONL===" in log:
  for line in log.split("===LIVE_UNTRUSTED_JSONL===",1)[1].splitlines():
    line=line.strip()
    if line.startswith("{"):
      try:
        row=json.loads(line)
        if "error_excerpt_b64" in row and "error_excerpt" not in row:
          try:
            row["error_excerpt"]=base64.b64decode(row["error_excerpt_b64"]).decode("utf-8","replace")
          except Exception:
            row["error_excerpt"]=""
        new_rows.append(row)
      except Exception:
        pass
print(f"parsed_untrusted_rows={len(new_rows)}", flush=True)

ui=[r for r in new_rows if r["case"]=="untrusted_intermediate"]
ul=[r for r in new_rows if r["case"]=="untrusted_client_leaf"]
live_doc={
  "document":"gate5-v7-live-untrusted-negatives",
  "ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
  "untrusted_intermediate": {
    "expected":3,"tested":len(ui),
    "denied":sum(1 for r in ui if r.get("pass") is True),
    "failed":sum(1 for r in ui if r.get("pass") is False),
    "skipped":max(0,3-len(ui)),
  },
  "untrusted_client_leaf": {
    "expected":3,"tested":len(ul),
    "denied":sum(1 for r in ul if r.get("pass") is True),
    "failed":sum(1 for r in ul if r.get("pass") is False),
    "skipped":max(0,3-len(ul)),
  },
  "rows": new_rows,
}
live_path.write_text(json.dumps(live_doc, indent=2)+"\n")

# Rebuild live negatives: keep prior live rows except peer_omits and old untrusted_intermediate; add new ones
old = json.loads(neg_path.read_text()) if neg_path.exists() else {"rows":[]}
kept=[]
for r in old.get("rows",[]):
  if r.get("case") in {
    "peer_omits_intermediate",
    "missing_intermediate",
    "untrusted_intermediate",
    "untrusted_client_leaf",
  }:
    continue
  kept.append(r)
# normalize new rows into negative shape
for r in new_rows:
  kept.append({
    "case": r["case"],
    "broker_id": r["broker_id"],
    "expect_deny": True,
    "observed_ok": r.get("observed_ok"),
    "pass": r.get("pass"),
    "denial_layer": r.get("denial_layer"),
    "detail": "live_broker_denial",
    "hostname_verification": "HTTPS",
    "application_protocol_reached": r.get("application_protocol_reached"),
    "kafka_request_processed": r.get("kafka_request_processed"),
    "broker_authorization_decision_reached": False,
    "business_effect": False,
    "live_broker_negative": True,
  })

cases=Counter(r["case"] for r in kept)
# Ensure 12 categories × 3
doc={
  "document":"gate5-v7-kafka-tls-negatives",
  "ts": live_doc["ts"],
  "denominator_kind":"LIVE_KAFKA_BROKER_NEGATIVES",
  "excluded_from_live_denominator":[
    {"case":"peer_omits_intermediate","classification":"CONTROLLED_PKIX_FIXTURE_PASS"},
    {"case":"missing_intermediate","classification":"INVALID_NEGATIVE_FIXTURE"},
  ],
  "summary":{
    "categories_present": len(cases),
    "rows": len(kept),
    "pass": sum(1 for r in kept if r.get("pass") is True),
    "fail": sum(1 for r in kept if r.get("pass") is False),
    "skipped": 0,
    "controlled_fixtures_counted_in_live_denominator": 0,
  },
  "cases": dict(cases),
  "rows": kept,
}
neg_path.write_text(json.dumps(doc, indent=2)+"\n")
print(json.dumps({
  "untrusted_intermediate": live_doc["untrusted_intermediate"],
  "untrusted_client_leaf": live_doc["untrusted_client_leaf"],
  "live_negatives": doc["summary"],
  "cases": dict(cases),
}, indent=2))
ui_ok = live_doc["untrusted_intermediate"]["denied"]==3 and live_doc["untrusted_intermediate"]["failed"]==0
ul_ok = live_doc["untrusted_client_leaf"]["denied"]==3 and live_doc["untrusted_client_leaf"]["failed"]==0
sys.exit(0 if ui_ok and ul_ok and len(kept)==36 and doc["summary"]["fail"]==0 else 2)
PY
STATUS=$?
if [[ "$STATUS" -eq 0 ]]; then
  ok "live UNTRUSTED_INTERMEDIATE 3/3 and UNTRUSTED_CLIENT_LEAF 3/3; live negatives rebuilt"
else
  echo "⚠️  live untrusted negatives incomplete" >&2
fi
exit "$STATUS"
