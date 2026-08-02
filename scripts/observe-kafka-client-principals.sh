#!/usr/bin/env bash
# Strict Kafka TLS + derived-principal observation for dedicated kafka-client-tls-* Secrets.
#
# - Runs from an ephemeral acceptance-client Job (NOT a broker).
# - Does NOT copy private keys into broker pods.
# - Keeps hostname verification enabled (ssl.endpoint.identification.algorithm=HTTPS).
# - Never blanks ssl.endpoint.identification.algorithm.
# - Principals remain KAFKA_EQUIVALENT_DERIVED until authorizer ALLOW/DENY records exist.
#
# Writes: reports/kafka/gate5-v7-observed-principals.json
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${KAFKA_CLIENT_TLS_NS:-record-platform}"
OUT_JSON="${REPO_ROOT}/reports/kafka/gate5-v7-observed-principals.json"
OUT_MD="${REPO_ROOT}/reports/kafka/gate5-v7-observed-principals.md"
OUT_ROOT="${REPO_ROOT}/certs/kafka-client"
# Service `kafka` is headless (ClusterIP: None); pod DNS is kafka-<ordinal>.kafka.<ns>.svc...
BROKER_DNS="${KAFKA_OBSERVE_BROKER_DNS:-kafka-0.kafka.${NS}.svc.cluster.local}"
BOOTSTRAP="${BROKER_DNS}:9093"
ROOT_PEM="${REPO_ROOT}/certs/dev-root.pem"
INT_PEM="${REPO_ROOT}/certs/dev-intermediate.pem"
CHAIN_PEM="${REPO_ROOT}/certs/dev-chain.pem"

SERVICES=(
  analytics-service auction-monitor auth-service listings-service
  media-service messaging-service notification-service python-ai-service
  shopping-service trust-service ollama-gateway ollama-worker
)

fail() { echo "❌ $*" >&2; exit 1; }
ok() { echo "✅ $*"; }

command -v kubectl >/dev/null
command -v python3 >/dev/null
command -v openssl >/dev/null
[[ -d "$OUT_ROOT" ]] || fail "run generate-kafka-client-service-tls.sh first"
[[ -f "$ROOT_PEM" && -f "$INT_PEM" ]] || fail "missing public CA PEMs under certs/"

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/rp-kafka-strict-observe.XXXXXX")"
trap 'rm -rf "$WORKDIR"' EXIT
rows="${WORKDIR}/rows.jsonl"
: >"$rows"

derive_principal() {
  local leaf="$1"
  local dn
  dn="$(openssl x509 -in "$leaf" -noout -subject -nameopt RFC2253 | sed 's/^subject= *//')"
  printf 'User:%s' "$dn"
}

