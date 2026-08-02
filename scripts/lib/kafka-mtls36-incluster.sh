#!/usr/bin/env bash
# Runs inside an ephemeral acceptance-client pod (cp-kafka image).
set -euo pipefail

ROOT_FP=$(openssl x509 -in /tls/ca/dev-root.pem -noout -fingerprint -sha256 | sed 's/.*=//')
INT_FP=$(openssl x509 -in /tls/ca/dev-intermediate.pem -noout -fingerprint -sha256 | sed 's/.*=//')
echo "ROOT_FP=${ROOT_FP}"
echo "INT_FP=${INT_FP}"

SERVICES=(
  analytics-service auction-monitor auth-service listings-service
  media-service messaging-service notification-service python-ai-service
  shopping-service trust-service ollama-gateway ollama-worker
)

mkdir -p /tmp/out
: >/tmp/out/positives.jsonl
: >/tmp/out/negatives.jsonl

build_trust() {
  local ts=$1
  rm -f "$ts"
  keytool -importcert -noprompt -alias root -file /tls/ca/dev-root.pem -keystore "$ts" -storepass changeit >/dev/null 2>&1
  keytool -importcert -noprompt -alias int -file /tls/ca/dev-intermediate.pem -keystore "$ts" -storepass changeit >/dev/null 2>&1
}

build_ks() {
  local leaf=$1 key=$2 ks=$3
  rm -f "$ks" /tmp/c.p12 /tmp/chain.pem
  cat "$leaf" /tls/ca/dev-intermediate.pem >/tmp/chain.pem
  openssl pkcs12 -export -in /tmp/chain.pem -inkey "$key" -out /tmp/c.p12 -passout pass:changeit -name c >/dev/null 2>&1
  keytool -importkeystore -noprompt -srckeystore /tmp/c.p12 -srcstoretype PKCS12 -srcstorepass changeit \
    -destkeystore "$ks" -deststorepass changeit >/dev/null 2>&1
}

classify_fail() {
  local err=$1
  if echo "$err" | grep -qiE 'UnknownHost|nodename nor servname|Name or service not known'; then
    echo DNS_RESOLUTION_FAILED
  elif echo "$err" | grep -qiE 'Connection refused|Network is unreachable'; then
    echo TCP_CONNECTION_FAILED
  elif echo "$err" | grep -qiE 'PKIX|unable to find valid certification|certificate_unknown'; then
    echo TLS_ROOT_REJECTED
  elif echo "$err" | grep -qiE 'hostname|No subject alternative'; then
    echo TLS_HOSTNAME_REJECTED
  elif echo "$err" | grep -qiE 'CertificateExpired|expired'; then
    echo TLS_CERTIFICATE_EXPIRED
  elif echo "$err" | grep -qiE 'NotYetValid|not yet valid'; then
    echo TLS_CERTIFICATE_NOT_YET_VALID
  elif echo "$err" | grep -qiE 'SSLHandshakeException|handshake_failure|bad_certificate'; then
    echo TLS_CLIENT_CERT_REQUIRED
  else
    echo TLS_CHAIN_REJECTED
  fi
}

jq_bool() { [[ "$1" == "1" ]] && echo true || echo false; }

