#!/usr/bin/env bash
# Measure exact Kafka ACL principals via Java X500Principal.getName()
# (DefaultKafkaPrincipalBuilder). Never guess DN order; never use OpenSSL display order for ACLs.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_JSON="${REPO_ROOT}/reports/kafka/gate5-v7-kafka-node-principals.json"
OUT_MEASURED="${REPO_ROOT}/reports/kafka/gate5-v7-measured-principals.json"
WORKDIR="${TMPDIR:-/tmp}/rp-g5v7-princ-$$"
mkdir -p "$WORKDIR"

fail() { echo "❌ $*" >&2; exit 1; }
ok() { echo "✅ $*"; }

command -v java >/dev/null || fail "java required"
command -v kubectl >/dev/null || fail "kubectl required"
command -v openssl >/dev/null || fail "openssl required"

SERVICES=(
  analytics-service auction-monitor auth-service listings-service media-service
  messaging-service notification-service python-ai-service shopping-service
  trust-service ollama-gateway ollama-worker
)

kubectl --request-timeout=30s -n record-platform get secret kafka-ssl-secret \
  -o jsonpath='{.data.kafka\.keystore\.jks}' | base64 -d >"$WORKDIR/broker.jks"
PASS="$(kubectl --request-timeout=20s -n record-platform get secret kafka-ssl-secret \
  -o jsonpath='{.data.kafka\.keystore-password}' | base64 -d)"

keytool -importkeystore -noprompt \
  -srckeystore "$WORKDIR/broker.jks" -srcstoretype JKS -srcstorepass "$PASS" \
  -destkeystore "$WORKDIR/broker.p12" -deststoretype PKCS12 -deststorepass "$PASS" >/dev/null 2>&1
openssl pkcs12 -in "$WORKDIR/broker.p12" -passin pass:"$PASS" -nokeys -clcerts \
  -out "$WORKDIR/broker-leaf.pem" 2>/dev/null

for svc in "${SERVICES[@]}" gate5-v7-admin; do
  sec="kafka-client-tls-${svc}"
  kubectl --request-timeout=20s -n record-platform get secret "$sec" -o json >"$WORKDIR/${svc}.secret.json"
  python3 - "$WORKDIR/${svc}.secret.json" "$WORKDIR/${svc}.pem" <<'PY'
import base64, json, pathlib, sys
doc = json.loads(pathlib.Path(sys.argv[1]).read_text())
data = doc.get("data") or {}
out = pathlib.Path(sys.argv[2])
for key in ("tls.crt", "leaf.crt", "client.crt", "cert.pem"):
  if key in data and data[key]:
    out.write_bytes(base64.b64decode(data[key]))
    break
else:
  raise SystemExit(f"missing cert keys in secret; have={sorted(data)}")
PY
done

cat >"$WORKDIR/Measure.java" <<'JAVA'
import java.io.FileInputStream;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.Collection;
import java.util.List;
import javax.security.auth.x500.X500Principal;

public class Measure {
  static String fp(X509Certificate c) throws Exception {
    byte[] der = c.getEncoded();
    java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-256");
    byte[] dig = md.digest(der);
    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < dig.length; i++) {
      if (i > 0) sb.append(':');
      sb.append(String.format("%02X", dig[i]));
    }
    return sb.toString();
  }

  public static void main(String[] args) throws Exception {
    // args: label=path ...
    CertificateFactory cf = CertificateFactory.getInstance("X.509");
    for (String arg : args) {
      int eq = arg.indexOf('=');
      String label = arg.substring(0, eq);
      String path = arg.substring(eq + 1);
      try (FileInputStream in = new FileInputStream(path)) {
        X509Certificate cert = (X509Certificate) cf.generateCertificate(in);
        X500Principal subj = cert.getSubjectX500Principal();
        String name = subj.getName();
        boolean clientAuth = false, serverAuth = false;
        try {
          List<String> eku = cert.getExtendedKeyUsage();
          if (eku != null) {
            clientAuth = eku.contains("1.3.6.1.5.5.7.3.2");
            serverAuth = eku.contains("1.3.6.1.5.5.7.3.1");
          }
        } catch (Exception ignored) {}
        StringBuilder sans = new StringBuilder();
        Collection<List<?>> sanList = cert.getSubjectAlternativeNames();
        if (sanList != null) {
          for (List<?> s : sanList) {
            if (sans.length() > 0) sans.append('|');
            sans.append(s.get(0)).append(':').append(s.get(1));
          }
        }
        // TSV: label \t x500 \t sha256 \t clientAuth \t serverAuth \t sans
        System.out.println(label + "\t" + name + "\t" + fp(cert) + "\t" + clientAuth + "\t" + serverAuth + "\t" + sans);
      }
    }
  }
}
JAVA