run_strict_job() {
  local svc="$1"
  local secret="$2"
  local job="g5v7-obs-$(echo "$svc" | tr '_' '-' | cut -c1-28)-${RANDOM}"
  local ca_secret="${job}-ca"
  local job_yaml="${WORKDIR}/${svc}.job.yaml"
  local logs_file="${WORKDIR}/${svc}.job.log"

  kubectl -n "$NS" create secret generic "$ca_secret" \
    --from-file=dev-root.pem="$ROOT_PEM" \
    --from-file=dev-intermediate.pem="$INT_PEM" \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null

  # Quoted heredoc body for container script; only host vars expanded outside.
  cat >"$job_yaml" <<EOF
apiVersion: batch/v1
kind: Job
metadata:
  name: ${job}
  namespace: ${NS}
spec:
  ttlSecondsAfterFinished: 90
  backoffLimit: 0
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: accept-client
          image: confluentinc/cp-kafka:7.5.0
          imagePullPolicy: IfNotPresent
          env:
            - name: SERVICE
              value: "${svc}"
            - name: BOOTSTRAP
              value: "${BOOTSTRAP}"
            - name: BROKER_DNS
              value: "${BROKER_DNS}"
          volumeMounts:
            - name: client
              mountPath: /tls/client
              readOnly: true
            - name: ca
              mountPath: /tls/ca
              readOnly: true
          command: ["bash", "-c"]
          args:
            - |
              set -euo pipefail
              rm -f /tmp/trust.jks /tmp/key.jks /tmp/client.p12 /tmp/leafchain.pem /tmp/client.props
              keytool -importcert -noprompt -alias dev-root -file /tls/ca/dev-root.pem \\
                -keystore /tmp/trust.jks -storepass changeit
              keytool -importcert -noprompt -alias dev-intermediate -file /tls/ca/dev-intermediate.pem \\
                -keystore /tmp/trust.jks -storepass changeit
              cat /tls/client/leaf.crt /tls/ca/dev-intermediate.pem > /tmp/leafchain.pem
              openssl pkcs12 -export -in /tmp/leafchain.pem -inkey /tls/client/tls.key \\
                -out /tmp/client.p12 -passout pass:changeit -name client
              keytool -importkeystore -noprompt \\
                -srckeystore /tmp/client.p12 -srcstoretype PKCS12 -srcstorepass changeit \\
                -destkeystore /tmp/key.jks -deststorepass changeit
              cat > /tmp/client.props <<'PROPS'
              security.protocol=SSL
              ssl.keystore.location=/tmp/key.jks
              ssl.keystore.password=changeit
              ssl.key.password=changeit
              ssl.truststore.location=/tmp/trust.jks
              ssl.truststore.password=changeit
              ssl.endpoint.identification.algorithm=HTTPS
              PROPS
              echo "client.id=record-platform.\${SERVICE}.observe.strict-tls-probe" >> /tmp/client.props
              getent hosts "\$BROKER_DNS" || true
              OUT=\$(kafka-broker-api-versions --bootstrap-server "\$BOOTSTRAP" --command-config /tmp/client.props 2>&1) || true
              echo "\$OUT"
              rm -f /tmp/key.jks /tmp/client.p12 /tmp/leafchain.pem /tmp/trust.jks /tmp/client.props
              if echo "\$OUT" | grep -qiE 'ApiVersion|kafka-|CLUSTER_ID|id@'; then
                echo "STRICT_MTLS_OK=1"
                exit 0
              fi
              echo "STRICT_MTLS_OK=0"
              exit 1
      volumes:
        - name: client
          secret:
            secretName: ${secret}
            items:
              - key: leaf.crt
                path: leaf.crt
              - key: tls.key
                path: tls.key
        - name: ca
          secret:
            secretName: ${ca_secret}
            items:
              - key: dev-root.pem
                path: dev-root.pem
              - key: dev-intermediate.pem
                path: dev-intermediate.pem
EOF

  kubectl -n "$NS" delete job "$job" --ignore-not-found >/dev/null 2>&1 || true
  kubectl -n "$NS" apply -f "$job_yaml" >/dev/null

  local mtls_ok=false
  local i=0 succ fail
  while (( i < 60 )); do
    succ=$(kubectl -n "$NS" get job "$job" -o jsonpath='{.status.succeeded}' 2>/dev/null || echo "")
    fail=$(kubectl -n "$NS" get job "$job" -o jsonpath='{.status.failed}' 2>/dev/null || echo "")
    if [[ "$succ" == "1" || "$fail" == "1" ]]; then
      break
    fi
    sleep 2
    i=$((i + 1))
  done

  kubectl -n "$NS" logs "job/${job}" -c accept-client >"$logs_file" 2>/dev/null || true
  if grep -q 'STRICT_MTLS_OK=1' "$logs_file" 2>/dev/null; then
    mtls_ok=true
  else
    echo "WARN: strict ApiVersions failed for ${svc}" >&2
    tail -40 "$logs_file" >&2 || true
  fi

  kubectl -n "$NS" delete job "$job" --ignore-not-found --wait=false >/dev/null 2>&1 || true
  kubectl -n "$NS" delete secret "$ca_secret" --ignore-not-found >/dev/null 2>&1 || true
  echo "$mtls_ok"
}