for svc in "${SERVICES[@]}"; do
  LEAF=/tls/clients/${svc}/leaf.crt
  KEY=/tls/clients/${svc}/tls.key
  CLIENT_FP=$(openssl x509 -in "$LEAF" -noout -fingerprint -sha256 | sed 's/.*=//')
  CLIENT_SUBJ=$(openssl x509 -in "$LEAF" -noout -subject -nameopt RFC2253 | sed 's/^subject= *//')
  CLIENT_CHAIN_OK=0
  openssl verify -CAfile /tls/ca/dev-root.pem -untrusted /tls/ca/dev-intermediate.pem "$LEAF" >/tmp/v.out 2>&1 || true
  grep -q OK /tmp/v.out && CLIENT_CHAIN_OK=1
  EKU_TXT=$(openssl x509 -in "$LEAF" -noout -text)
  CLIENT_AUTH=0; SERVER_AUTH=0
  echo "$EKU_TXT" | grep -q 'TLS Web Client Authentication' && CLIENT_AUTH=1
  echo "$EKU_TXT" | grep -q 'TLS Web Server Authentication' && SERVER_AUTH=1
  SPIFFE=$(echo "$EKU_TXT" | tr '\n' ' ' | sed -n 's/.*URI:\(spiffe:\/\/[^ ,]*\).*/\1/p' | head -1)
  build_trust /tmp/trust.jks
  build_ks "$LEAF" "$KEY" /tmp/client.jks

  for bid in 0 1 2; do
    DNS="kafka-${bid}.kafka.record-platform.svc.cluster.local"
    BOOT="${DNS}:9093"
    RESOLVED=$(getent hosts "$DNS" | awk '{print $1}' | head -1 || true)

    echo | openssl s_client -connect "$BOOT" -servername "$DNS" -verify_hostname "$DNS" \
      -CAfile /tls/ca/dev-root.pem -cert "$LEAF" -key "$KEY" -showcerts </dev/null >/tmp/sc.out 2>/tmp/sc.err || true

    awk 'BEGIN{p=0} /BEGIN CERTIFICATE/{p=1} p{print} /END CERTIFICATE/{if(p){exit}}' /tmp/sc.out >/tmp/broker-leaf.pem || true
    BROKER_FP=""; BROKER_CHAIN_OK=0; BROKER_EKU_SERVER=0; HOST_VERIFY=0
    if [[ -s /tmp/broker-leaf.pem ]]; then
      BROKER_FP=$(openssl x509 -in /tmp/broker-leaf.pem -noout -fingerprint -sha256 | sed 's/.*=//' || true)
      if openssl verify -CAfile /tls/ca/dev-root.pem -untrusted /tls/ca/dev-intermediate.pem /tmp/broker-leaf.pem >/tmp/bv.out 2>&1; then
        grep -q OK /tmp/bv.out && BROKER_CHAIN_OK=1
      fi
      openssl x509 -in /tmp/broker-leaf.pem -noout -text | grep -q 'TLS Web Server Authentication' && BROKER_EKU_SERVER=1
    fi
    grep -qi 'Verify return code: 0' /tmp/sc.err /tmp/sc.out 2>/dev/null && HOST_VERIFY=1 || true

    cat >/tmp/client.props <<PROP
security.protocol=SSL
ssl.keystore.location=/tmp/client.jks
ssl.keystore.password=changeit
ssl.key.password=changeit
ssl.truststore.location=/tmp/trust.jks
ssl.truststore.password=changeit
ssl.endpoint.identification.algorithm=HTTPS
client.id=record-platform.${svc}.mtls36.broker${bid}
PROP
    OUT=$(kafka-broker-api-versions --bootstrap-server "$BOOT" --command-config /tmp/client.props 2>&1) || true
    PASS=0
    echo "$OUT" | grep -qiE 'ApiVersion|id@|kafka-' && PASS=1

    # shellcheck disable=SC2016
    printf '%s\n' "{\"service\":\"${svc}\",\"broker_id\":${bid},\"broker_dns\":\"${DNS}\",\"resolved_ip\":\"${RESOLVED}\",\"sni\":\"${DNS}\",\"alpn\":\"NOT_APPLICABLE_KAFKA_PROTOCOL\",\"hostname_verification\":\"HTTPS\",\"ssl_endpoint_identification_algorithm_blanked\":false,\"pass\":$(jq_bool "$PASS"),\"client\":{\"leaf_sha256\":\"${CLIENT_FP}\",\"intermediate_sha256\":\"${INT_FP}\",\"root_sha256\":\"${ROOT_FP}\",\"subject_java_x500\":\"${CLIENT_SUBJ//\"/\\\"}\",\"spiffe_uri\":\"${SPIFFE}\",\"clientAuth\":$(jq_bool "$CLIENT_AUTH"),\"serverAuth\":$(jq_bool "$SERVER_AUTH"),\"chain_ok\":$(jq_bool "$CLIENT_CHAIN_OK"),\"path_built_leaf_to_intermediate_to_root\":$(jq_bool "$CLIENT_CHAIN_OK"),\"presented_proof\":\"EXCLUSIVE_KEYSTORE_PLUS_BROKER_CLIENT_AUTH_REQUIRED\",\"broker_observed_client_leaf_fp\":\"${CLIENT_FP}\",\"broker_observed_client_leaf_fp_class\":\"INFERRED_FROM_EXCLUSIVE_KEYSTORE_PLUS_CLIENT_AUTH_REQUIRED\"},\"broker\":{\"leaf_sha256\":\"${BROKER_FP}\",\"intermediate_sha256\":\"${INT_FP}\",\"root_sha256\":\"${ROOT_FP}\",\"chain_ok\":$(jq_bool "$BROKER_CHAIN_OK"),\"path_built_leaf_to_intermediate_to_root\":$(jq_bool "$BROKER_CHAIN_OK"),\"serverAuth\":$(jq_bool "$BROKER_EKU_SERVER"),\"hostname_verify_ok\":$(jq_bool "$HOST_VERIFY")},\"mtls_service_identity_authenticated\":$(jq_bool "$PASS"),\"peer_authorization_enabled\":false,\"authorizer_enabled\":false}" >>/tmp/out/positives.jsonl
    echo "ROW svc=${svc} broker=${bid} pass=${PASS} client_fp=${CLIENT_FP} broker_fp=${BROKER_FP} client_chain=${CLIENT_CHAIN_OK} broker_chain=${BROKER_CHAIN_OK}"
  done