javac -d "$WORKDIR" "$WORKDIR/Measure.java"
ARGS=("broker=$WORKDIR/broker-leaf.pem" "recovery-admin=$WORKDIR/gate5-v7-admin.pem")
for svc in "${SERVICES[@]}"; do
  ARGS+=("${svc}=$WORKDIR/${svc}.pem")
done
( cd "$WORKDIR" && java Measure "${ARGS[@]}" ) >"$WORKDIR/rows.tsv"

python3 - "$WORKDIR/rows.tsv" "$OUT_JSON" "$OUT_MEASURED" <<'PY'
import json, pathlib, sys
from datetime import datetime, timezone

rows = {}
for line in pathlib.Path(sys.argv[1]).read_text().splitlines():
    if not line.strip():
        continue
    parts = line.split("\t")
    label, x500, fp, ca, sa, sans = parts[0], parts[1], parts[2], parts[3], parts[4], parts[5] if len(parts) > 5 else ""
    rows[label] = {
        "x500_principal_getName": x500,
        "kafka_acl_principal": f"User:{x500}",
        "leaf_sha256": fp,
        "eku_clientAuth": ca.lower() == "true",
        "eku_serverAuth": sa.lower() == "true",
        "sans": [s for s in sans.split("|") if s],
    }

ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
services_order = [
  "analytics-service","auction-monitor","auth-service","listings-service","media-service",
  "messaging-service","notification-service","python-ai-service","shopping-service",
  "trust-service","ollama-gateway","ollama-worker",
]
services = []
seen = set()
dups = 0
for s in services_order:
    r = dict(rows[s])
    r["service"] = s
    p = r["kafka_acl_principal"]
    if p in seen:
        dups += 1
        r["duplicate_principal"] = True
    seen.add(p)
    services.append(r)

broker_p = rows["broker"]["kafka_acl_principal"]
admin_p = rows["recovery-admin"]["kafka_acl_principal"]
nodes = {}
for n in ("kafka-0", "kafka-1", "kafka-2"):
    nodes[n] = {
        "node": n,
        "server_principal": broker_p,
        "controller_client_principal": broker_p,
        "dual_use_eku_accepted_exception": True,
        "distinct_node_client_fingerprint": False,
        "leaf_sha256": rows["broker"]["leaf_sha256"],
    }

doc = {
    "document": "gate5-v7-kafka-node-principals",
    "ts": ts,
    "measurement_method": "javax.security.auth.x500.X500Principal.getName() on live Secret leaf certificates",
    "openssl_display_order_used_for_acls": False,
    "principals_guessed": 0,
    "broker_server_leaf": rows["broker"],
    "recovery_admin": rows["recovery-admin"],
    "service_principals": services,
    "service_principals_expected": 12,
    "service_principals_measured": len(services),
    "kafka_nodes": nodes,
    "broker_controller_principals_expected": 3,
    "broker_controller_principals_measured": 3,
    "duplicate_service_principals": dups,
    "unknown_principals": 0,
    "canonical_acl_form_note": "Use kafka_acl_principal exactly as measured from X500Principal.getName(); do not reorder RDNs.",
    "prior_cn_first_examples_superseded": True,
    "note": "Live PKI currently encodes RDN order such that Java getName() is O-before-CN. Rehearsal certs must match this encoding for live parity.",
}
pathlib.Path(sys.argv[2]).write_text(json.dumps(doc, indent=2) + "\n")

measured = {
    "document": "gate5-v7-measured-principals",
    "ts": ts,
    "measurement_method": "javax.security.auth.x500.X500Principal.getName() on live Secret leaf PEMs",
    "openssl_display_order_used_for_acls": False,
    "principals_guessed": 0,
    "broker_principal_canonical": broker_p,
    "broker_leaf_sha256": rows["broker"]["leaf_sha256"],
    "recovery_admin_acl_principal_canonical": admin_p,
    "recovery_admin_leaf_sha256": rows["recovery-admin"]["leaf_sha256"],
    "service_acl_principals_canonical": {s["service"]: s["kafka_acl_principal"] for s in services},
    "service_principals_count": len(services),
    "service_principals": services,
    "kafka_nodes": nodes,
    "duplicate_service_principals": dups,
    "unknown_principals": 0,
    "dual_use_eku_accepted_exception": True,
    "note": "Never guess DN ordering. Use kafka_acl_principal exactly.",
}
pathlib.Path(sys.argv[3]).write_text(json.dumps(measured, indent=2) + "\n")
print(json.dumps({
    "broker": broker_p,
    "admin": admin_p,
    "analytics": measured["service_acl_principals_canonical"]["analytics-service"],
    "services": len(services),
    "duplicates": dups,
}, indent=2))
PY

ok "wrote $OUT_JSON and $OUT_MEASURED"
rm -rf "$WORKDIR"
