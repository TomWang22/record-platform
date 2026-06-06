# OCH → RP rewrite scan: `kafka-kraft-3broker-chaos-suite-bundle-20260418-022748`

**Staging (read-only scan):** `/Users/tom/bundle-staging/kafka-kraft-3broker-chaos-suite-bundle-20260418-022748`

This report lists **detected** OCH-era strings. It does **not** apply edits.

---

## Namespace references

*Kubernetes / config namespace strings*

**Hits:** 104 (capped per file in scanner)

- `kafka-kraft-3broker-chaos-suite-bundle/README_BUNDLE.txt`
  - L27: `• Namespace off-campus-housing-tracker (see infra/k8s/base/namespaces.yaml) or set HOUSING_NS consistently`
- `kafka-kraft-3broker-chaos-suite-bundle/certs/README.txt`
  - L18: `Expected artifacts (local only): `dev-root.pem`, `dev-root.key`, `off-campus-housing.test.{crt,key}`,`
- `kafka-kraft-3broker-chaos-suite-bundle/infra/k8s/base/namespaces.yaml`
  - L4: `name: off-campus-housing-tracker`
- `kafka-kraft-3broker-chaos-suite-bundle/infra/k8s/base/observability/prometheus-rules-kafka-health.yaml`
  - L50: `# Emitted by kafka-ca-exporter (off-campus-housing-tracker) — scraped via housing-pods job when pod has prometheus.io/* annotations.`
- `kafka-kraft-3broker-chaos-suite-bundle/infra/k8s/kafka-certs/README.md`
  - L24: `HOUSING_NS=off-campus-housing-tracker bash scripts/verify-kafka-tls-sans.sh`
  - L51: `kubectl -n off-campus-housing-tracker wait --for=condition=complete job/kafka-tls-preflight --timeout=120s`
  - L52: `kubectl -n off-campus-housing-tracker logs job/kafka-tls-preflight`
  - L55: `Delete the job before re-running: `kubectl -n off-campus-housing-tracker delete job kafka-tls-preflight`.`
- `kafka-kraft-3broker-chaos-suite-bundle/infra/k8s/kafka-certs/certificates/kafka-0-cert.yaml`
  - L6: `namespace: off-campus-housing-tracker`
  - L15: `- kafka-0.kafka.off-campus-housing-tracker.svc`
  - L16: `- kafka-0.kafka.off-campus-housing-tracker.svc.cluster.local`
  - L17: `- kafka-0-external.off-campus-housing-tracker.svc.cluster.local`
- `kafka-kraft-3broker-chaos-suite-bundle/infra/k8s/kafka-certs/certificates/kafka-1-cert.yaml`
  - L6: `namespace: off-campus-housing-tracker`
  - L15: `- kafka-1.kafka.off-campus-housing-tracker.svc`
  - L16: `- kafka-1.kafka.off-campus-housing-tracker.svc.cluster.local`
  - L17: `- kafka-1-external.off-campus-housing-tracker.svc.cluster.local`
- `kafka-kraft-3broker-chaos-suite-bundle/infra/k8s/kafka-certs/certificates/kafka-2-cert.yaml`
  - L6: `namespace: off-campus-housing-tracker`
  - L15: `- kafka-2.kafka.off-campus-housing-tracker.svc`
  - L16: `- kafka-2.kafka.off-campus-housing-tracker.svc.cluster.local`
  - L17: `- kafka-2-external.off-campus-housing-tracker.svc.cluster.local`
- `kafka-kraft-3broker-chaos-suite-bundle/infra/k8s/kafka-certs/kafka-tls-preflight-job.yaml`
  - L4: `#   kubectl -n off-campus-housing-tracker wait --for=condition=complete job/kafka-tls-preflight --timeout=120s`
  - L9: `namespace: off-campus-housing-tracker`
  - L25: `NS="off-campus-housing-tracker"`
- `kafka-kraft-3broker-chaos-suite-bundle/infra/k8s/kafka-kraft-metallb/external-services.yaml`
  - L11: `namespace: off-campus-housing-tracker`
  - L26: `namespace: off-campus-housing-tracker`
  - L41: `namespace: off-campus-housing-tracker`
- `kafka-kraft-3broker-chaos-suite-bundle/infra/k8s/kafka-kraft-metallb/headless-service.yaml`
  - L5: `namespace: off-campus-housing-tracker`