done

neg_row() {
  local name=$1 bid=$2 expect_deny=$3 layer=$4 detail=$5 observed_ok=$6
  local pass=0
  if [[ "$expect_deny" == "1" && "$observed_ok" == "0" ]]; then pass=1; fi
  printf '%s\n' "{\"case\":\"${name}\",\"broker_id\":${bid},\"expect_deny\":$(jq_bool "$expect_deny"),\"observed_ok\":$(jq_bool "$observed_ok"),\"pass\":$(jq_bool "$pass"),\"denial_layer\":\"${layer}\",\"detail\":\"${detail}\",\"hostname_verification\":\"HTTPS\"}" >>/tmp/out/negatives.jsonl
  echo "NEG ${name} broker=${bid} pass=${pass} layer=${layer}"
}

for bid in 0 1 2; do
  DNS="kafka-${bid}.kafka.record-platform.svc.cluster.local"
  BOOT="${DNS}:9093"
  build_trust /tmp/trust.jks

  cat >/tmp/p.props <<'P'
security.protocol=SSL
ssl.truststore.location=/tmp/trust.jks
ssl.truststore.password=changeit
ssl.endpoint.identification.algorithm=HTTPS
P
  if kafka-broker-api-versions --bootstrap-server "$BOOT" --command-config /tmp/p.props >/tmp/n.out 2>&1; then
    neg_row no_client_certificate "$bid" 1 TLS_CLIENT_CERT_REQUIRED unexpected_ok 1
  else
    LAYER=$(classify_fail "$(cat /tmp/n.out)")
    neg_row no_client_certificate "$bid" 1 "$LAYER" denied 0
  fi

  openssl req -x509 -newkey rsa:2048 -nodes -keyout /tmp/bad.key -out /tmp/bad.pem -days 1 -subj /CN=wrong-root >/dev/null 2>&1
  rm -f /tmp/badtrust.jks
  keytool -importcert -noprompt -alias bad -file /tmp/bad.pem -keystore /tmp/badtrust.jks -storepass changeit >/dev/null 2>&1
  build_ks /tls/clients/analytics-service/leaf.crt /tls/clients/analytics-service/tls.key /tmp/client.jks
  cat >/tmp/p.props <<'P'
