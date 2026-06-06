# OCH → RP rewrite scan: `record-platform-kafka-metallb-tls-reference-20260409`

**Staging (read-only scan):** `/Users/tom/bundle-staging/record-platform-kafka-metallb-tls-reference-20260409`

This report lists **detected** OCH-era strings. It does **not** apply edits.

---

## Namespace references

*Kubernetes / config namespace strings*

**Hits:** 124 (capped per file in scanner)

- `record-platform-kafka-metallb-tls-reference-20260409/.github/workflows/kafka-alignment.yml`
  - L134: `if kubectl get statefulset kafka -n off-campus-housing-tracker --request-timeout=15s >/dev/null 2>&1; then`
  - L137: `echo "No statefulset/kafka in off-campus-housing-tracker — alignment suite not exercised (expected on fresh k3s)."`
- `record-platform-kafka-metallb-tls-reference-20260409/README-BUNDLE.md`
  - L3: `**Source:** Snapshot from the Off-Campus-Housing-Tracker engineering patterns (local Colima/k3s + production-shaped Kafka).`
  - L5: `**Not a drop-in product:** Paths, namespaces (`off-campus-housing-tracker`), hostnames (`off-campus-housing.test`), and proto-driven topic lists are **OCH-specific**. Adapt `HOUSING_NS`, `KAFKA_SSL…`
  - L37: `Follow the license of the upstream Off-Campus-Housing-Tracker repository; this bundle is a curated excerpt for reuse.`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/kafka-ca-exporter/configmap.yaml`
  - L5: `namespace: off-campus-housing-tracker`
  - L19: `NS = os.environ.get("HOUSING_NS", "off-campus-housing-tracker")`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/kafka-ca-exporter/deployment.yaml`
  - L5: `namespace: off-campus-housing-tracker`
  - L34: `value: off-campus-housing-tracker`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/kafka-ca-exporter/rbac.yaml`
  - L5: `namespace: off-campus-housing-tracker`
  - L13: `namespace: off-campus-housing-tracker`
  - L24: `namespace: off-campus-housing-tracker`
  - L32: `namespace: off-campus-housing-tracker`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/kafka-ca-exporter/service.yaml`
  - L5: `namespace: off-campus-housing-tracker`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/kafka-external/external-service.yaml`
  - L12: `namespace: off-campus-housing-tracker`
  - L25: `namespace: off-campus-housing-tracker`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/kafka/deploy.yaml`
  - L5: `namespace: off-campus-housing-tracker`
  - L50: `- { name: KAFKA_CLUSTER_ID, value: "off-campus-housing-tracker-kafka-cluster" }`
  - L53: `- { name: KAFKA_ADVERTISED_LISTENERS, value: "PLAINTEXT://kafka.off-campus-housing-tracker.svc.cluster.local:9092,SSL://kafka.off-campus-housing-tracker.svc.cluster.local:9093,PLAINTEXT_HOST://kafk…`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/kafka/external-service.yaml`
  - L7: `namespace: off-campus-housing-tracker`
  - L20: `namespace: off-campus-housing-tracker`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/kafka/service.yaml`
  - L5: `namespace: off-campus-housing-tracker`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/observability/prometheus-rules-kafka-health.yaml`
  - L50: `# Emitted by kafka-ca-exporter (off-campus-housing-tracker) — scraped via housing-pods job when pod has prometheus.io/* annotations.`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-certs/README.md`
  - L24: `HOUSING_NS=off-campus-housing-tracker bash scripts/verify-kafka-tls-sans.sh`
  - L51: `kubectl -n off-campus-housing-tracker wait --for=condition=complete job/kafka-tls-preflight --timeout=120s`
  - L52: `kubectl -n off-campus-housing-tracker logs job/kafka-tls-preflight`
  - L55: `Delete the job before re-running: `kubectl -n off-campus-housing-tracker delete job kafka-tls-preflight`.`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-certs/certificates/kafka-0-cert.yaml`
  - L6: `namespace: off-campus-housing-tracker`
  - L15: `- kafka-0.kafka.off-campus-housing-tracker.svc`
  - L16: `- kafka-0.kafka.off-campus-housing-tracker.svc.cluster.local`
  - L17: `- kafka-0-external.off-campus-housing-tracker.svc.cluster.local`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-certs/certificates/kafka-1-cert.yaml`
  - L6: `namespace: off-campus-housing-tracker`
  - L15: `- kafka-1.kafka.off-campus-housing-tracker.svc`
  - L16: `- kafka-1.kafka.off-campus-housing-tracker.svc.cluster.local`
  - L17: `- kafka-1-external.off-campus-housing-tracker.svc.cluster.local`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-certs/certificates/kafka-2-cert.yaml`
  - L6: `namespace: off-campus-housing-tracker`
  - L15: `- kafka-2.kafka.off-campus-housing-tracker.svc`
  - L16: `- kafka-2.kafka.off-campus-housing-tracker.svc.cluster.local`
  - L17: `- kafka-2-external.off-campus-housing-tracker.svc.cluster.local`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-certs/kafka-tls-preflight-job.yaml`
  - L4: `#   kubectl -n off-campus-housing-tracker wait --for=condition=complete job/kafka-tls-preflight --timeout=120s`
  - L9: `namespace: off-campus-housing-tracker`
  - L25: `NS="off-campus-housing-tracker"`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-kraft-metallb/external-services.yaml`
  - L8: `namespace: off-campus-housing-tracker`
  - L23: `namespace: off-campus-housing-tracker`
  - L38: `namespace: off-campus-housing-tracker`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-kraft-metallb/headless-service.yaml`
  - L5: `namespace: off-campus-housing-tracker`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-kraft-metallb/kafka-metallb-alignment-exporter.yaml`
  - L7: `namespace: off-campus-housing-tracker`
  - L13: `namespace: off-campus-housing-tracker`
  - L29: `namespace: off-campus-housing-tracker`
  - L37: `namespace: off-campus-housing-tracker`
  - L43: `namespace: off-campus-housing-tracker`
  - L77: `- { name: HOUSING_NS, value: off-campus-housing-tracker }`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-kraft-metallb/kafka-pdb.yaml`
  - L7: `namespace: off-campus-housing-tracker`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-kraft-metallb/kustomization.yaml`
  - L5: `#   - Namespace off-campus-housing-tracker`
  - L33: `namespace: off-campus-housing-tracker`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-kraft-metallb/rbac-kafka-svc-reader.yaml`
  - L7: `namespace: off-campus-housing-tracker`
  - L14: `namespace: off-campus-housing-tracker`
  - L26: `namespace: off-campus-housing-tracker`
  - L35: `namespace: off-campus-housing-tracker`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-kraft-metallb/statefulset.yaml`
  - L12: `namespace: off-campus-housing-tracker`
  - L188: `value: "0@kafka-0.kafka.off-campus-housing-tracker.svc.cluster.local:9095,1@kafka-1.kafka.off-campus-housing-tracker.svc.cluster.local:9095,2@kafka-2.kafka.off-campus-housing-tracker.svc.cluster.lo…`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/metallb/bgpadvertisement.example.yaml`
  - L1: `# BGPAdvertisement: advertise off-campus-housing-tracker-pool via BGP. Apply after BGPPeer.`
  - L5: `name: off-campus-housing-tracker-pool`
  - L9: `- off-campus-housing-tracker-pool`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/metallb/bgpadvertisement.yaml`
  - L1: `# BGPAdvertisement: advertise off-campus-housing-tracker-pool to BGP peer (FRR).`
  - L5: `name: off-campus-housing-tracker-pool`
  - L9: `- off-campus-housing-tracker-pool`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/metallb/bgppeer-frr.yaml`
  - L5: `name: off-campus-housing-tracker-frr`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/metallb/bgppeer.example.yaml`
  - L7: `name: off-campus-housing-tracker-frr`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/metallb/bgppeer.yaml`
  - L5: `name: off-campus-housing-tracker-frr`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/metallb/ipaddresspool.yaml`
  - L6: `name: off-campus-housing-tracker-pool`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/metallb/l2advertisement.yaml`
  - L1: `# L2 advertisement for off-campus-housing-tracker-pool. Optional: set nodeSelector for multi-node priority (see docs/METALLB_TRAFFIC_POLICY_AND_SCALE.md).`
  - L5: `name: off-campus-housing-tracker-l2`
  - L9: `- off-campus-housing-tracker-pool`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/apply-kafka-kraft-staged.sh`
  - L11: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/check-kafka-config-drift.sh`
  - L12: `NS="${1:-${HOUSING_NS:-off-campus-housing-tracker}}"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/ci/generate-kafka-ci-tls.sh`
  - L28: `-subj "/CN=och-kafka-ci-ca/O=off-campus-housing-ci" \`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/create-kafka-event-topics-k8s.sh`
  - L10: `#   KAFKA_K8S_NS=off-campus-housing-tracker`
  - L21: `NS="${KAFKA_K8S_NS:-off-campus-housing-tracker}"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/export-kafka-ca-metric.sh`
  - L6: `# Env: HOUSING_NS (default off-campus-housing-tracker)`
  - L9: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/kafka-after-rollout-verify-brokers.sh`
  - L7: `#   HOUSING_NS=off-campus-housing-tracker KAFKA_BROKER_REPLICAS=3 ./scripts/kafka-after-rollout-verify-brokers.sh`
  - L13: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/kafka-auto-heal-inter-broker-tls.sh`
  - L6: `#   HOUSING_NS=off-campus-housing-tracker KAFKA_BROKER_REPLICAS=3 ./scripts/kafka-auto-heal-inter-broker-tls.sh`
  - L13: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/kafka-clean-slate.sh`
  - L5: `# Env: HOUSING_NS (default off-campus-housing-tracker)`
  - L9: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/kafka-onboarding-reset.sh`
  - L5: `# Env: HOUSING_NS (default off-campus-housing-tracker)`
  - L8: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/kafka-quorum-stable.sh`
  - L6: `#   HOUSING_NS — default off-campus-housing-tracker`
  - L13: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/kafka-refresh-tls-from-lb.sh`
  - L15: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/kafka-rolling-restart.sh`
  - L12: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/kafka-runtime-sync.sh`
  - L44: `NS="${POS_NS:-${HOUSING_NS:-off-campus-housing-tracker}}"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/kafka-ssl-from-dev-root.sh`
  - L4: `# Output: certs/kafka-ssl/*.jks, *.p12, passwords; creates kafka-ssl-secret in off-campus-housing-tracker`
  - L8: `#   KAFKA_SSL_NS=off-campus-housing-tracker  — namespace for kafka-ssl-secret`
  - L22: `NS="${KAFKA_SSL_NS:-off-campus-housing-tracker}"`
  - L82: `-subj "/CN=${CN}/O=off-campus-housing-tracker" 2>/dev/null`
  - L134: `-subj "/CN=kafka-client/O=off-campus-housing-tracker" 2>/dev/null`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/kafka-sync-metallb.sh`
  - L12: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/kafka-tls-guard.sh`
  - L8: `#   HOUSING_NS — default off-campus-housing-tracker`
  - L18: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/kafka-tls-rotate-atomic.sh`
  - L10: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/lib/kafka-kraft-quorum-ok.sh`
  - L8: `local NS="${1:-${HOUSING_NS:-off-campus-housing-tracker}}"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/preflight-kafka-k8s-rollout.sh`
  - L9: `NS="${KAFKA_K8S_NS:-off-campus-housing-tracker}"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/tests/kafka-alignment-suite.sh`
  - L30: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/validate-kafka-dns.sh`
  - L6: `NAMESPACE="${KAFKA_NAMESPACE:-off-campus-housing-tracker}"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/validate-kafka-stack-contract.sh`
  - L14: `#   KAFKA_CONTRACT_K8S_NS — default off-campus-housing-tracker`
  - L122: `_kns="${KAFKA_CONTRACT_K8S_NS:-off-campus-housing-tracker}"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/verify-cluster-kafka-three-brokers.sh`
  - L4: `#   HOUSING_NS=off-campus-housing-tracker (default)`
  - L7: `HOUSING_NS="${HOUSING_NS:-off-campus-housing-tracker}"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/verify-kafka-cluster.sh`
  - L44: `NS="${1:-${HOUSING_NS:-off-campus-housing-tracker}}"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/verify-kafka-event-topic-partitions.sh`
  - L36: `_ns="${KAFKA_K8S_NS:-off-campus-housing-tracker}"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/verify-kafka-kraft-advertised-listeners.sh`
  - L15: `NS="${1:-${HOUSING_NS:-off-campus-housing-tracker}}"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/verify-kafka-kraft-e2e.sh`
  - L7: `#   KRAFT_E2E_NS=off-campus-housing-tracker`
  - L30: `NS="${KRAFT_E2E_NS:-off-campus-housing-tracker}"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/verify-kafka-no-static-advertised-env.sh`
  - L14: `NS="${1:-${HOUSING_NS:-off-campus-housing-tracker}}"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/verify-kafka-tls-sans.sh`
  - L16: `NS="${1:-${HOUSING_NS:-off-campus-housing-tracker}}"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/verify-preflight-edge-routing.sh`
  - L8: `#   HOUSING_NS, OCH_EDGE_HOSTNAME (default off-campus-housing.test)`
  - L25: `NS="${1:-${HOUSING_NS:-off-campus-housing-tracker}}"`
  - L26: `HOST="${2:-${OCH_EDGE_HOSTNAME:-off-campus-housing.test}}"`
  - L27: `ING_NAME="${EDGE_INGRESS_NAME:-off-campus-housing-tracker}"`
  - L69: `want_host = os.environ.get("_EDGE_VERIFY_HOST", "off-campus-housing.test")`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/wait-for-kafka-external-lb-ips.sh`
  - L6: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`

## SNI / hostnames

*Hosts, URLs, and dotted domains*

**Hits:** 4 (capped per file in scanner)

- `record-platform-kafka-metallb-tls-reference-20260409/README-BUNDLE.md`
  - L5: `**Not a drop-in product:** Paths, namespaces (`off-campus-housing-tracker`), hostnames (`off-campus-housing.test`), and proto-driven topic lists are **OCH-specific**. Adapt `HOUSING_NS`, `KAFKA_SSL…`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/verify-preflight-edge-routing.sh`
  - L8: `#   HOUSING_NS, OCH_EDGE_HOSTNAME (default off-campus-housing.test)`
  - L26: `HOST="${2:-${OCH_EDGE_HOSTNAME:-off-campus-housing.test}}"`
  - L69: `want_host = os.environ.get("_EDGE_VERIFY_HOST", "off-campus-housing.test")`

## OCH-prefixed identifiers

*Secrets, services, env keys with och- / och_*

**Hits:** 122 (capped per file in scanner)

- `record-platform-kafka-metallb-tls-reference-20260409/README-BUNDLE.md`
  - L5: `**Not a drop-in product:** Paths, namespaces (`off-campus-housing-tracker`), hostnames (`off-campus-housing.test`), and proto-driven topic lists are **OCH-specific**. Adapt `HOUSING_NS`, `KAFKA_SSL…`
  - L23: `- **Clients (apps):** PEM trio `ca-cert.pem`, `client.crt`, `client.key` in a separate Secret (OCH: `och-kafka-ssl-secret`) mounted at `/etc/kafka/secrets`.`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/observability/prometheus-rules-och-slo.yaml`
  - L12: `name: prometheus-rules-och-slo`
  - L18: `och-slo.yml: |`
  - L21: `- name: och-slo-recording`
  - L64: `- name: och-slo-burn-alerts`
  - L94: `- name: och-slo-violation-alerts`
  - L121: `- name: och-transport-edge`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-certs/README.md`
  - L47: `After Kafka and `och-kafka-ssl-secret` exist:`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-certs/kafka-tls-preflight-job.yaml`
  - L2: `# Apply after Kafka + och-kafka-ssl-secret exist:`
  - L52: `secretName: och-kafka-ssl-secret`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/ci/generate-kafka-ci-tls.sh`
  - L28: `-subj "/CN=och-kafka-ci-ca/O=off-campus-housing-ci" \`
  - L36: `-subj "/CN=${CN}/O=och-kafka-ci"`
  - L59: `-subj "/CN=kafka-client/O=och-kafka-ci"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/ci/start-kafka-tls-ci.sh`
  - L11: `NET="${KAFKA_CI_DOCKER_NETWORK:-och-kafka-ci-net}"`
  - L101: `} > /tmp/och-kafka-event-topics.props'`
  - L109: `--command-config /tmp/och-kafka-event-topics.props 2>/dev/null)"; then`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/create-kafka-event-topics-k8s.sh`
  - L13: `#   ENV_PREFIX, PARTITIONS, OCH_KAFKA_TOPIC_SUFFIX — same as create-kafka-event-topics.sh`
  - L39: `och_topic_suffix() {`
  - L40: `local raw="${OCH_KAFKA_TOPIC_SUFFIX:-}"`
  - L46: `SUF="$(och_topic_suffix)"`
  - L48: `# shellcheck source=lib/och-kafka-event-topics-from-proto.sh`
  - L49: `source "$SCRIPT_DIR/lib/och-kafka-event-topics-from-proto.sh"`
  - L50: `och_kafka_event_topics_fill || die "Could not build topic list from proto/events"`
  - L51: `TOPICS=("${OCH_KAFKA_EVENT_TOPICS[@]}")`
  - L66: `} > /tmp/och-k8s-topics.props'`
  - L73: `kubectl exec -n "$NS" "$KPOD" -- kafka-topics --bootstrap-server "$BS" --command-config /tmp/och-k8s-topics.props "$@"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/kafka-refresh-tls-from-lb.sh`
  - L2: `# Regenerate kafka-ssl-secret (and och-kafka-ssl-secret) with SANs that include current`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/kafka-rolling-restart.sh`
  - L36: `if ! och_kafka_kraft_quorum_ok "$NS"; then`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/kafka-ssl-from-dev-root.sh`
  - L63: `_auto_extra="$(och_kafka_metallb_external_lb_ips_csv "$NS" "$REPLICAS")"`
  - L75: `KAFKA_SANS="$(och_kafka_subject_alt_name_openssl_value "$NS" "$REPLICAS" "${KAFKA_SSL_EXTRA_IP_SANS:-}")"`
  - L193: `say "4b. Creating och-kafka-ssl-secret (same client material; Deployments mount och-kafka-ssl-secret)…"`
  - L194: `_och_kafka_yaml="${TMP}/och-kafka-ssl-secret.yaml"`
  - L195: `kubectl create secret generic och-kafka-ssl-secret -n "$NS" \`
  - L201: `ok "och-kafka-ssl-secret created/updated"`
  - L203: `colima ssh -- env KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl apply -f "$_och_kafka_yaml" --request-timeout=20s 2>/dev/null && ok "och-kafka-ssl-secret (via colima ssh)" || warn "och-kafka-ssl-sec…`
  - L205: `warn "och-kafka-ssl-secret apply failed"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/kafka-tls-guard.sh`
  - L3: `# och-kafka secret, logs, verify-kafka-cluster.`
  - L13: `#     skip 5b–6 (service-tls / och-kafka / annotation) and step 8 (verify-cluster)`
  - L165: `say "POST_ROLLOUT_ONLY=1 — skipping service-tls / och-kafka / annotation gates (use full kafka-tls-guard for those)"`
  - L216: `say "6) och-kafka-ssl-secret CA vs kafka-ssl-secret"`
  - L217: `if kubectl get secret och-kafka-ssl-secret -n "$NS" --request-timeout=15s >/dev/null 2>&1; then`
  - L218: `kubectl get secret och-kafka-ssl-secret -n "$NS" -o jsonpath='{.data.ca-cert\.pem}' --request-timeout=25s | base64 -d >"$TMP/service-ca.pem"`
  - L221: `bad "CA fingerprint mismatch kafka-ssl-secret vs och-kafka-ssl-secret (run: make kafka-refresh-tls-from-lb)"`
  - L226: `echo "   ℹ️  och-kafka-ssl-secret absent — skipped"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/kafka-tls-rotate-atomic.sh`
  - L30: `echo "▶ Regenerate kafka-ssl-secret + och-kafka-ssl-secret (full JKS + PEM)"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/lib/kafka-broker-sans.sh`
  - L9: `och_kafka_kubectl() {`
  - L18: `och_kafka_metallb_external_lb_ips_lines() {`
  - L21: `_ip="$(och_kafka_kubectl get svc "kafka-${i}-external" -n "$ns" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"`
  - L29: `och_kafka_metallb_external_lb_ips_csv() {`
  - L38: `done < <(och_kafka_metallb_external_lb_ips_lines "$1" "$2")`
  - L44: `och_kafka_subject_alt_name_openssl_value() {`
  - L75: `och_kafka_emit_san_verify_dns_specs() {`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/lib/kafka-kraft-quorum-ok.sh`
  - L3: `# Usage: source this file and call och_kafka_kraft_quorum_ok [namespace]`
  - L7: `och_kafka_kraft_quorum_ok() {`
  - L20: `PROP=/tmp/och-kafka-quorum-gate.props`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/lib/och-kafka-event-topics-from-proto.sh`
  - L2: `# Shared: derive OCH_KAFKA_EVENT_TOPICS from proto/events/*.proto (single source of truth with explicit exceptions).`
  - L9: `#   OCH_KAFKA_EVENT_TOPICS — bash array of topic names (sorted unique)`
  - L17: `och_kafka_event_topics_fill() {`
  - L18: `OCH_KAFKA_EVENT_TOPICS=()`
  - L56: `OCH_KAFKA_EVENT_TOPICS+=("$line")`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/preflight-kafka-k8s-rollout.sh`
  - L39: `} > /tmp/och-pf.props'`
  - L43: `kafka-topics --bootstrap-server $BS --command-config /tmp/och-pf.props --list | head -25`
  - L44: `echo --- total: \$(kafka-topics --bootstrap-server $BS --command-config /tmp/och-pf.props --list | wc -l | tr -d \" \") topics ---`
  - L50: `kafka-topics --bootstrap-server $BS --command-config /tmp/och-pf.props --describe --topic $SAMPLE_TOPIC" 2>/dev/null; then`
  - L55: `kafka-topics --bootstrap-server $BS --command-config /tmp/och-pf.props --list | head -1")"`
  - L58: `kafka-topics --bootstrap-server $BS --command-config /tmp/och-pf.props --describe --topic \"$ft\""`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/validate-kafka-stack-contract.sh`
  - L6: `#   REPO_ROOT, ENV_PREFIX (default dev), OCH_KAFKA_TOPIC_SUFFIX (optional)`
  - L10: `#   OCH_KAFKA_REQUIRE_QUORUM_3=1 — same as KAFKA_CONTRACT_MIN_BROKERS=3 (k8s KRaft / production gate)`
  - L32: `[[ "${OCH_KAFKA_REQUIRE_QUORUM_3:-0}" == "1" ]] && _req_brokers=3`
  - L67: `# --- Static: no OCH_KAFKA_DISABLED in TS sources`
  - L69: `fail "OCH_KAFKA_DISABLED must not appear in services/scripts TypeScript"`
  - L71: `pass "No OCH_KAFKA_DISABLED in TS sources"`
  - L149: `[[ "${OCH_KAFKA_REQUIRE_QUORUM_3:-0}" == "1" ]] && [[ "$_k8s_min_brokers" -eq 0 ]] && _k8s_min_brokers=3`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/verify-kafka-cluster.sh`
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
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/verify-kafka-event-topic-partitions.sh`
  - L24: `# shellcheck source=lib/och-kafka-event-topics-from-proto.sh`
  - L25: `source "$SCRIPT_DIR/lib/och-kafka-event-topics-from-proto.sh"`
  - L26: `och_kafka_event_topics_fill || fail "Could not build topic list from proto/events"`
  - L27: `TOPICS=("${OCH_KAFKA_EVENT_TOPICS[@]}")`
  - L50: `} > /tmp/och-kafka-verify.props'`
  - L54: `out="$(kubectl exec -n "$_ns" "$_pod" -- kafka-topics --bootstrap-server "$_bs" --command-config /tmp/och-kafka-verify.props --describe --topic "$t" 2>/dev/null | head -8 || true)"`
  - L97: `} > /tmp/och-kafka-verify.props`
  - L104: `kafka-topics --bootstrap-server localhost:9093 --command-config /tmp/och-kafka-verify.props --describe --topic "$KAFKA_TOPIC" 2>/dev/null | head -8`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/verify-kafka-kraft-e2e.sh`
  - L87: `OCH_KAFKA_TOPIC_SUFFIX="${OCH_KAFKA_TOPIC_SUFFIX:-}" \`
  - L216: `} > /tmp/och-kraft-describe.props`
  - L217: `kafka-topics --bootstrap-server kafka-0.kafka:9093 --command-config /tmp/och-kraft-describe.props --describe`
  - L253: `OCH_KAFKA_REQUIRE_QUORUM_3=1 \`
  - L260: `bash "$SCRIPT_DIR/validate-kafka-stack-contract.sh" >/tmp/och-kraft-preflight-fail.out 2>/tmp/och-kraft-preflight-fail.err`
  - L264: `grep -q 'ERROR: Kafka quorum' /tmp/och-kraft-preflight-fail.err 2>/dev/null || grep -q 'ERROR: Kafka quorum' /tmp/och-kraft-preflight-fail.out 2>/dev/null || \`
  - L265: `warn "Gate failed (exit $_pe) but exact ERROR line not found in captured output (check /tmp/och-kraft-preflight-fail.err)"`
  - L296: `_topic="${KRAFT_E2E_SMOKE_TOPIC:-och-kraft-e2e-smoke}"`
  - L309: `} > /tmp/och-smoke.props`
  - L310: `kafka-topics --bootstrap-server kafka-0.kafka:9093 --command-config /tmp/och-smoke.props --create --if-not-exists --topic ${_topic} --replication-factor 3 --partitions 1`
  - L325: `} > /tmp/och-smoke.props`
  - L326: `echo '${_msg}' | kafka-console-producer --bootstrap-server kafka-0.kafka:9093 --producer.config /tmp/och-smoke.props --topic ${_topic}`
  - L340: `} > /tmp/och-smoke.props`
  - L341: `timeout 25 kafka-console-consumer --bootstrap-server kafka-1.kafka:9093 --consumer.config /tmp/och-smoke.props --topic ${_topic} --from-beginning --max-messages 1 2>/dev/null | tail -1`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/verify-kafka-tls-sans.sh`
  - L104: `done < <(och_kafka_emit_san_verify_dns_specs "$NS" "$REPLICAS")`
  - L120: `done < <(och_kafka_metallb_external_lb_ips_lines "$NS" "$REPLICAS")`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/verify-preflight-edge-routing.sh`
  - L8: `#   HOUSING_NS, OCH_EDGE_HOSTNAME (default off-campus-housing.test)`
  - L13: `#   OCH_EDGE_IP — if set to an IPv4, use for 6b2 LB alignment instead of resolving HOST (optional override)`
  - L26: `HOST="${2:-${OCH_EDGE_HOSTNAME:-off-campus-housing.test}}"`
  - L62: `_jf="$(mktemp "${TMPDIR:-/tmp}/och-edge-ing.XXXXXX.json")"`
  - L157: `if [[ -n "${OCH_EDGE_IP:-}" ]] && [[ "${OCH_EDGE_IP}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then`
  - L158: `EDGE_IP="${OCH_EDGE_IP}"`
  - L159: `ok "Using OCH_EDGE_IP=$EDGE_IP for alignment check"`
  - L164: `bad "Could not resolve IPv4 for $HOST (tried Python socket, getent, ping, dig). Fix /etc/hosts or DNS (see OCH_EDGE_IP)."`