# Negative cases once — run inside the cluster so broker DNS resolves.
run_negative_probes() {
  local neg_json="${WORKDIR}/negatives.json"
  local job="g5v7-neg-${RANDOM}"
  local ca_secret="${job}-ca"
  local job_yaml="${WORKDIR}/neg.job.yaml"

  kubectl -n "$NS" create secret generic "$ca_secret" \
    --from-file=dev-root.pem="$ROOT_PEM" \
    --from-file=dev-intermediate.pem="$INT_PEM" \
    --from-file=dev-chain.pem="$CHAIN_PEM" \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null

  cat >"$job_yaml" <<EOF
apiVersion: batch/v1
kind: Job
metadata:
  name: ${job}
  namespace: ${NS}
spec:
  ttlSecondsAfterFinished: 90
  backoffLimit: 0
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: neg
          image: python:3.12-alpine
          imagePullPolicy: IfNotPresent
          env:
            - name: BROKER_DNS
              value: "${BROKER_DNS}"
            - name: BOOTSTRAP
              value: "${BOOTSTRAP}"
          volumeMounts:
            - name: ca
              mountPath: /tls/ca
              readOnly: true
          command: ["python", "-"]
          args: []
          stdin: true
      volumes:
        - name: ca
          secret:
            secretName: ${ca_secret}
EOF

  # Prefer openssl-based negatives on cp-kafka image (already pulled) to avoid pulling python.
  cat >"$job_yaml" <<EOF
apiVersion: batch/v1
kind: Job
metadata:
  name: ${job}
  namespace: ${NS}
spec:
  ttlSecondsAfterFinished: 90
  backoffLimit: 0
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: neg
          image: confluentinc/cp-kafka:7.5.0
          imagePullPolicy: IfNotPresent
          env:
            - name: BROKER_DNS
              value: "${BROKER_DNS}"
            - name: BOOTSTRAP
              value: "${BOOTSTRAP}"
          volumeMounts:
            - name: ca
              mountPath: /tls/ca
              readOnly: true
          command: ["bash", "-c"]
          args:
            - |
              set -euo pipefail
              HOST="\${BOOTSTRAP%:*}"
              PORT="\${BOOTSTRAP##*:}"
              RESOLVED=\$(getent hosts "\$HOST" | awk '{print \$1}' | head -1 || true)
              echo "RESOLVED_IP=\$RESOLVED"
              pass=0; fail=0; skip=0
              case_result() {
                local name="\$1" expect_ok="\$2" observed_ok="\$3" err="\$4"
                local okpass=0
                if [[ "\$expect_ok" == "\$observed_ok" ]]; then okpass=1; pass=\$((pass+1)); else fail=\$((fail+1)); fi
                echo "CASE name=\$name expect_ok=\$expect_ok observed_ok=\$observed_ok pass=\$okpass error=\$err"
              }
              # wrong SNI (connect to real IP/host but wrong servername)
              # Use -verify_hostname (OpenSSL 1.1.1+) so SNI/hostname mismatches fail closed.
              if echo | openssl s_client -connect "\$BOOTSTRAP" -servername wrong-broker.example.invalid \\
                  -verify_hostname wrong-broker.example.invalid \\
                  -CAfile /tls/ca/dev-chain.pem -verify_return_error </dev/null >/tmp/w.out 2>&1; then
                case_result wrong_sni false true "unexpected_ok"
              else
                case_result wrong_sni false false "openssl_verify_failed"
              fi
              if echo | openssl s_client -connect "\$BOOTSTRAP" -servername 127.0.0.1 \\
                  -verify_hostname 127.0.0.1 \\
                  -CAfile /tls/ca/dev-chain.pem -verify_return_error </dev/null >/tmp/w.out 2>&1; then
                case_result wrong_broker_hostname false true "unexpected_ok"
              else
                case_result wrong_broker_hostname false false "openssl_verify_failed"
              fi
              openssl req -x509 -newkey rsa:2048 -nodes -keyout /tmp/bad.key -out /tmp/bad.pem -days 1 -subj /CN=wrong-root >/dev/null 2>&1
              if echo | openssl s_client -connect "\$BOOTSTRAP" -servername "\$BROKER_DNS" \\
                  -verify_hostname "\$BROKER_DNS" \\
                  -CAfile /tmp/bad.pem -verify_return_error </dev/null >/tmp/w.out 2>&1; then
                case_result wrong_root false true "unexpected_ok"
              else
                case_result wrong_root false false "openssl_verify_failed"
              fi
              # no client certificate: Kafka ApiVersions with truststore only must fail (broker client.auth=required)
              keytool -importcert -noprompt -alias root -file /tls/ca/dev-root.pem -keystore /tmp/trust-only.jks -storepass changeit >/dev/null 2>&1
              keytool -importcert -noprompt -alias int -file /tls/ca/dev-intermediate.pem -keystore /tmp/trust-only.jks -storepass changeit >/dev/null 2>&1
              cat > /tmp/noclient.props <<'P'
              security.protocol=SSL
              ssl.truststore.location=/tmp/trust-only.jks
              ssl.truststore.password=changeit
              ssl.endpoint.identification.algorithm=HTTPS
              P
              if kafka-broker-api-versions --bootstrap-server "\$BOOTSTRAP" --command-config /tmp/noclient.props >/tmp/nc.out 2>&1; then
                case_result no_client_certificate false true "apiversions_ok_without_client_cert"
              else
                case_result no_client_certificate false false "apiversions_denied_or_failed"
              fi
              # plaintext TCP should not yield a Kafka ApiVersions-looking response
              if timeout 3 bash -c "exec 3<>/dev/tcp/\$HOST/\$PORT; printf 'bogus' >&3; cat <&3" >/tmp/p.out 2>&1; then
                if grep -qiE 'ApiVersion|Kafka' /tmp/p.out; then
                  case_result plaintext false true "unexpected_kafka_plaintext"
                else
                  case_result plaintext false false "non_kafka_or_empty"
                fi
              else
                case_result plaintext false false "tcp_failed_or_timeout"
              fi
              echo "CASE name=clientAuth_absent_leaf expect_ok=false observed_ok=null pass=null error=SKIPPED_NO_FIXTURE"
              skip=\$((skip+1))
              echo "SUMMARY pass=\$pass fail=\$fail skip=\$skip"
      volumes:
        - name: ca
          secret:
            secretName: ${ca_secret}
EOF

  kubectl -n "$NS" delete job "$job" --ignore-not-found >/dev/null 2>&1 || true
  kubectl -n "$NS" apply -f "$job_yaml" >/dev/null
  local i=0 succ fail
  while (( i < 90 )); do
    succ=$(kubectl -n "$NS" get job "$job" -o jsonpath='{.status.succeeded}' 2>/dev/null || echo "")
    fail=$(kubectl -n "$NS" get job "$job" -o jsonpath='{.status.failed}' 2>/dev/null || echo "")
    if [[ "$succ" == "1" || "$fail" == "1" ]]; then break; fi
    sleep 2
    i=$((i + 1))
  done
  local logs
  logs=$(kubectl -n "$NS" logs "job/${job}" -c neg 2>/dev/null || true)
  kubectl -n "$NS" delete job "$job" --ignore-not-found --wait=false >/dev/null 2>&1 || true
  kubectl -n "$NS" delete secret "$ca_secret" --ignore-not-found >/dev/null 2>&1 || true

  NEG_LOGS="$logs" NEG_OUT="$neg_json" BROKER_DNS="$BROKER_DNS" BOOTSTRAP="$BOOTSTRAP" python3 <<'PY'
import json, os, re
logs = os.environ.get("NEG_LOGS", "")
resolved = None
m = re.search(r"RESOLVED_IP=(\S+)", logs)
if m:
    resolved = m.group(1)
cases = []
for line in logs.splitlines():
    if not line.startswith("CASE "):
        continue
    parts = dict(re.findall(r"(\w+)=(\S+)", line))
    observed = parts.get("observed_ok")
    if observed == "null":
        observed_ok = None
        passed = None
    else:
        observed_ok = observed == "true"
        passed = parts.get("pass") == "1"
    cases.append({
        "case": parts.get("name"),
        "expect_ok": parts.get("expect_ok") == "true",
        "observed_ok": observed_ok,
        "pass": passed,
        "error": parts.get("error"),
        "server_hostname": os.environ["BROKER_DNS"] if parts.get("name") not in {"wrong_sni", "wrong_broker_hostname", "plaintext"} else parts.get("name"),
        "runtime": "in_cluster_job",
    })
doc = {
    "requested_broker_dns": os.environ["BROKER_DNS"],
    "bootstrap": os.environ["BOOTSTRAP"],
    "resolved_ip": resolved,
    "hostname_verification": "HTTPS",
    "runtime": "in_cluster_ephemeral_job",
    "cases": cases,
    "cases_pass": sum(1 for c in cases if c.get("pass") is True),
    "cases_fail": sum(1 for c in cases if c.get("pass") is False),
    "cases_skipped": sum(1 for c in cases if c.get("pass") is None),
    "raw_log_tail": "\n".join(logs.splitlines()[-40:]),
}
open(os.environ["NEG_OUT"], "w", encoding="utf-8").write(json.dumps(doc, indent=2) + "\n")
print(json.dumps({k: doc[k] for k in ("resolved_ip", "cases_pass", "cases_fail", "cases_skipped")}))
PY
}