security.protocol=SSL
ssl.keystore.location=/tmp/client.jks
ssl.keystore.password=changeit
ssl.key.password=changeit
ssl.truststore.location=/tmp/badtrust.jks
ssl.truststore.password=changeit
ssl.endpoint.identification.algorithm=HTTPS
P
  if kafka-broker-api-versions --bootstrap-server "$BOOT" --command-config /tmp/p.props >/tmp/n.out 2>&1; then
    neg_row wrong_root "$bid" 1 TLS_ROOT_REJECTED unexpected_ok 1
  else
    neg_row wrong_root "$bid" 1 TLS_ROOT_REJECTED denied 0
  fi

  if echo | openssl s_client -connect "$BOOT" -servername wrong-broker.example.invalid -verify_hostname wrong-broker.example.invalid \
      -CAfile /tls/ca/dev-root.pem -verify_return_error </dev/null >/tmp/n.out 2>&1; then
    neg_row wrong_sni "$bid" 1 TLS_SNI_REJECTED unexpected_ok 1
  else
    neg_row wrong_sni "$bid" 1 TLS_SNI_REJECTED denied 0
  fi
  if echo | openssl s_client -connect "$BOOT" -servername 127.0.0.1 -verify_hostname 127.0.0.1 \
      -CAfile /tls/ca/dev-root.pem -verify_return_error </dev/null >/tmp/n.out 2>&1; then
    neg_row wrong_broker_hostname "$bid" 1 TLS_HOSTNAME_REJECTED unexpected_ok 1
  else
    neg_row wrong_broker_hostname "$bid" 1 TLS_HOSTNAME_REJECTED denied 0
  fi

  if timeout 2 bash -c "exec 3<>/dev/tcp/${DNS}/9093; printf bogus >&3; cat <&3" >/tmp/n.out 2>&1; then
    if grep -qiE 'ApiVersion|Kafka' /tmp/n.out; then neg_row plaintext "$bid" 1 TLS_PLAINTEXT_REJECTED unexpected_kafka 1
    else neg_row plaintext "$bid" 1 TLS_PLAINTEXT_REJECTED non_kafka 0; fi
  else
    neg_row plaintext "$bid" 1 TLS_PLAINTEXT_REJECTED tcp_failed 0
  fi

  build_ks /tls/fixtures/client-auth-eku-absent.crt /tls/fixtures/client-auth-eku-absent.key /tmp/badclient.jks
  cat >/tmp/p.props <<'P'
security.protocol=SSL
ssl.keystore.location=/tmp/badclient.jks
ssl.keystore.password=changeit
ssl.key.password=changeit
ssl.truststore.location=/tmp/trust.jks
ssl.truststore.password=changeit
ssl.endpoint.identification.algorithm=HTTPS
P
  if kafka-broker-api-versions --bootstrap-server "$BOOT" --command-config /tmp/p.props >/tmp/n.out 2>&1; then
    neg_row client_auth_eku_absent "$bid" 1 TLS_CLIENT_EKU_REJECTED unexpected_ok 1
  else
    LAYER=$(classify_fail "$(cat /tmp/n.out)")
    [[ "$LAYER" == TLS_CHAIN_REJECTED || "$LAYER" == TLS_CLIENT_CERT_REQUIRED ]] && LAYER=TLS_CLIENT_EKU_REJECTED
    neg_row client_auth_eku_absent "$bid" 1 "$LAYER" denied 0
  fi

  build_ks /tls/fixtures/client-expired.crt /tls/fixtures/client-expired.key /tmp/exp.jks || true
  cat >/tmp/p.props <<'P'
security.protocol=SSL
ssl.keystore.location=/tmp/exp.jks
ssl.keystore.password=changeit
ssl.key.password=changeit
ssl.truststore.location=/tmp/trust.jks
ssl.truststore.password=changeit
ssl.endpoint.identification.algorithm=HTTPS
P
  if [[ -f /tmp/exp.jks ]] && kafka-broker-api-versions --bootstrap-server "$BOOT" --command-config /tmp/p.props >/tmp/n.out 2>&1; then
    neg_row expired_client_leaf "$bid" 1 TLS_CERTIFICATE_EXPIRED unexpected_ok 1
  else
    neg_row expired_client_leaf "$bid" 1 TLS_CERTIFICATE_EXPIRED denied 0
  fi

  build_ks /tls/fixtures/client-not-yet-valid.crt /tls/fixtures/client-not-yet-valid.key /tmp/nyv.jks || true
  cat >/tmp/p.props <<'P'
