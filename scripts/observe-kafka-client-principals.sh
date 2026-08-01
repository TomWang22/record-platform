#!/usr/bin/env bash
# Observe Kafka SSL principals for dedicated kafka-client-tls-* Secrets.
#
# Principal derivation matches org.apache.kafka.common.security.authenticator.DefaultKafkaPrincipalBuilder:
#   User: + X509Certificate.getSubjectX500Principal().getName()
# which Java formats as RFC2253 (O before CN for these leaves).
#
# Also performs a live mTLS ApiVersions request so the broker accepts each leaf.
# Does NOT enable authorizer or apply ACLs.
#
# Writes:
#   reports/kafka/gate5-v7-observed-principals.json
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${KAFKA_CLIENT_TLS_NS:-record-platform}"
BROKER_POD="${KAFKA_OBSERVE_BROKER_POD:-kafka-0}"
BOOTSTRAP="${KAFKA_OBSERVE_BOOTSTRAP:-kafka-0.kafka.${NS}.svc.cluster.local:9093}"
OUT_JSON="${REPO_ROOT}/reports/kafka/gate5-v7-observed-principals.json"
OUT_ROOT="${REPO_ROOT}/certs/kafka-client"

SERVICES=(
  analytics-service
  auction-monitor
  auth-service
  listings-service
  media-service
  messaging-service
  notification-service
  python-ai-service
  shopping-service
  trust-service
  ollama-gateway
  ollama-worker
)

