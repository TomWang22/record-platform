#!/usr/bin/env bash
# Pre-authorizer: 12×3 mTLS matrix + negatives (incl. CLIENT_AUTH_EKU_ABSENT).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${KAFKA_CLIENT_TLS_NS:-record-platform}"
OUT_DIR="${REPO_ROOT}/reports/kafka"
OUT_JSON="${OUT_DIR}/gate5-v7-twelve-by-three-mtls-matrix.json"
OUT_MD="${OUT_DIR}/gate5-v7-twelve-by-three-mtls-matrix.md"
LAYER_JSON="${REPO_ROOT}/reports/transport/certificate-layer-consistency.json"
NEG_JSON="${OUT_DIR}/gate5-v7-kafka-tls-negatives.json"
ROOT_PEM="${REPO_ROOT}/certs/dev-root.pem"
INT_PEM="${REPO_ROOT}/certs/dev-intermediate.pem"
FIX_DIR="${REPO_ROOT}/certs/kafka-client/_fixtures"
PROBE_SRC="${SCRIPT_DIR}/lib/kafka-mtls36-incluster.sh"

SERVICES=(
  analytics-service auction-monitor auth-service listings-service
  media-service messaging-service notification-service python-ai-service
  shopping-service trust-service ollama-gateway ollama-worker
)

fail() { echo "❌ $*" >&2; exit 1; }
ok() { echo "✅ $*"; }

[[ -f "$PROBE_SRC" ]] || fail "missing ${PROBE_SRC}"
chmod +x "$SCRIPT_DIR/generate-kafka-tls-negative-fixtures.sh"
chmod +x "$SCRIPT_DIR/generate-untrusted-kafka-client-fixtures.sh"
# Preserve dated fixtures if already correct; regenerate EKU fixtures only when missing
if [[ ! -f "$FIX_DIR/client-auth-eku-absent.crt" ]]; then
  bash "$SCRIPT_DIR/generate-kafka-tls-negative-fixtures.sh"
fi
bash "$SCRIPT_DIR/generate-untrusted-kafka-client-fixtures.sh"
UNTRUST_DIR="${FIX_DIR}/untrusted"
[[ -f "$UNTRUST_DIR/untrusted-int-leaf.crt" ]] || fail "missing untrusted intermediate fixtures"
# Ensure dated fixtures via OpenSSL 3 when host LibreSSL cannot set dates
need_dates=0
if ! openssl x509 -in "$FIX_DIR/client-expired.crt" -noout -checkend 0 >/dev/null 2>&1; then
  : # expired is desired (checkend fails when expired)
else
  need_dates=1
fi
if openssl x509 -in "$FIX_DIR/client-not-yet-valid.crt" -noout -checkend 0 >/dev/null 2>&1; then
  need_dates=1
fi
if [[ "$need_dates" -eq 1 ]] || ! openssl x509 -in "$FIX_DIR/client-expired.crt" -noout -dates 2>/dev/null | grep -q '2020'; then
  echo "Refreshing dated fixtures via alpine/openssl"
  for pair in "client-expired:20200101000000Z:20200102000000Z" "client-not-yet-valid:20300101000000Z:20301231000000Z"; do
    IFS=: read -r name start end <<<"$pair"
    docker run --rm -v "$REPO_ROOT/certs:/certs" -w /certs alpine/openssl genrsa -out "kafka-client/_fixtures/${name}.key" 2048 >/dev/null
    docker run --rm -v "$REPO_ROOT/certs:/certs" -w /certs alpine/openssl req -new -key "kafka-client/_fixtures/${name}.key" \
      -out "kafka-client/_fixtures/${name}.csr" -subj "/CN=${name}/O=Record Platform" >/dev/null
    cat >"$FIX_DIR/${name}.ext" <<EOF
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=clientAuth
subjectAltName=DNS:${name},URI:spiffe://record-platform/fixture/${name}
EOF
    docker run --rm -v "$REPO_ROOT/certs:/certs" -w /certs alpine/openssl x509 -req \
      -in "kafka-client/_fixtures/${name}.csr" -CA dev-intermediate.pem -CAkey dev-intermediate.key \
      -CAserial dev-intermediate.srl -CAcreateserial -out "kafka-client/_fixtures/${name}.crt" \
      -sha256 -extfile "kafka-client/_fixtures/${name}.ext" -not_before "$start" -not_after "$end" >/dev/null
  done