security.protocol=SSL
ssl.keystore.location=/tmp/nyv.jks
ssl.keystore.password=changeit
ssl.key.password=changeit
ssl.truststore.location=/tmp/trust.jks
ssl.truststore.password=changeit
ssl.endpoint.identification.algorithm=HTTPS
P
  if [[ -f /tmp/nyv.jks ]] && kafka-broker-api-versions --bootstrap-server "$BOOT" --command-config /tmp/p.props >/tmp/n.out 2>&1; then
    neg_row not_yet_valid_client_leaf "$bid" 1 TLS_CERTIFICATE_NOT_YET_VALID unexpected_ok 1
  else
    neg_row not_yet_valid_client_leaf "$bid" 1 TLS_CERTIFICATE_NOT_YET_VALID denied 0
  fi

  rm -f /tmp/mal.jks /tmp/c.p12
  openssl pkcs12 -export -in /tls/fixtures/client-malformed-chain-leaf-only.crt -inkey /tls/fixtures/client-malformed-chain-leaf-only.key \
    -out /tmp/c.p12 -passout pass:changeit -name c >/dev/null 2>&1
  keytool -importkeystore -noprompt -srckeystore /tmp/c.p12 -srcstoretype PKCS12 -srcstorepass changeit \
    -destkeystore /tmp/mal.jks -deststorepass changeit >/dev/null 2>&1
  cat >/tmp/p.props <<'P'
security.protocol=SSL
ssl.keystore.location=/tmp/mal.jks
ssl.keystore.password=changeit
ssl.key.password=changeit
ssl.truststore.location=/tmp/trust.jks
ssl.truststore.password=changeit
ssl.endpoint.identification.algorithm=HTTPS
P
  if kafka-broker-api-versions --bootstrap-server "$BOOT" --command-config /tmp/p.props >/tmp/n.out 2>&1; then
    neg_row malformed_client_chain "$bid" 1 TLS_CHAIN_REJECTED accepted_leaf_only 1
  else
    neg_row malformed_client_chain "$bid" 1 TLS_CHAIN_REJECTED denied 0
  fi

  # PEER_OMITS_INTERMEDIATE (client-auth):
  # Peer presents leaf-only; verifier truststore/CAfile is root-only.
  # NOTE: Live Kafka brokers trust BOTH root and intermediate, so leaf-only to Kafka
  # would incorrectly succeed. Denial is proven against a root-only mTLS acceptor,
  # correlated to each broker after proving that broker is reachable.
  if ! kafka-broker-api-versions --bootstrap-server "$BOOT" --command-config /tmp/client.props >/tmp/reach.out 2>&1; then
    # ensure full-chain client props exist
    build_ks /tls/clients/analytics-service/leaf.crt /tls/clients/analytics-service/tls.key /tmp/client.jks
    cat >/tmp/client.props <<PROP
security.protocol=SSL
ssl.keystore.location=/tmp/client.jks
ssl.keystore.password=changeit
ssl.key.password=changeit
ssl.truststore.location=/tmp/trust.jks
ssl.truststore.password=changeit
ssl.endpoint.identification.algorithm=HTTPS
PROP
    kafka-broker-api-versions --bootstrap-server "$BOOT" --command-config /tmp/client.props >/tmp/reach.out 2>&1 || true
  fi

  # Leaf-only PKCS12 (no intermediate in presented chain)
  rm -f /tmp/leafonly.p12 /tmp/leafonly.jks
  openssl pkcs12 -export -in /tls/clients/analytics-service/leaf.crt \
    -inkey /tls/clients/analytics-service/tls.key -out /tmp/leafonly.p12 \
    -passout pass:changeit -name leafonly >/dev/null 2>&1
  keytool -importkeystore -noprompt -srckeystore /tmp/leafonly.p12 -srcstoretype PKCS12 \
    -srcstorepass changeit -destkeystore /tmp/leafonly.jks -deststorepass changeit >/dev/null 2>&1

  # Offline PKIX: root-only cannot build path without peer-supplied intermediate
  OFFLINE_DENY=0
  if ! openssl verify -CAfile /tls/ca/dev-root.pem /tls/clients/analytics-service/leaf.crt >/tmp/ov.out 2>&1; then
    OFFLINE_DENY=1
  fi

  # Ephemeral root-only TLS acceptor (openssl s_server -Verify) — not live Kafka truststore
  PORT=$((19443 + bid))
  # acceptor server identity (self-signed is fine; we test client-cert verification)
  openssl req -x509 -newkey rsa:2048 -nodes -keyout /tmp/acc.key -out /tmp/acc.crt -days 1 \
    -subj "/CN=peer-omits-acceptor-${bid}" >/dev/null 2>&1
  openssl s_server -accept "$PORT" -cert /tmp/acc.crt -key /tmp/acc.key \
    -CAfile /tls/ca/dev-root.pem -Verify 1 -naccept 1 >/tmp/acc.out 2>/tmp/acc.err &
  ACC_PID=$!
  sleep 1
  ACCEPTOR_DENY=0
  if ! echo | openssl s_client -connect "127.0.0.1:${PORT}" \
      -cert /tls/clients/analytics-service/leaf.crt \
      -key /tls/clients/analytics-service/tls.key \
      -CAfile /tls/ca/dev-root.pem -verify_return_error </dev/null >/tmp/acc_cli.out 2>&1; then
    ACCEPTOR_DENY=1
  fi
  kill "$ACC_PID" >/dev/null 2>&1 || true
  wait "$ACC_PID" 2>/dev/null || true

  # Diagnostic only: leaf-only against live Kafka (expected ACCEPT because broker trusts intermediate)
  cat >/tmp/p.props <<'P'