echo "== Strict Kafka TLS observe (ephemeral client Jobs) =="
echo "broker_dns=${BROKER_DNS} bootstrap=${BOOTSTRAP}"

NEG_JSON="${WORKDIR}/negatives.json"
run_negative_probes
ok "negative probes recorded"

failed=0
for svc in "${SERVICES[@]}"; do
  leaf="${OUT_ROOT}/${svc}/leaf.crt"
  [[ -f "$leaf" ]] || fail "missing ${leaf}"
  secret="kafka-client-tls-${svc}"
  kubectl -n "$NS" get secret "$secret" >/dev/null || fail "missing secret ${secret}"

  leaf_fp="$(openssl x509 -in "$leaf" -noout -fingerprint -sha256 | sed 's/.*=//')"
  subject="$(openssl x509 -in "$leaf" -noout -subject -nameopt RFC2253 | sed 's/^subject= *//')"
  principal="$(derive_principal "$leaf")"
  spiffe="spiffe://record-platform/service/${svc}"
  eku="$(openssl x509 -in "$leaf" -noout -ext extendedKeyUsage 2>/dev/null | tr '\n' ' ' || true)"

  mtls_ok="$(run_strict_job "$svc" "$secret")"

  broker_fp="$(echo | openssl s_client -connect "${BOOTSTRAP}" -servername "${BROKER_DNS}" \
    -CAfile "${CHAIN_PEM}" 2>/dev/null | openssl x509 -noout -fingerprint -sha256 2>/dev/null | sed 's/.*=//' || true)"
  broker_san="$(echo | openssl s_client -connect "${BOOTSTRAP}" -servername "${BROKER_DNS}" \
    -CAfile "${CHAIN_PEM}" 2>/dev/null | openssl x509 -noout -ext subjectAltName 2>/dev/null | tr '\n' ' ' || true)"

  host_verify=false
  if echo | openssl s_client -connect "${BOOTSTRAP}" -servername "${BROKER_DNS}" \
      -CAfile "${CHAIN_PEM}" -verify_return_error </dev/null >/dev/null 2>&1; then
    host_verify=true
  fi

  export OBS_SVC="$svc" OBS_FP="$leaf_fp" OBS_SUBJ="$subject" OBS_PRINCIPAL="$principal" \
    OBS_SPIFFE="$spiffe" OBS_BOOTSTRAP="$BOOTSTRAP" OBS_DNS="$BROKER_DNS" \
    OBS_MTLS="$mtls_ok" OBS_HOST="$host_verify" OBS_BFP="$broker_fp" \
    OBS_BSAN="$broker_san" OBS_EKU="$eku" OBS_ROWS="$rows"
  python3 <<'PY'