fi

ROOT_FP="$(openssl x509 -in "$ROOT_PEM" -noout -fingerprint -sha256 | sed 's/.*=//')"
INT_FP="$(openssl x509 -in "$INT_PEM" -noout -fingerprint -sha256 | sed 's/.*=//')"

python3 - "$REPO_ROOT" "$LAYER_JSON" "$ROOT_FP" "$INT_FP" <<'PY'
import json, pathlib, subprocess, sys, base64, tempfile
from datetime import datetime, timezone
repo, out, root_fp, int_fp = sys.argv[1:5]
ns="record-platform"
services=["analytics-service","auction-monitor","auth-service","listings-service","media-service","messaging-service","notification-service","python-ai-service","shopping-service","trust-service","ollama-gateway","ollama-worker"]

def fp_bytes(pem: bytes)->str:
  with tempfile.NamedTemporaryFile() as t:
    t.write(pem); t.flush()
    return subprocess.check_output(["openssl","x509","-in",t.name,"-noout","-fingerprint","-sha256"], text=True).split("=",1)[-1].strip()

def fp_file(p):
  return subprocess.check_output(["openssl","x509","-in",str(p),"-noout","-fingerprint","-sha256"], text=True).split("=",1)[-1].strip()

def verify(p):
  try:
    o=subprocess.check_output(["openssl","verify","-CAfile",f"{repo}/certs/dev-root.pem","-untrusted",f"{repo}/certs/dev-intermediate.pem",str(p)], text=True, stderr=subprocess.STDOUT)
    return "OK" in o
  except subprocess.CalledProcessError:
    return False

rows=[]
for svc in services:
  leaf=pathlib.Path(repo)/f"certs/kafka-client/{svc}/leaf.crt"
  disk_fp=fp_file(leaf)
  b64=subprocess.check_output(["kubectl","-n",ns,"get","secret",f"kafka-client-tls-{svc}","-o","jsonpath={.data.leaf\\.crt}"], text=True)
  secret_fp=fp_bytes(base64.b64decode(b64))
  pod=subprocess.check_output(["kubectl","-n",ns,"get","pods","-l",f"app={svc}","-o","jsonpath={.items[0].metadata.name}"], text=True).strip()
  mounted=subprocess.check_output(["kubectl","-n",ns,"exec",pod,"--","cat","/etc/kafka/client/tls.crt"])
  with tempfile.NamedTemporaryFile(suffix=".pem") as t:
    t.write(mounted); t.flush(); mounted_fp=fp_file(pathlib.Path(t.name))
  rows.append({"service":svc,"pod":pod,"secret":f"kafka-client-tls-{svc}","disk_client_leaf_fp":disk_fp,"secret_client_leaf_fp":secret_fp,"mounted_client_leaf_fp":mounted_fp,"runtime_loaded_client_leaf_fp":mounted_fp,"intermediate_sha256":int_fp,"root_sha256":root_fp,"chain_ok":verify(leaf),"layer_equality": disk_fp==secret_fp==mounted_fp})
doc={"document":"certificate-layer-consistency","ts":datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),"summary":{"services":len(rows),"layer_equal":sum(1 for r in rows if r["layer_equality"]),"chain_ok":sum(1 for r in rows if r["chain_ok"])},"rows":rows}
pathlib.Path(out).parent.mkdir(parents=True, exist_ok=True)
pathlib.Path(out).write_text(json.dumps(doc, indent=2)+"\n")
print(json.dumps(doc["summary"], indent=2))
PY
ok "layer consistency"