- `kafka-kraft-3broker-chaos-suite-bundle/infra/k8s/kafka-kraft-metallb/kafka-metallb-alignment-exporter.yaml`
  - L7: `namespace: off-campus-housing-tracker`
  - L13: `namespace: off-campus-housing-tracker`
  - L29: `namespace: off-campus-housing-tracker`
  - L37: `namespace: off-campus-housing-tracker`
  - L43: `namespace: off-campus-housing-tracker`
  - L77: `- { name: HOUSING_NS, value: off-campus-housing-tracker }`
- `kafka-kraft-3broker-chaos-suite-bundle/infra/k8s/kafka-kraft-metallb/kafka-pdb.yaml`
  - L7: `namespace: off-campus-housing-tracker`
- `kafka-kraft-3broker-chaos-suite-bundle/infra/k8s/kafka-kraft-metallb/kustomization.yaml`
  - L5: `#   - Namespace off-campus-housing-tracker`
  - L34: `namespace: off-campus-housing-tracker`
- `kafka-kraft-3broker-chaos-suite-bundle/infra/k8s/kafka-kraft-metallb/rbac-kafka-svc-reader.yaml`
  - L7: `namespace: off-campus-housing-tracker`
  - L14: `namespace: off-campus-housing-tracker`
  - L26: `namespace: off-campus-housing-tracker`
  - L35: `namespace: off-campus-housing-tracker`
- `kafka-kraft-3broker-chaos-suite-bundle/infra/k8s/kafka-kraft-metallb/statefulset.yaml`
  - L12: `namespace: off-campus-housing-tracker`
  - L188: `value: "0@kafka-0.kafka.off-campus-housing-tracker.svc.cluster.local:9095,1@kafka-1.kafka.off-campus-housing-tracker.svc.cluster.local:9095,2@kafka-2.kafka.off-campus-housing-tracker.svc.cluster.lo…`