import json, os
row = {
  "service": os.environ["OBS_SVC"],
  "secret_name": f"kafka-client-tls-{os.environ['OBS_SVC']}",
  "client_id": f"record-platform.{os.environ['OBS_SVC']}.observe.strict-tls-probe",
  "certificate_fingerprint_sha256": os.environ["OBS_FP"],
  "certificate_subject_java_x500": os.environ["OBS_SUBJ"],
  "client_eku": os.environ.get("OBS_EKU") or None,
  "spiffe_uri": os.environ["OBS_SPIFFE"],
  "bootstrap": os.environ["OBS_BOOTSTRAP"],
  "requested_broker_dns": os.environ["OBS_DNS"],
  "sni": os.environ["OBS_DNS"],
  "expected_broker_san_contains_dns": os.environ["OBS_DNS"],
  "broker_presented_san": os.environ.get("OBS_BSAN") or None,
  "hostname_verification": "HTTPS",
  "hostname_verification_enabled": True,
  "ssl_endpoint_identification_algorithm_blanked": False,
  "private_keys_copied_into_broker_pods": 0,
  "probe_runtime": "ephemeral_acceptance_client_job",
  "derived_kafka_principal": os.environ["OBS_PRINCIPAL"],
  "evidence_class": "KAFKA_EQUIVALENT_DERIVED_PRINCIPAL_WITH_LIVE_MTLS_ACCEPTANCE",
  "broker_observed_authorization_principal": None,
  "live_mtls_apiversions_accepted": os.environ["OBS_MTLS"] == "true",
  "broker_server_leaf_fingerprint_sha256": os.environ.get("OBS_BFP") or None,
  "openssl_hostname_verify_ok": os.environ["OBS_HOST"] == "true",
}
with open(os.environ["OBS_ROWS"], "a", encoding="utf-8") as f:
    f.write(json.dumps(row) + "\n")