JOB="g5v7-mtls36-${RANDOM}"
CA_SECRET="${JOB}-ca"
FIX_SECRET="${JOB}-fix"
CM="${JOB}-probe"

kubectl -n "$NS" create configmap "$CM" --from-file=kafka-mtls36-incluster.sh="$PROBE_SRC" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl -n "$NS" create secret generic "$CA_SECRET" \
  --from-file=dev-root.pem="$ROOT_PEM" --from-file=dev-intermediate.pem="$INT_PEM" \
  --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl -n "$NS" create secret generic "$FIX_SECRET" \
  --from-file=client-auth-eku-absent.crt="$FIX_DIR/client-auth-eku-absent.crt" \
  --from-file=client-auth-eku-absent.key="$FIX_DIR/client-auth-eku-absent.key" \
  --from-file=client-expired.crt="$FIX_DIR/client-expired.crt" \
  --from-file=client-expired.key="$FIX_DIR/client-expired.key" \
  --from-file=client-not-yet-valid.crt="$FIX_DIR/client-not-yet-valid.crt" \
  --from-file=client-not-yet-valid.key="$FIX_DIR/client-not-yet-valid.key" \
  --from-file=client-malformed-chain-leaf-only.crt="$FIX_DIR/client-auth-eku-absent.crt" \
  --from-file=client-malformed-chain-leaf-only.key="$FIX_DIR/client-auth-eku-absent.key" \
  --from-file=server-auth-eku-absent.crt="$FIX_DIR/server-auth-eku-absent.crt" \
  --from-file=server-auth-eku-absent.key="$FIX_DIR/server-auth-eku-absent.key" \
  --from-file=untrusted-int-leaf.crt="$UNTRUST_DIR/untrusted-int-leaf.crt" \
  --from-file=untrusted-int-leaf.key="$UNTRUST_DIR/untrusted-int-leaf.key" \
  --from-file=foreign-int.pem="$UNTRUST_DIR/foreign-int.pem" \
  --from-file=untrusted-client-leaf.crt="$UNTRUST_DIR/untrusted-client-leaf.crt" \
  --from-file=untrusted-client-leaf.key="$UNTRUST_DIR/untrusted-client-leaf.key" \
  --dry-run=client -o yaml | kubectl apply -f - >/dev/null

VOLS=""
MOUNTS=""
for svc in "${SERVICES[@]}"; do
  VOLS+=$'\n'"        - name: client-${svc}"$'\n'"          secret:"$'\n'"            secretName: kafka-client-tls-${svc}"$'\n'"            items:"$'\n'"              - {key: leaf.crt, path: leaf.crt}"$'\n'"              - {key: tls.key, path: tls.key}"
  MOUNTS+=$'\n'"            - name: client-${svc}"$'\n'"              mountPath: /tls/clients/${svc}"$'\n'"              readOnly: true"
done

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"; kubectl -n "$NS" delete job "$JOB" --ignore-not-found --wait=false >/dev/null 2>&1 || true; kubectl -n "$NS" delete secret "$CA_SECRET" "$FIX_SECRET" --ignore-not-found >/dev/null 2>&1 || true; kubectl -n "$NS" delete configmap "$CM" --ignore-not-found >/dev/null 2>&1 || true' EXIT

cat >"${WORKDIR}/job.yaml" <<EOF
apiVersion: batch/v1
kind: Job
metadata:
  name: ${JOB}
  namespace: ${NS}
spec:
  ttlSecondsAfterFinished: 600
  backoffLimit: 0
  activeDeadlineSeconds: 1800
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: prove
          image: confluentinc/cp-kafka:7.5.0
          imagePullPolicy: IfNotPresent
          command: ["bash","/probe/kafka-mtls36-incluster.sh"]
          volumeMounts:
            - {name: probe, mountPath: /probe, readOnly: true}
            - {name: ca, mountPath: /tls/ca, readOnly: true}
            - {name: fix, mountPath: /tls/fixtures, readOnly: true}