## K8s `namespace:` lines (YAML)

*Raw namespace: declarations*

**Hits:** 33 (capped per file in scanner)

- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/kafka-ca-exporter/configmap.yaml`
  - L5: `namespace: off-campus-housing-tracker`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/kafka-ca-exporter/deployment.yaml`
  - L5: `namespace: off-campus-housing-tracker`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/kafka-ca-exporter/rbac.yaml`
  - L5: `namespace: off-campus-housing-tracker`
  - L13: `namespace: off-campus-housing-tracker`
  - L24: `namespace: off-campus-housing-tracker`
  - L32: `namespace: off-campus-housing-tracker`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/kafka-ca-exporter/service.yaml`
  - L5: `namespace: off-campus-housing-tracker`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/kafka-external/external-service.yaml`
  - L12: `namespace: off-campus-housing-tracker`
  - L25: `namespace: off-campus-housing-tracker`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/kafka/deploy.yaml`
  - L5: `namespace: off-campus-housing-tracker`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/kafka/external-service.yaml`
  - L7: `namespace: off-campus-housing-tracker`
  - L20: `namespace: off-campus-housing-tracker`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/kafka/service.yaml`
  - L5: `namespace: off-campus-housing-tracker`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-certs/certificates/kafka-0-cert.yaml`
  - L6: `namespace: off-campus-housing-tracker`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-certs/certificates/kafka-1-cert.yaml`
  - L6: `namespace: off-campus-housing-tracker`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-certs/certificates/kafka-2-cert.yaml`
  - L6: `namespace: off-campus-housing-tracker`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-certs/kafka-tls-preflight-job.yaml`
  - L9: `namespace: off-campus-housing-tracker`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-kraft-metallb/external-services.yaml`
  - L8: `namespace: off-campus-housing-tracker`
  - L23: `namespace: off-campus-housing-tracker`
  - L38: `namespace: off-campus-housing-tracker`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-kraft-metallb/headless-service.yaml`
  - L5: `namespace: off-campus-housing-tracker`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-kraft-metallb/kafka-metallb-alignment-exporter.yaml`
  - L7: `namespace: off-campus-housing-tracker`
  - L13: `namespace: off-campus-housing-tracker`
  - L29: `namespace: off-campus-housing-tracker`
  - L37: `namespace: off-campus-housing-tracker`
  - L43: `namespace: off-campus-housing-tracker`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-kraft-metallb/kafka-pdb.yaml`
  - L7: `namespace: off-campus-housing-tracker`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-kraft-metallb/kustomization.yaml`
  - L33: `namespace: off-campus-housing-tracker`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-kraft-metallb/rbac-kafka-svc-reader.yaml`
  - L7: `namespace: off-campus-housing-tracker`
  - L14: `namespace: off-campus-housing-tracker`
  - L26: `namespace: off-campus-housing-tracker`
  - L35: `namespace: off-campus-housing-tracker`
- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-kraft-metallb/statefulset.yaml`
  - L12: `namespace: off-campus-housing-tracker`

## Cert / SAN hints

*x509-ish strings mentioning OCH hosts*

**Hits:** 3 (capped per file in scanner)

- `record-platform-kafka-metallb-tls-reference-20260409/scripts/ci/generate-kafka-ci-tls.sh`
  - L28: `-subj "/CN=och-kafka-ci-ca/O=off-campus-housing-ci" \`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/kafka-ssl-from-dev-root.sh`
  - L82: `-subj "/CN=${CN}/O=off-campus-housing-tracker" 2>/dev/null`
  - L134: `-subj "/CN=kafka-client/O=off-campus-housing-tracker" 2>/dev/null`

## Hardcoded gateway / legacy ports

*4020-style ports (RP api-gateway default is :4000)*

**Hits:** 3 (capped per file in scanner)

- `record-platform-kafka-metallb-tls-reference-20260409/scripts/verify-preflight-edge-routing.sh`
  - L80: `("/api", "Prefix", "api-gateway", 4020),`
  - L81: `("/auth", "Prefix", "api-gateway", 4020),`
  - L152: `ok "Ingress: /api + /auth → api-gateway:4020, / → nginx:8080 (ordered before catch-all /)"`

## HOUSING / legacy env