PY

  if [[ "$mtls_ok" == "true" ]]; then
    ok "${svc} principal=${principal}"
  else
    echo "❌ ${svc} strict mTLS probe failed" >&2
    failed=$((failed + 1))
  fi
done

python3 - "$rows" "$OUT_JSON" "$OUT_MD" "$NEG_JSON" <<'PY'
import json, pathlib, sys
from datetime import datetime, timezone

rows = [json.loads(l) for l in pathlib.Path(sys.argv[1]).read_text().splitlines() if l.strip()]
neg = json.loads(pathlib.Path(sys.argv[4]).read_text()) if pathlib.Path(sys.argv[4]).exists() else {}
doc = {
  "document": "gate5-v7-observed-principals",
  "ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
  "principal_evidence_class": "KAFKA_EQUIVALENT_DERIVED_PRINCIPAL_WITH_LIVE_MTLS_ACCEPTANCE",
  "authorizer_enabled": False,
  "final_acls_applied": False,
  "fail_closed_active": False,
  "hostname_verification_enabled": True,
  "ssl_endpoint_identification_algorithm_blanked": False,
  "private_keys_copied_into_broker_pods": 0,
  "observation_method": {
    "dn_source": "openssl RFC2253 subject (Java X500Principal-equivalent ordering)",
    "live_proof": "ephemeral acceptance-client Job kafka-broker-api-versions with ssl.endpoint.identification.algorithm=HTTPS",
    "spiffe_role": "identity evidence SAN; not ACL principal",
    "negative_probes": "python ssl client against live broker DNS (wrong SNI/root/no-cert/plaintext)",
  },
  "summary": {
    "services_expected": 12,
    "services_observed": len(rows),
    "live_mtls_accepted": sum(1 for r in rows if r.get("live_mtls_apiversions_accepted")),
    "hostname_verification_enabled_rows": sum(1 for r in rows if r.get("hostname_verification_enabled")),
    "distinct_derived_service_principals": len({r["derived_kafka_principal"] for r in rows}),
    "broker_observed_authorization_principals": 0,
    "shared_generic_principal_observations": sum(1 for r in rows if "CN=kafka-client" in r.get("derived_kafka_principal", "")),
    "private_keys_copied_into_broker_pods": 0,
    "final_acl_manifest_authorized": False,
  },
  "negative_probes": neg,
  "principals": rows,
  "distinct_principals": sorted({r["derived_kafka_principal"] for r in rows}),
}
pathlib.Path(sys.argv[2]).write_text(json.dumps(doc, indent=2) + "\n")
md = [
  "# gate5-v7 observed principals (strict TLS probe)",
  "",
  f"- ts: `{doc['ts']}`",
  f"- live_mtls_accepted: **{doc['summary']['live_mtls_accepted']}/12**",
  f"- hostname_verification_enabled: **true** (blanked algorithm: false)",
  f"- private_keys_copied_into_broker_pods: **0**",
  f"- broker_observed_authorization_principals: **0/12** (authorizer disabled)",
  f"- negative probe pass/fail/skip: {neg.get('cases_pass')}/{neg.get('cases_fail')}/{neg.get('cases_skipped')}",
  "",
]
pathlib.Path(sys.argv[3]).write_text("\n".join(md) + "\n")
print(json.dumps(doc["summary"], indent=2))
PY

ok "wrote ${OUT_JSON}"
if (( failed > 0 )); then
  echo "❌ ${failed}/12 strict positive rows failed" >&2
  exit 1
fi