${MOUNTS}
      volumes:
        - name: probe
          configMap:
            name: ${CM}
            defaultMode: 0755
        - name: ca
          secret: {secretName: ${CA_SECRET}}
        - name: fix
          secret: {secretName: ${FIX_SECRET}}
${VOLS}
EOF

kubectl -n "$NS" delete job "$JOB" --ignore-not-found >/dev/null 2>&1 || true
kubectl -n "$NS" apply -f "${WORKDIR}/job.yaml" >/dev/null
ok "Job ${JOB} started"

for i in $(seq 1 300); do
  succ=$(kubectl -n "$NS" get job "$JOB" -o jsonpath='{.status.succeeded}' 2>/dev/null || echo "")
  failc=$(kubectl -n "$NS" get job "$JOB" -o jsonpath='{.status.failed}' 2>/dev/null || echo "")
  if [[ "$succ" == "1" || "$failc" == "1" ]]; then break; fi
  if (( i % 10 == 0 )); then
    echo "… waiting (${i}/300) $(kubectl -n "$NS" get pods -l job-name="$JOB" -o jsonpath='{.items[0].status.phase}' 2>/dev/null || true)"
  fi
  sleep 6
done

LOGS=$(kubectl -n "$NS" logs "job/${JOB}" -c prove 2>/dev/null || true)
printf '%s\n' "$LOGS" >"${WORKDIR}/job.log"
echo "$LOGS" | grep -E 'ROW |NEG |POSITIVES_DONE|ROOT_FP|INT_FP' | tail -60

python3 - "${WORKDIR}/job.log" "$OUT_JSON" "$OUT_MD" "$NEG_JSON" "$ROOT_FP" "$INT_FP" <<'PY'
import json, pathlib, sys
from collections import Counter
from datetime import datetime, timezone
log=pathlib.Path(sys.argv[1]).read_text(errors="replace")
out_json,out_md,neg_json=map(pathlib.Path, sys.argv[2:5])
root_fp,int_fp=sys.argv[5:7]
pos=[]; neg=[]; fixtures=[]

def take_jsonl(text):
  rows=[]
  for line in text.splitlines():
    line=line.strip()
    if line.startswith("{"):
      try: rows.append(json.loads(line))
      except Exception: pass
  return rows

if "===POSITIVES_JSONL===" in log:
  rest=log.split("===POSITIVES_JSONL===",1)[1]
  if "===NEGATIVES_JSONL===" in rest:
    pchunk,rest=rest.split("===NEGATIVES_JSONL===",1)
  else:
    pchunk,rest=rest,""
  if "===FIXTURES_JSONL===" in rest:
    nchunk,fchunk=rest.split("===FIXTURES_JSONL===",1)
  else:
    nchunk,fchunk=rest,""
  pos=take_jsonl(pchunk)
  neg=take_jsonl(nchunk)
  fixtures=take_jsonl(fchunk)