*Environment variables and assignments*

**Hits:** 63 (capped per file in scanner)

- `record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-certs/README.md`
  - L24: `HOUSING_NS=off-campus-housing-tracker bash scripts/verify-kafka-tls-sans.sh`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/apply-kafka-kraft-staged.sh`
  - L11: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/check-kafka-config-drift.sh`
  - L12: `NS="${1:-${HOUSING_NS:-off-campus-housing-tracker}}"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/export-kafka-ca-metric.sh`
  - L9: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/kafka-after-rollout-verify-brokers.sh`
  - L7: `#   HOUSING_NS=off-campus-housing-tracker KAFKA_BROKER_REPLICAS=3 ./scripts/kafka-after-rollout-verify-brokers.sh`
  - L13: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
  - L36: `HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" \`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/kafka-auto-heal-inter-broker-tls.sh`
  - L6: `#   HOUSING_NS=off-campus-housing-tracker KAFKA_BROKER_REPLICAS=3 ./scripts/kafka-auto-heal-inter-broker-tls.sh`
  - L13: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
  - L29: `HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$SCRIPT_DIR/kafka-after-rollout-verify-brokers.sh"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/kafka-clean-slate.sh`
  - L9: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/kafka-onboarding-reset.sh`
  - L8: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/kafka-quorum-stable.sh`
  - L13: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/kafka-refresh-tls-from-lb.sh`
  - L15: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
  - L17: `export HOUSING_NS="$NS"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/kafka-rolling-restart.sh`
  - L12: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
  - L45: `HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$R" bash "$SCRIPT_DIR/verify-kafka-cluster.sh" "$NS" "$R"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/kafka-runtime-sync.sh`
  - L44: `NS="${POS_NS:-${HOUSING_NS:-off-campus-housing-tracker}}"`
  - L48: `export HOUSING_NS="$NS"`
  - L58: `export HOUSING_NS="$NS"`
  - L103: `HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$SCRIPT_DIR/kafka-refresh-tls-from-lb.sh"`
  - L121: `HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$SCRIPT_DIR/kafka-after-rollout-verify-brokers.sh" || {`
  - L127: `if ! HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$SCRIPT_DIR/kafka-runtime-sync.sh" --check-only "$NS" "$REP"; then`
  - L141: `HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" \`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/kafka-sync-metallb.sh`
  - L12: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
  - L24: `HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$SCRIPT_DIR/kafka-auto-heal-inter-broker-tls.sh" || exit 1`
  - L27: `if HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$SCRIPT_DIR/kafka-runtime-sync.sh" --check-only --quiet "$NS" "$REP"; then`
  - L37: `HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" \`
  - L49: `HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$SCRIPT_DIR/kafka-refresh-tls-from-lb.sh"`
  - L63: `HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$SCRIPT_DIR/kafka-after-rollout-verify-brokers.sh" || exit 1`
  - L73: `HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" \`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/kafka-tls-guard.sh`
  - L18: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/kafka-tls-rotate-atomic.sh`
  - L10: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/lib/kafka-kraft-quorum-ok.sh`
  - L8: `local NS="${1:-${HOUSING_NS:-off-campus-housing-tracker}}"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/tests/kafka-alignment-suite.sh`
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
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/verify-cluster-kafka-three-brokers.sh`
  - L4: `#   HOUSING_NS=off-campus-housing-tracker (default)`
  - L7: `HOUSING_NS="${HOUSING_NS:-off-campus-housing-tracker}"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/verify-kafka-cluster.sh`
  - L44: `NS="${1:-${HOUSING_NS:-off-campus-housing-tracker}}"`
  - L146: `HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REPLICAS" bash "$SCRIPT_DIR/verify-kafka-tls-sans.sh" "$NS" "$REPLICAS"`
  - L155: `HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REPLICAS" bash "$SCRIPT_DIR/verify-kafka-kraft-advertised-listeners.sh" "$NS" "$REPLICAS"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/verify-kafka-kraft-advertised-listeners.sh`
  - L15: `NS="${1:-${HOUSING_NS:-off-campus-housing-tracker}}"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/verify-kafka-no-static-advertised-env.sh`
  - L14: `NS="${1:-${HOUSING_NS:-off-campus-housing-tracker}}"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/verify-kafka-tls-sans.sh`
  - L16: `NS="${1:-${HOUSING_NS:-off-campus-housing-tracker}}"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/verify-preflight-edge-routing.sh`
  - L25: `NS="${1:-${HOUSING_NS:-off-campus-housing-tracker}}"`
- `record-platform-kafka-metallb-tls-reference-20260409/scripts/wait-for-kafka-external-lb-ips.sh`
  - L6: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`

---

## Summary

Apply **`docs/bundles/OCH_TO_RP_CONVERSION_MATRIX.md`** when porting; prefer surgical patches over bulk replace.