- `kafka-kraft-3broker-chaos-suite-bundle/infra/k8s/kafka-ops/kafka-alignment-cronjob.yaml`
  - L13: `namespace: off-campus-housing-tracker`
  - L19: `namespace: off-campus-housing-tracker`
  - L32: `namespace: off-campus-housing-tracker`
  - L40: `namespace: off-campus-housing-tracker`
  - L46: `namespace: off-campus-housing-tracker`
  - L70: `value: off-campus-housing-tracker`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/apply-kafka-kraft-staged.sh`
  - L11: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/chaos-kafka-alignment-stochastic.sh`
  - L10: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/chaos-kafka-partition.sh`
  - L10: `NS="${CHAOS_KAFKA_NS:-off-campus-housing-tracker}"`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/chaos-latency.sh`
  - L9: `NS="${CHAOS_LATENCY_NS:-off-campus-housing-tracker}"`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/chaos-metallb-kafka-lb.sh`
  - L6: `# Env: HOUSING_NS (default off-campus-housing-tracker)`
  - L13: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/check-kafka-config-drift.sh`
  - L12: `NS="${1:-${HOUSING_NS:-off-campus-housing-tracker}}"`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/dev-generate-certs.sh`
  - L3: `# Output: certs/dev-root.pem, certs/dev-root.key; certs/off-campus-housing.test.{crt,key} (Caddy/ingress);`
  - L38: `-out "$CERTS/dev-root.pem" -subj "/CN=dev-root-ca/O=off-campus-housing-dev" 2>/dev/null`
  - L47: `# 2. Caddy/ingress leaf (off-campus-housing.test) — required for strict-tls-bootstrap.sh and rollout-caddy.sh`
  - L48: `say "2. Creating Caddy leaf (off-campus-housing.test)..."`
  - L49: `HOST="${HOST:-off-campus-housing.test}"`
  - L50: `if [[ ! -f "$CERTS/off-campus-housing.test.crt" ]] || [[ ! -f "$CERTS/off-campus-housing.test.key" ]]; then`
  - L51: `openssl genrsa -out "$CERTS/off-campus-housing.test.key" 2048 2>/dev/null`
  - L52: `openssl req -new -key "$CERTS/off-campus-housing.test.key" -out "$TMP/leaf.csr" \`
  - L53: `-subj "/CN=${HOST}/O=off-campus-housing-tracker" 2>/dev/null`
  - L58: `-CAcreateserial -out "$CERTS/off-campus-housing.test.crt" -days "$DAYS" \`
  - L60: `ok "off-campus-housing.test.crt, .key (for Caddy TLS)"`
  - L62: `ok "off-campus-housing.test.crt|.key already exist"`
  - L69: `-subj "/CN=messaging-service/O=off-campus-housing-dev" 2>/dev/null`
  - L78: `-subj "/CN=media-service/O=off-campus-housing-dev" 2>/dev/null`
  - L88: `-subj "/CN=kafka-client/O=off-campus-housing-dev" 2>/dev/null`
  - … *2 more in this file*
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/gen-kafka-cert-crds.sh`
  - L14: `NS="${NAMESPACE:-off-campus-housing-tracker}"`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/kafka-after-rollout-verify-brokers.sh`
  - L7: `#   HOUSING_NS=off-campus-housing-tracker KAFKA_BROKER_REPLICAS=3 ./scripts/kafka-after-rollout-verify-brokers.sh`
  - L13: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/kafka-auto-heal-inter-broker-tls.sh`
  - L6: `#   HOUSING_NS=off-campus-housing-tracker KAFKA_BROKER_REPLICAS=3 ./scripts/kafka-auto-heal-inter-broker-tls.sh`
  - L13: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/kafka-refresh-tls-from-lb.sh`
  - L15: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/kafka-rolling-restart.sh`
  - L12: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/kafka-runtime-sync.sh`
  - L44: `NS="${POS_NS:-${HOUSING_NS:-off-campus-housing-tracker}}"`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/kafka-ssl-from-dev-root.sh`
  - L4: `# Output: certs/kafka-ssl/*.jks, *.p12, passwords; creates kafka-ssl-secret in off-campus-housing-tracker`
  - L8: `#   KAFKA_SSL_NS=off-campus-housing-tracker  — namespace for kafka-ssl-secret`
  - L22: `NS="${KAFKA_SSL_NS:-off-campus-housing-tracker}"`
  - L82: `-subj "/CN=${CN}/O=off-campus-housing-tracker" 2>/dev/null`
  - L134: `-subj "/CN=kafka-client/O=off-campus-housing-tracker" 2>/dev/null`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/kafka-sync-metallb.sh`
  - L13: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/kafka-tls-guard.sh`
  - L8: `#   HOUSING_NS — default off-campus-housing-tracker`
  - L18: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/lib/kafka-kraft-quorum-ok.sh`
  - L8: `local NS="${1:-${HOUSING_NS:-off-campus-housing-tracker}}"`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/package-kafka-kraft-3broker-chaos-bundle.sh`
  - L149: `• Namespace off-campus-housing-tracker (see infra/k8s/base/namespaces.yaml) or set HOUSING_NS consistently`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/patch-kafka-external-metallb-pinned-ips.sh`
  - L9: `#   METALLB_POOL=192.168.64.240-192.168.64.250 HOUSING_NS=off-campus-housing-tracker ./scripts/patch-kafka-external-metallb-pinned-ips.sh`
  - L24: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/run-chaos-suite.sh`
  - L21: `if kubectl get ns off-campus-housing-tracker >/dev/null 2>&1; then`
  - L28: `if [[ -f "$REPO_ROOT/scripts/verify-kafka-cluster.sh" ]] && kubectl get ns off-campus-housing-tracker >/dev/null 2>&1; then`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/tests/kafka-alignment-suite.sh`
  - L30: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/validate-kafka-dns.sh`
  - L6: `NAMESPACE="${KAFKA_NAMESPACE:-off-campus-housing-tracker}"`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/validate-kafka-stack-contract.sh`
  - L14: `#   KAFKA_CONTRACT_K8S_NS — default off-campus-housing-tracker`
  - L122: `_kns="${KAFKA_CONTRACT_K8S_NS:-off-campus-housing-tracker}"`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/verify-kafka-cluster.sh`
  - L44: `NS="${1:-${HOUSING_NS:-off-campus-housing-tracker}}"`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/verify-kafka-kraft-advertised-listeners.sh`
  - L15: `NS="${1:-${HOUSING_NS:-off-campus-housing-tracker}}"`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/verify-kafka-metallb-pin-formula.sh`
  - L48: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/verify-kafka-no-static-advertised-env.sh`
  - L14: `NS="${1:-${HOUSING_NS:-off-campus-housing-tracker}}"`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/verify-kafka-tls-sans.sh`
  - L16: `NS="${1:-${HOUSING_NS:-off-campus-housing-tracker}}"`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/wait-for-kafka-external-lb-ips.sh`
  - L6: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`

## SNI / hostnames

*Hosts, URLs, and dotted domains*

**Hits:** 12 (capped per file in scanner)

- `kafka-kraft-3broker-chaos-suite-bundle/certs/README.txt`
  - L18: `Expected artifacts (local only): `dev-root.pem`, `dev-root.key`, `off-campus-housing.test.{crt,key}`,`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/dev-generate-certs.sh`
  - L3: `# Output: certs/dev-root.pem, certs/dev-root.key; certs/off-campus-housing.test.{crt,key} (Caddy/ingress);`
  - L47: `# 2. Caddy/ingress leaf (off-campus-housing.test) — required for strict-tls-bootstrap.sh and rollout-caddy.sh`
  - L48: `say "2. Creating Caddy leaf (off-campus-housing.test)..."`
  - L49: `HOST="${HOST:-off-campus-housing.test}"`
  - L50: `if [[ ! -f "$CERTS/off-campus-housing.test.crt" ]] || [[ ! -f "$CERTS/off-campus-housing.test.key" ]]; then`
  - L51: `openssl genrsa -out "$CERTS/off-campus-housing.test.key" 2048 2>/dev/null`
  - L52: `openssl req -new -key "$CERTS/off-campus-housing.test.key" -out "$TMP/leaf.csr" \`
  - L58: `-CAcreateserial -out "$CERTS/off-campus-housing.test.crt" -days "$DAYS" \`
  - L60: `ok "off-campus-housing.test.crt, .key (for Caddy TLS)"`
  - L62: `ok "off-campus-housing.test.crt|.key already exist"`
  - L151: `echo "  Caddy/ingress: certs/off-campus-housing.test.crt, certs/off-campus-housing.test.key"`

## OCH-prefixed identifiers

*Secrets, services, env keys with och- / och_*

**Hits:** 64 (capped per file in scanner)

- `kafka-kraft-3broker-chaos-suite-bundle/infra/k8s/kafka-certs/README.md`
  - L47: `After Kafka and `och-kafka-ssl-secret` exist:`
- `kafka-kraft-3broker-chaos-suite-bundle/infra/k8s/kafka-certs/kafka-tls-preflight-job.yaml`
  - L2: `# Apply after Kafka + och-kafka-ssl-secret exist:`
  - L52: `secretName: och-kafka-ssl-secret`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/kafka-refresh-tls-from-lb.sh`
  - L2: `# Regenerate kafka-ssl-secret (and och-kafka-ssl-secret) with SANs that include current`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/kafka-rolling-restart.sh`
  - L36: `if ! och_kafka_kraft_quorum_ok "$NS"; then`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/kafka-ssl-from-dev-root.sh`
  - L63: `_auto_extra="$(och_kafka_metallb_external_lb_ips_csv "$NS" "$REPLICAS")"`
  - L75: `KAFKA_SANS="$(och_kafka_subject_alt_name_openssl_value "$NS" "$REPLICAS" "${KAFKA_SSL_EXTRA_IP_SANS:-}")"`
  - L193: `say "4b. Creating och-kafka-ssl-secret (same client material; Deployments mount och-kafka-ssl-secret)…"`
  - L194: `_och_kafka_yaml="${TMP}/och-kafka-ssl-secret.yaml"`
  - L195: `kubectl create secret generic och-kafka-ssl-secret -n "$NS" \`
  - L201: `ok "och-kafka-ssl-secret created/updated"`
  - L203: `colima ssh -- env KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl apply -f "$_och_kafka_yaml" --request-timeout=20s 2>/dev/null && ok "och-kafka-ssl-secret (via colima ssh)" || warn "och-kafka-ssl-sec…`
  - L205: `warn "och-kafka-ssl-secret apply failed"`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/kafka-tls-guard.sh`
  - L3: `# och-kafka secret, logs, verify-kafka-cluster.`
  - L13: `#     skip 5b–6 (service-tls / och-kafka / annotation) and step 8 (verify-cluster)`
  - L165: `say "POST_ROLLOUT_ONLY=1 — skipping service-tls / och-kafka / annotation gates (use full kafka-tls-guard for those)"`
  - L216: `say "6) och-kafka-ssl-secret CA vs kafka-ssl-secret"`
  - L217: `if kubectl get secret och-kafka-ssl-secret -n "$NS" --request-timeout=15s >/dev/null 2>&1; then`
  - L218: `kubectl get secret och-kafka-ssl-secret -n "$NS" -o jsonpath='{.data.ca-cert\.pem}' --request-timeout=25s | base64 -d >"$TMP/service-ca.pem"`
  - L221: `bad "CA fingerprint mismatch kafka-ssl-secret vs och-kafka-ssl-secret (run: make kafka-refresh-tls-from-lb)"`
  - L226: `echo "   ℹ️  och-kafka-ssl-secret absent — skipped"`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/lib/kafka-broker-sans.sh`
  - L9: `och_kafka_kubectl() {`
  - L18: `och_kafka_metallb_external_lb_ips_lines() {`
  - L21: `_ip="$(och_kafka_kubectl get svc "kafka-${i}-external" -n "$ns" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"`
  - L29: `och_kafka_metallb_external_lb_ips_csv() {`
  - L38: `done < <(och_kafka_metallb_external_lb_ips_lines "$1" "$2")`
  - L44: `och_kafka_subject_alt_name_openssl_value() {`
  - L75: `och_kafka_emit_san_verify_dns_specs() {`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/lib/kafka-kraft-quorum-ok.sh`
  - L3: `# Usage: source this file and call och_kafka_kraft_quorum_ok [namespace]`
  - L7: `och_kafka_kraft_quorum_ok() {`
  - L20: `PROP=/tmp/och-kafka-quorum-gate.props`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/lib/kafka-metallb-pin-formula.sh`
  - L15: `och_kafka_metallb_add_last_octet() {`
  - L28: `och_kafka_metallb_expected_ip_for_broker() {`
  - L31: `first="$(och_metallb_pool_first_ip "$pool")" || return 1`
  - L32: `och_kafka_metallb_add_last_octet "$first" $((offset + broker_index))`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/patch-kafka-external-metallb-pinned-ips.sh`
  - L44: `och_metallb_pool_first_ip "$POOL" >/dev/null || {`
  - L63: `IPS[i]="$(och_kafka_metallb_expected_ip_for_broker "$POOL" "$OFFSET" "$i")" || exit 1`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/validate-kafka-stack-contract.sh`
  - L6: `#   REPO_ROOT, ENV_PREFIX (default dev), OCH_KAFKA_TOPIC_SUFFIX (optional)`
  - L10: `#   OCH_KAFKA_REQUIRE_QUORUM_3=1 — same as KAFKA_CONTRACT_MIN_BROKERS=3 (k8s KRaft / production gate)`
  - L32: `[[ "${OCH_KAFKA_REQUIRE_QUORUM_3:-0}" == "1" ]] && _req_brokers=3`
  - L67: `# --- Static: no OCH_KAFKA_DISABLED in TS sources`
  - L69: `fail "OCH_KAFKA_DISABLED must not appear in services/scripts TypeScript"`
  - L71: `pass "No OCH_KAFKA_DISABLED in TS sources"`
  - L149: `[[ "${OCH_KAFKA_REQUIRE_QUORUM_3:-0}" == "1" ]] && [[ "$_k8s_min_brokers" -eq 0 ]] && _k8s_min_brokers=3`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/verify-kafka-cluster.sh`
  - L16: `#   Compares SHA-256 fingerprints of ca-cert.pem in kafka-ssl-secret vs och-kafka-ssl-secret.`
  - L18: `#   VERIFY_KAFKA_CHECK_CLIENT_DEPLOY_MOUNTS=1 — require listed Deployments to reference och-kafka-ssl-secret (after deploy-dev).`
  - L77: `if ! kubectl get deploy "$_d" -n "$NS" -o yaml --request-timeout=25s | grep -q "secretName: och-kafka-ssl-secret"; then`
  - L78: `bad "Deployment $_d does not mount secret och-kafka-ssl-secret"`
  - L81: `ok "Deployment $_d references och-kafka-ssl-secret"`
  - L162: `say "Phase 6a2c6 — CA fingerprint consistency (kafka-ssl-secret vs och-kafka-ssl-secret) + broker chain"`
  - L167: `kubectl get secret och-kafka-ssl-secret -n "$NS" -o jsonpath='{.data.ca-cert\.pem}' --request-timeout=25s | base64 -d >"$_tmp/service-ca.pem"`
  - L170: `bad "Missing ca-cert.pem or kafka-broker.pem in secrets (kafka-ssl-secret / och-kafka-ssl-secret)"`
  - L176: `bad "CA fingerprint mismatch — broker secret vs och-kafka-ssl-secret (Node clients will reject broker TLS)"`
  - L178: `echo "   och-kafka-ssl-secret ca: ${_sfp:-?}" >&2`
  - L212: `say "Phase 6a2c6b — Deployments must reference och-kafka-ssl-secret"`
  - L221: `if ! kubectl get deploy "$_d" -n "$NS" -o yaml --request-timeout=25s | grep -q "secretName: och-kafka-ssl-secret"; then`
  - L222: `bad "Deployment $_d does not mount secret och-kafka-ssl-secret"`
  - L225: `ok "Deployment $_d references och-kafka-ssl-secret"`
  - L249: `PROP=/tmp/och-kafka-ritual-quorum.props`
  - … *1 more in this file*
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/verify-kafka-metallb-pin-formula.sh`
  - L22: `got="$(och_kafka_metallb_expected_ip_for_broker "$pool" "$off" "$i")" || {`
  - L56: `want="$(och_kafka_metallb_expected_ip_for_broker "$POOL" "$OFF" "$i")"`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/verify-kafka-tls-sans.sh`
  - L104: `done < <(och_kafka_emit_san_verify_dns_specs "$NS" "$REPLICAS")`
  - L120: `done < <(och_kafka_metallb_external_lb_ips_lines "$NS" "$REPLICAS")`

## K8s `namespace:` lines (YAML)

*Raw namespace: declarations*

**Hits:** 25 (capped per file in scanner)

- `kafka-kraft-3broker-chaos-suite-bundle/infra/k8s/kafka-certs/certificates/kafka-0-cert.yaml`
  - L6: `namespace: off-campus-housing-tracker`
- `kafka-kraft-3broker-chaos-suite-bundle/infra/k8s/kafka-certs/certificates/kafka-1-cert.yaml`
  - L6: `namespace: off-campus-housing-tracker`
- `kafka-kraft-3broker-chaos-suite-bundle/infra/k8s/kafka-certs/certificates/kafka-2-cert.yaml`
  - L6: `namespace: off-campus-housing-tracker`
- `kafka-kraft-3broker-chaos-suite-bundle/infra/k8s/kafka-certs/kafka-tls-preflight-job.yaml`
  - L9: `namespace: off-campus-housing-tracker`
- `kafka-kraft-3broker-chaos-suite-bundle/infra/k8s/kafka-kraft-metallb/external-services.yaml`
  - L11: `namespace: off-campus-housing-tracker`
  - L26: `namespace: off-campus-housing-tracker`
  - L41: `namespace: off-campus-housing-tracker`
- `kafka-kraft-3broker-chaos-suite-bundle/infra/k8s/kafka-kraft-metallb/headless-service.yaml`
  - L5: `namespace: off-campus-housing-tracker`
- `kafka-kraft-3broker-chaos-suite-bundle/infra/k8s/kafka-kraft-metallb/kafka-metallb-alignment-exporter.yaml`
  - L7: `namespace: off-campus-housing-tracker`
  - L13: `namespace: off-campus-housing-tracker`
  - L29: `namespace: off-campus-housing-tracker`
  - L37: `namespace: off-campus-housing-tracker`
  - L43: `namespace: off-campus-housing-tracker`
- `kafka-kraft-3broker-chaos-suite-bundle/infra/k8s/kafka-kraft-metallb/kafka-pdb.yaml`
  - L7: `namespace: off-campus-housing-tracker`
- `kafka-kraft-3broker-chaos-suite-bundle/infra/k8s/kafka-kraft-metallb/kustomization.yaml`
  - L34: `namespace: off-campus-housing-tracker`
- `kafka-kraft-3broker-chaos-suite-bundle/infra/k8s/kafka-kraft-metallb/rbac-kafka-svc-reader.yaml`
  - L7: `namespace: off-campus-housing-tracker`
  - L14: `namespace: off-campus-housing-tracker`
  - L26: `namespace: off-campus-housing-tracker`
  - L35: `namespace: off-campus-housing-tracker`
- `kafka-kraft-3broker-chaos-suite-bundle/infra/k8s/kafka-kraft-metallb/statefulset.yaml`
  - L12: `namespace: off-campus-housing-tracker`
- `kafka-kraft-3broker-chaos-suite-bundle/infra/k8s/kafka-ops/kafka-alignment-cronjob.yaml`
  - L13: `namespace: off-campus-housing-tracker`
  - L19: `namespace: off-campus-housing-tracker`
  - L32: `namespace: off-campus-housing-tracker`
  - L40: `namespace: off-campus-housing-tracker`
  - L46: `namespace: off-campus-housing-tracker`

## Cert / SAN hints

*x509-ish strings mentioning OCH hosts*

**Hits:** 8 (capped per file in scanner)

- `kafka-kraft-3broker-chaos-suite-bundle/scripts/dev-generate-certs.sh`
  - L38: `-out "$CERTS/dev-root.pem" -subj "/CN=dev-root-ca/O=off-campus-housing-dev" 2>/dev/null`
  - L53: `-subj "/CN=${HOST}/O=off-campus-housing-tracker" 2>/dev/null`
  - L69: `-subj "/CN=messaging-service/O=off-campus-housing-dev" 2>/dev/null`
  - L78: `-subj "/CN=media-service/O=off-campus-housing-dev" 2>/dev/null`
  - L88: `-subj "/CN=kafka-client/O=off-campus-housing-dev" 2>/dev/null`
  - L105: `-subj "/CN=kafka/O=off-campus-housing-dev" 2>/dev/null`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/kafka-ssl-from-dev-root.sh`
  - L82: `-subj "/CN=${CN}/O=off-campus-housing-tracker" 2>/dev/null`
  - L134: `-subj "/CN=kafka-client/O=off-campus-housing-tracker" 2>/dev/null`

## Hardcoded gateway / legacy ports

*4020-style ports (RP api-gateway default is :4000)*

*None found in scanned text files.*

## HOUSING / legacy env

*Environment variables and assignments*

**Hits:** 67 (capped per file in scanner)

- `kafka-kraft-3broker-chaos-suite-bundle/infra/k8s/kafka-certs/README.md`
  - L24: `HOUSING_NS=off-campus-housing-tracker bash scripts/verify-kafka-tls-sans.sh`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/apply-kafka-kraft-staged.sh`
  - L11: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
  - L36: `METALLB_POOL="${METALLB_POOL:-192.168.64.240-192.168.64.250}" HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$R" \`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/chaos-kafka-alignment-stochastic.sh`
  - L10: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
  - L50: `HOUSING_NS="$NS" bash "$SCRIPT_DIR/kafka-refresh-tls-from-lb.sh"`
  - L58: `HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$SCRIPT_DIR/kafka-runtime-sync.sh" --check-only "$NS" "$REP"`
  - L63: `HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$SCRIPT_DIR/kafka-runtime-sync.sh" --remediate "$NS" "$REP"`
  - L66: `HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$SCRIPT_DIR/kafka-runtime-sync.sh" --check-only "$NS" "$REP"`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/chaos-metallb-kafka-lb.sh`
  - L13: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/check-kafka-config-drift.sh`
  - L12: `NS="${1:-${HOUSING_NS:-off-campus-housing-tracker}}"`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/kafka-after-rollout-verify-brokers.sh`
  - L7: `#   HOUSING_NS=off-campus-housing-tracker KAFKA_BROKER_REPLICAS=3 ./scripts/kafka-after-rollout-verify-brokers.sh`
  - L13: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
  - L36: `HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" \`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/kafka-auto-heal-inter-broker-tls.sh`
  - L6: `#   HOUSING_NS=off-campus-housing-tracker KAFKA_BROKER_REPLICAS=3 ./scripts/kafka-auto-heal-inter-broker-tls.sh`
  - L13: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
  - L29: `HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$SCRIPT_DIR/kafka-after-rollout-verify-brokers.sh"`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/kafka-refresh-tls-from-lb.sh`
  - L15: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
  - L17: `export HOUSING_NS="$NS"`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/kafka-rolling-restart.sh`
  - L12: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
  - L45: `HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$R" bash "$SCRIPT_DIR/verify-kafka-cluster.sh" "$NS" "$R"`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/kafka-runtime-sync.sh`
  - L44: `NS="${POS_NS:-${HOUSING_NS:-off-campus-housing-tracker}}"`
  - L48: `export HOUSING_NS="$NS"`
  - L58: `export HOUSING_NS="$NS"`
  - L105: `METALLB_POOL="${METALLB_POOL:-192.168.64.240-192.168.64.250}" HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" \`
  - L108: `HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$SCRIPT_DIR/kafka-refresh-tls-from-lb.sh"`
  - L126: `HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$SCRIPT_DIR/kafka-after-rollout-verify-brokers.sh" || {`
  - L132: `if ! HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$SCRIPT_DIR/kafka-runtime-sync.sh" --check-only "$NS" "$REP"; then`
  - L146: `HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" \`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/kafka-sync-metallb.sh`
  - L13: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
  - L26: `METALLB_POOL="${METALLB_POOL:-192.168.64.240-192.168.64.250}" HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" \`
  - L29: `HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$SCRIPT_DIR/kafka-auto-heal-inter-broker-tls.sh" || exit 1`
  - L32: `if HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$SCRIPT_DIR/kafka-runtime-sync.sh" --check-only --quiet "$NS" "$REP"; then`
  - L42: `HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" \`
  - L54: `HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$SCRIPT_DIR/kafka-refresh-tls-from-lb.sh"`
  - L68: `HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$SCRIPT_DIR/kafka-after-rollout-verify-brokers.sh" || exit 1`
  - L78: `HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" \`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/kafka-tls-guard.sh`
  - L18: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/lib/kafka-kraft-quorum-ok.sh`
  - L8: `local NS="${1:-${HOUSING_NS:-off-campus-housing-tracker}}"`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/patch-kafka-external-metallb-pinned-ips.sh`
  - L9: `#   METALLB_POOL=192.168.64.240-192.168.64.250 HOUSING_NS=off-campus-housing-tracker ./scripts/patch-kafka-external-metallb-pinned-ips.sh`
  - L24: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/tests/kafka-alignment-suite.sh`
  - L30: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
  - L119: `HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$REPO_ROOT/scripts/kafka-runtime-sync.sh" --check-only "$NS" "$REP" \`
  - L128: `HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" \`
  - L143: `if ! HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$REPO_ROOT/scripts/kafka-runtime-sync.sh" --remediate "$NS" "$REP"; then`
  - L160: `HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$REPO_ROOT/scripts/kafka-runtime-sync.sh" --check-only "$NS" "$REP" \`
  - L169: `HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" \`
  - L214: `HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$REPO_ROOT/scripts/kafka-runtime-sync.sh" --check-only --quiet "$NS" "$REP"`
  - L222: `if ! HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$REPO_ROOT/scripts/kafka-runtime-sync.sh" --remediate "$NS" "$REP"; then`
  - L238: `HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$REPO_ROOT/scripts/kafka-after-rollout-verify-brokers.sh" || {`
  - L247: `HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$REPO_ROOT/scripts/kafka-runtime-sync.sh" --check-only "$NS" "$REP"`
  - L258: `HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" \`
  - L260: `&& HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$REPO_ROOT/scripts/kafka-runtime-sync.sh" --check-only "$NS" "$REP"`
  - L274: `if ! HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$REPO_ROOT/scripts/kafka-runtime-sync.sh" --remediate "$NS" "$REP"; then`
  - L315: `HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$REPO_ROOT/scripts/kafka-runtime-sync.sh" --check-only "$NS" "$REP"`
  - L338: `if ! HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$REPO_ROOT/scripts/kafka-runtime-sync.sh" --remediate "$NS" "$REP"; then`
  - … *4 more in this file*
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/verify-kafka-cluster.sh`
  - L44: `NS="${1:-${HOUSING_NS:-off-campus-housing-tracker}}"`
  - L146: `HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REPLICAS" bash "$SCRIPT_DIR/verify-kafka-tls-sans.sh" "$NS" "$REPLICAS"`
  - L155: `HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REPLICAS" bash "$SCRIPT_DIR/verify-kafka-kraft-advertised-listeners.sh" "$NS" "$REPLICAS"`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/verify-kafka-kraft-advertised-listeners.sh`
  - L15: `NS="${1:-${HOUSING_NS:-off-campus-housing-tracker}}"`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/verify-kafka-metallb-pin-formula.sh`
  - L48: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/verify-kafka-no-static-advertised-env.sh`
  - L14: `NS="${1:-${HOUSING_NS:-off-campus-housing-tracker}}"`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/verify-kafka-tls-sans.sh`
  - L16: `NS="${1:-${HOUSING_NS:-off-campus-housing-tracker}}"`
- `kafka-kraft-3broker-chaos-suite-bundle/scripts/wait-for-kafka-external-lb-ips.sh`
  - L6: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`

---

## Summary

Apply **`docs/bundles/OCH_TO_RP_CONVERSION_MATRIX.md`** when porting; prefer surgical patches over bulk replace.
