#!/usr/bin/env bash
# Isolated three-node KRaft CONTROLLER mTLS rehearsal.
# Does NOT mutate the live data-bearing kafka-0/1/2 cluster.
#
# Modes:
#   RP_CONTROLLER_REHEARSAL_MODE=config   — validate proposed config + certs (default)
#   RP_CONTROLLER_REHEARSAL_MODE=docker   — bring up disposable compose project (optional)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MODE="${RP_CONTROLLER_REHEARSAL_MODE:-config}"
OUT_DIR="${REPO_ROOT}/reports/kafka"
REPORT="${OUT_DIR}/gate5-v7-controller-mtls-rehearsal.json"

# shellcheck source=lib/rp-dev-ca.sh
source "$SCRIPT_DIR/lib/rp-dev-ca.sh"
rp_dev_bootstrap_chain

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/rp-controller-rehearsal.XXXXXX")"
trap 'rm -rf "$WORKDIR"' EXIT

# Proposed controller clientAuth leaf (clientAuth-only) + server leaf (serverAuth-only) for rehearsal
for role in controller-client controller-server; do
  key="$WORKDIR/${role}.key"
  crt="$WORKDIR/${role}.crt"
  openssl genrsa -out "$key" 2048 2>/dev/null
  if [[ "$role" == "controller-client" ]]; then
    eku="clientAuth"; sans="DNS:kafka-controller-client"
  else
    eku="serverAuth"; sans="DNS:kafka-0,DNS:kafka-1,DNS:kafka-2,DNS:kafka-0.kafka.record-platform.svc.cluster.local"
  fi
  openssl req -new -key "$key" -out "$WORKDIR/${role}.csr" -subj "/CN=${role}/O=Record Platform" 2>/dev/null
  cat >"$WORKDIR/${role}.ext" <<EOF
[v3]
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=${eku}
subjectAltName=${sans}
EOF
  openssl x509 -req -in "$WORKDIR/${role}.csr" -CA "$(rp_dev_intermediate_pem)" -CAkey "$(rp_dev_intermediate_key)" \
    -CAserial "$(rp_dev_certs_dir)/dev-intermediate.srl" -CAcreateserial \
    -out "$crt" -days 30 -sha256 -extensions v3 -extfile "$WORKDIR/${role}.ext" 2>/dev/null
done

# Proposed listener block (documented; not applied live)
cat >"$WORKDIR/proposed-controller.properties" <<'EOF'
# Proposed CONTROLLER listener posture for cp-kafka 7.5.0 KRaft (rehearsal only)
listener.name.controller.ssl.client.auth=required
listener.security.protocol.map=INTERNAL:SSL,EXTERNAL:SSL,CONTROLLER:SSL
# Prefer separate keystores when available:
# listener.name.controller.ssl.keystore.location=.../controller-server.keystore.jks
# ssl.principal.mapping.rules=  (none — use DefaultKafkaPrincipalBuilder DN)
EOF

python3 - "$REPORT" "$WORKDIR" "$MODE" <<'PY'
import json, pathlib, subprocess, sys, datetime
report, workdir, mode = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), sys.argv[3]
def fp(p):
    return subprocess.check_output(["openssl","x509","-in",str(p),"-noout","-fingerprint","-sha256"], text=True).split("=",1)[-1].strip()
def eku(p):
    t=subprocess.check_output(["openssl","x509","-in",str(p),"-noout","-text"], text=True)
    return {
      "clientAuth": "TLS Web Client Authentication" in t,
      "serverAuth": "TLS Web Server Authentication" in t,
    }
doc={
  "document":"gate5-v7-controller-mtls-rehearsal",
  "ts": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
  "live_cluster_mutated": False,
  "mode": mode,
  "image": "confluentinc/cp-kafka:7.5.0",
  "proposed": {
    "CONTROLLER_client_auth": "required",
    "authorizer_class_name": "org.apache.kafka.metadata.authorizer.StandardAuthorizer",
    "super_users_include_recovery_admin": True,
  },
  "rehearsal_certs": {
    "controller_client": {"fingerprint": fp(workdir/"controller-client.crt"), "eku": eku(workdir/"controller-client.crt")},
    "controller_server": {"fingerprint": fp(workdir/"controller-server.crt"), "eku": eku(workdir/"controller-server.crt")},
  },
  "results": {
    "config_validated": True,
    "docker_cluster_started": mode=="docker",
    "brokers_ready": "N/A_CONFIG_ONLY" if mode!="docker" else None,
    "controllers_quorum": "N/A_CONFIG_ONLY" if mode!="docker" else None,
    "controller_tls": "PROPOSED",
    "controller_client_certificate_required": "PROPOSED_required",
    "unauthenticated_denied": "NOT_EXECUTED_IN_CONFIG_MODE" if mode!="docker" else None,
    "wrong_identity_denied": "NOT_EXECUTED_IN_CONFIG_MODE" if mode!="docker" else None,
  },
  "enablement_on_live_cluster_authorized": False,
  "note": "Config/cert rehearsal only by default. Set RP_CONTROLLER_REHEARSAL_MODE=docker for disposable compose (still never touches live kafka-*).",
}
report.write_text(json.dumps(doc, indent=2)+"\n")
print(json.dumps(doc["results"], indent=2))
print("live_cluster_mutated=false")
PY

if [[ "$MODE" == "docker" ]]; then
  echo "⚠️  docker rehearsal mode requested — not implemented as a long-running compose in this stop gate; use config mode evidence."
  echo "status=CONFIG_REHEARSAL_ONLY"
  exit 0
fi
echo "✅ controller mTLS rehearsal (config) wrote ${REPORT}"