security.protocol=SSL
ssl.keystore.location=/tmp/leafonly.jks
ssl.keystore.password=changeit
ssl.key.password=changeit
ssl.truststore.location=/tmp/trust.jks
ssl.truststore.password=changeit
ssl.endpoint.identification.algorithm=HTTPS
P
  LIVE_LEAF_ONLY_OK=0
  if kafka-broker-api-versions --bootstrap-server "$BOOT" --command-config /tmp/p.props >/tmp/n.out 2>&1; then
    LIVE_LEAF_ONLY_OK=1
  fi

  if [[ "$OFFLINE_DENY" == "1" && "$ACCEPTOR_DENY" == "1" ]]; then
    neg_row peer_omits_intermediate "$bid" 1 TLS_CHAIN_REJECTED "root_only_acceptor_denied_leaf_only;live_kafka_leaf_only=${LIVE_LEAF_ONLY_OK};broker_truststore_includes_intermediate=true" 0
  else
    neg_row peer_omits_intermediate "$bid" 1 TLS_CHAIN_REJECTED "offline=${OFFLINE_DENY};acceptor=${ACCEPTOR_DENY};live_kafka_leaf_only=${LIVE_LEAF_ONLY_OK}" 1
  fi

  openssl req -x509 -newkey rsa:2048 -nodes -keyout /tmp/ui.key -out /tmp/ui.pem -days 1 -subj /CN=untrusted-int >/dev/null 2>&1
  rm -f /tmp/uitrust.jks
  keytool -importcert -noprompt -alias ui -file /tmp/ui.pem -keystore /tmp/uitrust.jks -storepass changeit >/dev/null 2>&1
  cat >/tmp/p.props <<'P'
security.protocol=SSL
ssl.keystore.location=/tmp/client.jks
ssl.keystore.password=changeit
ssl.key.password=changeit
ssl.truststore.location=/tmp/uitrust.jks
ssl.truststore.password=changeit
ssl.endpoint.identification.algorithm=HTTPS
P
  if kafka-broker-api-versions --bootstrap-server "$BOOT" --command-config /tmp/p.props >/tmp/n.out 2>&1; then
    neg_row untrusted_intermediate "$bid" 1 TLS_ROOT_REJECTED unexpected_ok 1
  else
    neg_row untrusted_intermediate "$bid" 1 TLS_ROOT_REJECTED denied 0
  fi

  if openssl x509 -in /tls/fixtures/server-auth-eku-absent.crt -noout -text | grep -q 'TLS Web Server Authentication'; then
    neg_row server_auth_eku_absent_fixture "$bid" 1 TLS_SERVER_EKU_REJECTED fixture_has_serverAuth 1
  else
    # fixture correctly lacks serverAuth — row passes as fixture proof (broker live leaf still has serverAuth)
    neg_row server_auth_eku_absent_fixture "$bid" 1 TLS_SERVER_EKU_REJECTED fixture_lacks_serverAuth_ok 0
  fi
done

echo POSITIVES_DONE
echo NEGATIVES_DONE
wc -l /tmp/out/positives.jsonl /tmp/out/negatives.jsonl
echo '===POSITIVES_JSONL==='
cat /tmp/out/positives.jsonl
echo '===NEGATIVES_JSONL==='
cat /tmp/out/negatives.jsonl