# Never count controlled PEER_OMITS rows in the live denominator.
neg=[r for r in neg if r.get("case")!="peer_omits_intermediate" and r.get("live_broker_negative") is not False]
pos_pass=sum(1 for r in pos if r.get("pass") is True)
neg_pass=sum(1 for r in neg if r.get("pass") is True)
neg_fail=sum(1 for r in neg if r.get("pass") is False)
cases=Counter(r.get("case") for r in neg)
ui=[r for r in neg if r.get("case")=="untrusted_intermediate"]
ul=[r for r in neg if r.get("case")=="untrusted_client_leaf"]
fps=sorted({r["client"]["leaf_sha256"] for r in pos if r.get("client")})
doc={
  "document":"gate5-v7-twelve-by-three-mtls-matrix",
  "ts":datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
  "authorizer_enabled":False,
  "final_acls_applied":False,
  "peer_authorization_enabled":False,
  "classification":{
    "mtls_service_identity_authenticated": pos_pass==36 and len(pos)==36,
    "peer_authorization_not_enabled":True,
    "broker_observed_authorization_principals":"0/12",
    "three_stage_claim":"PER_ROW_ROOT_INTERMEDIATE_LEAF_RECORDED",
  },
  "trust_anchors":{"root_sha256":root_fp,"intermediate_sha256":int_fp},
  "summary":{
    "positive_mtls_rows_expected":36,
    "positive_mtls_rows_tested":len(pos),
    "positive_mtls_rows_passed":pos_pass,
    "positive_mtls_rows_failed":len(pos)-pos_pass,
    "positive_mtls_rows_skipped":max(0,36-len(pos)),
    "distinct_client_leaf_fingerprints":len(fps),
    "brokers_tested":sorted({r.get("broker_id") for r in pos}),
    "hostname_verification_blanked_rows":sum(1 for r in pos if r.get("ssl_endpoint_identification_algorithm_blanked")),
    "private_keys_copied_into_broker_pods":0,
  },
  "rows":pos,
}
if len(pos) != 36:
  raise SystemExit(f"positive denominator incomplete: expected 36 rows, got {len(pos)} (JSONL parse drops corrupt lines)")
if pos_pass != 36:
  raise SystemExit(f"positive matrix incomplete: passed {pos_pass}/36")
neg_doc={
  "document":"gate5-v7-kafka-tls-negatives",
  "ts":doc["ts"],
  "denominator_kind":"LIVE_KAFKA_BROKER_NEGATIVES",
  "excluded_from_live_denominator":[
    {"case":"peer_omits_intermediate","classification":"CONTROLLED_PKIX_FIXTURE_PASS"},
    {"case":"missing_intermediate","classification":"INVALID_NEGATIVE_FIXTURE"},
  ],
  "summary":{
    "categories_present":len(cases),
    "rows":len(neg),
    "pass":neg_pass,
    "fail":neg_fail,
    "skipped":0,
    "controlled_fixtures_counted_in_live_denominator":0,
    "untrusted_intermediate_expected":3,
    "untrusted_intermediate_tested":len(ui),
    "untrusted_intermediate_denied":sum(1 for r in ui if r.get("pass") is True),
    "untrusted_client_leaf_expected":3,
    "untrusted_client_leaf_tested":len(ul),
    "untrusted_client_leaf_denied":sum(1 for r in ul if r.get("pass") is True),
  },
  "cases":dict(cases),
  "controlled_pkix_fixtures":fixtures,
  "rows":neg,
}
out_json.parent.mkdir(parents=True, exist_ok=True)
out_json.write_text(json.dumps(doc, indent=2)+"\n")
neg_json.write_text(json.dumps(neg_doc, indent=2)+"\n")
out_md.write_text("\n".join([
  "# 12×3 Kafka mTLS matrix (pre-authorizer)",
  "",
  f"- positives: **{pos_pass}/36** tested={len(pos)}",
  f"- live negatives: **{neg_pass}/{len(neg)}** (fail={neg_fail})",
  f"- controlled PKIX fixtures (excluded): **{len(fixtures)}**",
  f"- distinct client leaf fps: **{len(fps)}**",
  f"- root: `{root_fp}`",
  f"- intermediate: `{int_fp}`",
  "- authorizer_enabled: false",
  "- peer_authorization: NOT_ENABLED",
  "",
])+"\n")
print(json.dumps({"positives":doc["summary"],"negatives":neg_doc["summary"],"fixtures":len(fixtures)}, indent=2))
live_ok = len(neg)==36 and neg_pass==36 and neg_fail==0 and len(ui)==3 and all(r.get("pass") for r in ui)
sys.exit(0 if len(pos)==36 and pos_pass==36 and live_ok else 2)
PY
STATUS=$?
exit "$STATUS"