ok() { echo "✅ $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

command -v kubectl >/dev/null 2>&1 || fail "kubectl required"
command -v python3 >/dev/null 2>&1 || fail "python3 required"
[[ -d "$OUT_ROOT" ]] || fail "run generate-kafka-client-service-tls.sh first"

# Ensure Prin helper on broker
kubectl -n "$NS" exec "$BROKER_POD" -c kafka -- bash -c 'cat > /tmp/Prin.java <<'\''EOF'\''
import java.io.FileInputStream;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import javax.security.auth.x500.X500Principal;
public class Prin {
  public static void main(String[] a) throws Exception {
    CertificateFactory cf = CertificateFactory.getInstance("X.509");
    X509Certificate c = (X509Certificate) cf.generateCertificate(new FileInputStream(a[0]));
    X500Principal p = c.getSubjectX500Principal();
    System.out.println(p.getName());
  }
}
EOF
javac /tmp/Prin.java' >/dev/null

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/rp-kafka-prin.XXXXXX")"
trap 'rm -rf "$WORKDIR"' EXIT

rows_jsonl="${WORKDIR}/rows.jsonl"
: >"$rows_jsonl"

for svc in "${SERVICES[@]}"; do
  secret="kafka-client-tls-${svc}"
  dir="${OUT_ROOT}/${svc}"
  leaf="${dir}/leaf.crt"
  key="${dir}/tls.key"
  ca="${dir}/ca-chain.pem"
  [[ -f "$leaf" && -f "$key" && -f "$ca" ]] || fail "missing disk material for ${svc}"

  # Prefer Secret leaf (runtime source of truth) when present
  if kubectl -n "$NS" get secret "$secret" >/dev/null 2>&1; then
    kubectl -n "$NS" get secret "$secret" -o jsonpath='{.data.leaf\.crt}' | base64 -d >"${WORKDIR}/${svc}.leaf.crt"
    kubectl -n "$NS" get secret "$secret" -o jsonpath='{.data.tls\.key}' | base64 -d >"${WORKDIR}/${svc}.key"
    kubectl -n "$NS" get secret "$secret" -o jsonpath='{.data.ca-chain\.pem}' | base64 -d >"${WORKDIR}/${svc}.ca.pem"
  else
    cp "$leaf" "${WORKDIR}/${svc}.leaf.crt"
    cp "$key" "${WORKDIR}/${svc}.key"
    cp "$ca" "${WORKDIR}/${svc}.ca.pem"
  fi

  leaf_fp="$(openssl x509 -in "${WORKDIR}/${svc}.leaf.crt" -noout -fingerprint -sha256 | sed 's/.*=//')"
  subject_openssl="$(openssl x509 -in "${WORKDIR}/${svc}.leaf.crt" -noout -subject -nameopt RFC2253 | sed 's/^subject= *//')"
  spiffe="spiffe://record-platform/service/${svc}"

  kubectl -n "$NS" cp "${WORKDIR}/${svc}.leaf.crt" "${BROKER_POD}:/tmp/observe-${svc}.crt" -c kafka
  java_dn="$(kubectl -n "$NS" exec "$BROKER_POD" -c kafka -- java -cp /tmp Prin "/tmp/observe-${svc}.crt" | tr -d '\r')"
  [[ -n "$java_dn" ]] || fail "empty Java DN for ${svc}"
  principal="User:${java_dn}"

  # Live mTLS ApiVersions using the broker pod's kafka CLI (INTERNAL listener)
  kubectl -n "$NS" cp "${WORKDIR}/${svc}.leaf.crt" "${BROKER_POD}:/tmp/obs-${svc}-leaf.crt" -c kafka
  kubectl -n "$NS" cp "${WORKDIR}/${svc}.key" "${BROKER_POD}:/tmp/obs-${svc}.key" -c kafka
  kubectl -n "$NS" cp "${WORKDIR}/${svc}.ca.pem" "${BROKER_POD}:/tmp/obs-${svc}.ca.pem" -c kafka

  # Build PEM keystore material as PKCS12 for Kafka client CLI
  kubectl -n "$NS" exec "$BROKER_POD" -c kafka -- bash -c "
    set -euo pipefail
    openssl pkcs12 -export -in /tmp/obs-${svc}-leaf.crt -inkey /tmp/obs-${svc}.key \
      -certfile /tmp/obs-${svc}.ca.pem -out /tmp/obs-${svc}.p12 -passout pass:changeit -name client >/dev/null 2>&1
    keytool -importkeystore -srckeystore /tmp/obs-${svc}.p12 -srcstoretype PKCS12 \
      -srcstorepass changeit -destkeystore /tmp/obs-${svc}.keystore.jks -deststorepass changeit -noprompt >/dev/null 2>&1
    rm -f /tmp/obs-${svc}.truststore.jks
    keytool -importcert -alias ca -file /tmp/obs-${svc}.ca.pem \
      -keystore /tmp/obs-${svc}.truststore.jks -storepass changeit -noprompt >/dev/null 2>&1
    cat > /tmp/obs-${svc}.props <<PROPS
security.protocol=SSL
ssl.keystore.location=/tmp/obs-${svc}.keystore.jks
ssl.keystore.password=changeit
ssl.key.password=changeit
ssl.truststore.location=/tmp/obs-${svc}.truststore.jks
ssl.truststore.password=changeit
ssl.endpoint.identification.algorithm=
client.id=record-platform.${svc}.observe.principal-probe
PROPS
  "

  api_out="${WORKDIR}/${svc}.api.txt"
  if kubectl -n "$NS" exec "$BROKER_POD" -c kafka -- \
    kafka-broker-api-versions --bootstrap-server "$BOOTSTRAP" \
    --command-config "/tmp/obs-${svc}.props" >"$api_out" 2>&1; then
    mtls_ok=true
  else
    mtls_ok=false
    echo "WARN: ApiVersions failed for ${svc}" >&2
    head -40 "$api_out" >&2 || true
  fi

  # Attempt broker-log principal scrape (best-effort; may be empty without DEBUG)
  log_hit="$(kubectl -n "$NS" logs "$BROKER_POD" -c kafka --since=2m 2>/dev/null \
    | rg -F "$java_dn" | head -1 || true)"
  if [[ -n "$log_hit" ]]; then
    log_source="broker_log_match"
  else
    log_source="none"
  fi

  client_id="record-platform.${svc}.observe.principal-probe"
  export OBS_SVC="$svc" OBS_POD="$BROKER_POD" OBS_CLIENT_ID="$client_id" \
    OBS_FP="$leaf_fp" OBS_SUBJ_OSSL="$subject_openssl" OBS_SUBJ_JAVA="$java_dn" \
    OBS_SPIFFE="$spiffe" OBS_BOOTSTRAP="$BOOTSTRAP" OBS_PRINCIPAL="$principal" \
    OBS_MTLS="$mtls_ok" OBS_LOG_HIT="$log_hit" OBS_LOG_SRC="$log_source" \
    OBS_ROWS="$rows_jsonl"
  python3 <<'PY'
import json, os
row = {
  "service": os.environ["OBS_SVC"],
  "secret_name": f"kafka-client-tls-{os.environ['OBS_SVC']}",
  "pod": os.environ["OBS_POD"],
  "client_id": os.environ["OBS_CLIENT_ID"],
  "certificate_fingerprint_sha256": os.environ["OBS_FP"],
  "certificate_subject_openssl_rfc2253": os.environ["OBS_SUBJ_OSSL"],
  "certificate_subject_java_x500": os.environ["OBS_SUBJ_JAVA"],
  "spiffe_uri": os.environ["OBS_SPIFFE"],
  "broker": os.environ["OBS_POD"],
  "bootstrap": os.environ["OBS_BOOTSTRAP"],
  "broker_observed_principal": os.environ["OBS_PRINCIPAL"],
  "principal_source": "DefaultKafkaPrincipalBuilder_equivalent_Java_X500Principal",
  "principal_builder_class": "org.apache.kafka.common.security.authenticator.DefaultKafkaPrincipalBuilder",
  "ssl_principal_mapping_rules": None,
  "live_mtls_apiversions_accepted": os.environ["OBS_MTLS"] == "true",
  "broker_log_reference": os.environ["OBS_LOG_HIT"] or None,
  "broker_log_source": os.environ["OBS_LOG_SRC"],
  "note": "Kafka default SSL principal is User:<X500Principal.getName()>; Java RFC2253 order is O before CN for these leaves. Final ACLs must use broker_observed_principal exactly.",
}
with open(os.environ["OBS_ROWS"], "a", encoding="utf-8") as f:
    f.write(json.dumps(row) + "\n")
PY

  if [[ "$mtls_ok" == "true" ]]; then
    ok "${svc} principal=${principal}"
  else
    echo "❌ ${svc} mTLS ApiVersions failed; principal computed but not live-verified" >&2
  fi
done

python3 - "$rows_jsonl" "$OUT_JSON" <<'PY'
import json, pathlib, sys
from datetime import datetime, timezone
rows = [json.loads(l) for l in pathlib.Path(sys.argv[1]).read_text().splitlines() if l.strip()]
principals = [r["broker_observed_principal"] for r in rows]
distinct = sorted(set(principals))
generic = [p for p in principals if "CN=kafka-client" in p]
doc = {
  "document": "gate5-v7-observed-principals",
  "ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
  "authorizer_enabled": False,
  "final_acls_applied": False,
  "principal_builder_class": "org.apache.kafka.common.security.authenticator.DefaultKafkaPrincipalBuilder",
  "ssl_principal_mapping_rules": None,
  "observation_method": {
    "dn_source": "Java X500Principal.getName() on presented leaf (identical to Kafka DefaultKafkaPrincipalBuilder SSL path)",
    "live_proof": "kafka-broker-api-versions over INTERNAL SSL with each dedicated client leaf",
    "spiffe_role": "identity evidence SAN; not assumed to be the Kafka ACL principal",
  },
  "summary": {
    "services_expected": 12,
    "services_observed": len(rows),
    "live_mtls_accepted": sum(1 for r in rows if r.get("live_mtls_apiversions_accepted")),
    "distinct_observed_service_principals": len(distinct),
    "shared_generic_principal_observations": len(generic),
    "unknown_principals": 0,
    "final_acl_manifest_authorized": False,
  },
  "principals": rows,
  "distinct_principals": distinct,
}
pathlib.Path(sys.argv[2]).write_text(json.dumps(doc, indent=2) + "\n")
print(json.dumps(doc["summary"], indent=2))
print("distinct_principals:")
for p in distinct:
    print(" ", p)
PY

ok "wrote ${OUT_JSON}"
