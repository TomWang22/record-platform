# OCH → RP rewrite scan: `record-platform-och-preflight-scale-transport-v7b-20260418-011819`

**Staging (read-only scan):** `/Users/tom/bundle-staging/record-platform-och-preflight-scale-transport-v7b-20260418-011819`

This report lists **detected** OCH-era strings. It does **not** apply edits.

---

## Namespace references

*Kubernetes / config namespace strings*

**Hits:** 15 (capped per file in scanner)

- `record-platform-och-preflight-scale-transport-v7b/Makefile`
  - L2: `# Off-Campus-Housing-Tracker — Unified Orchestration Makefile`
  - L154: `@echo "Off-Campus-Housing-Tracker — common make targets"`
  - L207: `@echo " Off-Campus-Housing-Tracker Make Menu"`
  - L1058: `bash "$(SCRIPTS)/setup-full-off-campus-housing-stack.sh"`
  - L1063: `bash "$(SCRIPTS)/setup-full-off-campus-housing-stack.sh"`
  - L1068: `bash "$(SCRIPTS)/setup-full-off-campus-housing-stack.sh"`
  - L1075: `PREFLIGHT_PHASE_D_TAIL_LAB=0 SKIP_COLIMA=1 bash "$(SCRIPTS)/setup-full-off-campus-housing-stack.sh"`
- `record-platform-och-preflight-scale-transport-v7b/docs/preflight-transport-phase-grep.txt`
  - L1: `99:#   Step 7 auto-wiring (no manual exports): E2E_API_BASE defaults to https://off-campus-housing.test; JAEGER_QUERY_BASE`
- `record-platform-och-preflight-scale-transport-v7b/scripts/package-och-preflight-transport-bundle.sh`
  - L64: `perl -pi -e 's/off-campus-housing\.test/record.test/g' "$f"`
  - L160: `This archive matches the Off-Campus-Housing-Tracker repo (no hostname/namespace rewrites).`
- `record-platform-och-preflight-scale-transport-v7b/scripts/package-quic-transport-porting-bundle.sh`
  - L81: `perl -pi -e 's/off-campus-housing\.test/record.test/g' "$f"`
- `record-platform-och-preflight-scale-transport-v7b/scripts/run-preflight-scale-and-all-suites.sh`
  - L23: `# Preflight auto-checks local cert material and bootstraps missing files (dev-root.pem/key, off-campus-housing leaf,`
  - L58: `#   - Reissue CA + leaf (dev-root-ca / off-campus-housing-local-tls match); verify no curl 60`
  - L1781: `# 3a. Reissue CA + leaf first (dev-root-ca / off-campus-housing-local-tls, CA/Caddy match). KAFKA_SSL=1 persists CA key for Kafka.`
  - L1813: `ok "CA and leaf both rotated (dev-root-ca, off-campus-housing-local-tls, service-tls); certs/dev-root.pem is single source of truth"`

## SNI / hostnames

*Hosts, URLs, and dotted domains*

**Hits:** 1 (capped per file in scanner)

- `record-platform-och-preflight-scale-transport-v7b/docs/preflight-transport-phase-grep.txt`
  - L1: `99:#   Step 7 auto-wiring (no manual exports): E2E_API_BASE defaults to https://off-campus-housing.test; JAEGER_QUERY_BASE`

## OCH-prefixed identifiers

*Secrets, services, env keys with och- / och_*

**Hits:** 79 (capped per file in scanner)

- `record-platform-och-preflight-scale-transport-v7b/MANIFEST.txt`
  - L37: `scripts/package-och-preflight-transport-bundle.sh`
- `record-platform-och-preflight-scale-transport-v7b/Makefile`
  - L48: `metallb-fix hosts-sanity ensure-edge-hosts wait-for-caddy-ip preflight-gate preflight-strict preflight-lab preflight-strict-full-matrix phase-barrier e2e-full-strict sslkeylog-seed ollama-note olla…`
  - L160: `@echo "  make dev-onboard      deps + zero-trust CA + up-fast + Kafka TLS + och-kafka-ssl-secret verify (Phase 10: alignment; SAFE_ONLY=1 → kafka-health); make setup alias"`
  - L161: `@echo "  make rollout-och-full  After Kafka/TLS secret fixes: ensure cluster secrets + restart all housing apps + Caddy (ordered)"`
  - L532: `kafka-tls-guard: ## Mounted CA + JKS uniformity across brokers, och-kafka CA, logs, verify-kafka-cluster (fail-fast)`
  - L547: `service-tls-alias-guard: ## Fail if service-tls vs och-service-tls ca.crt fingerprints differ`
  - L556: `rollout-och-full: ## ensure-housing-cluster-secrets then rollout-deferred-after-kafka-tls; skip secrets: SKIP_ENSURE_CLUSTER_SECRETS=1`
  - L557: `chmod +x "$(SCRIPTS)/ensure-housing-cluster-secrets.sh" "$(SCRIPTS)/rollout-deferred-after-kafka-tls.sh" "$(SCRIPTS)/rollout-restart-och-full-stack.sh"`
  - L558: `NS_ING=$(NS_ING) HOUSING_NS=$(HOUSING_NS) OCH_ROLLOUT_STATUS_TIMEOUT=$(OCH_ROLLOUT_STATUS_TIMEOUT) SKIP_ENSURE_CLUSTER_SECRETS=$(SKIP_ENSURE_CLUSTER_SECRETS) bash "$(SCRIPTS)/rollout-restart-och-fu…`
  - L598: `# Local path: Phase 0.25 deps + 0.5 dev-root CA → up-fast → Kafka apply → och-kafka-ssl-secret sync+verify → … (see script header).`
  - L875: `bash "$(SCRIPTS)/recycle-och-postgres-compose.sh"`
  - L1137: `_kl="$(REPO_ROOT)/bench_logs/sslkeys-och-transport-$$(date +%Y%m%d-%H%M%S).log" && \`
  - L1169: `_kl="$(REPO_ROOT)/bench_logs/sslkeys-och-transport-$$(date +%Y%m%d-%H%M%S).log" && \`
  - L1204: `_kl="$(REPO_ROOT)/bench_logs/sslkeys-och-transport-$$(date +%Y%m%d-%H%M%S).log" && \`
- `record-platform-och-preflight-scale-transport-v7b/README_BUNDLE.txt`
  - L13: `RECORD_PLATFORM_PORTING_BUNDLE=1 bash scripts/package-och-preflight-transport-bundle.sh`
  - L16: `tar -xzf /path/to/record-platform-och-preflight-scale-transport-v7b-<stamp>.tar.gz -C /path/to/dest`
- `record-platform-och-preflight-scale-transport-v7b/infra/k8s/base/observability/kustomization.yaml`
  - L10: `- prometheus-rules-och-slo.yaml`
  - L27: `#   och-slo-prometheusrule.yaml     — Prometheus Operator PrometheusRule`
- `record-platform-och-preflight-scale-transport-v7b/scripts/lib/grpc-http3-health.sh`
  - L68: `if [[ -f "$lib_dir/ensure-och-grpc-certs.sh" ]]; then`
  - L69: `# shellcheck source=scripts/lib/ensure-och-grpc-certs.sh`
  - L70: `source "$lib_dir/ensure-och-grpc-certs.sh"`
  - L71: `och_sync_grpc_certs_to_dir "$grpc_certs_dir" "$ns" || true`
- `record-platform-och-preflight-scale-transport-v7b/scripts/lib/packet-capture-v2.sh`
  - L17: `#      CAPTURE_V2_NODE_PCAP_BASENAME — file under VM $HOME for L1 tcpdump -w (default och-node-capture-v2.pcap; /tmp and /var/tmp may deny non-root).`
  - L55: `: "${CAPTURE_V2_NODE_PCAP_BASENAME:=och-node-capture-v2.pcap}"`
  - L137: `local _vm_bn="${CAPTURE_V2_NODE_PCAP_BASENAME:-och-node-capture-v2.pcap}"`
  - L331: `local _vm_bn_stop="${_CAPTURE_V2_NODE_VM_BN:-${CAPTURE_V2_NODE_PCAP_BASENAME:-och-node-capture-v2.pcap}}"`
- `record-platform-och-preflight-scale-transport-v7b/scripts/package-och-preflight-transport-bundle.sh`
  - L5: `#    Output: $HOME/och-preflight-cluster-stability-jaeger-transport-bundle-<stamp>.tar.gz`
  - L9: `#    RECORD_PLATFORM_PORTING_BUNDLE=1 bash scripts/package-och-preflight-transport-bundle.sh`
  - L10: `#    Output: $HOME/record-platform-och-preflight-scale-transport-v7b-<stamp>.tar.gz`
  - L12: `# Override out dir: OCH_PREFLIGHT_BUNDLE_DIR=/path`
  - L13: `# Keep older archives: OCH_BUNDLE_KEEP_ALL=1`
  - L16: `BUNDLE_OUT_DIR="${OCH_PREFLIGHT_BUNDLE_DIR:-$HOME}"`
  - L23: `BUNDLE_TOP="record-platform-och-preflight-scale-transport-v7b"`
  - L24: `OUT_GLOB="record-platform-och-preflight-scale-transport-v7b-*.tar.gz"`
  - L27: `BUNDLE_TOP="och-preflight-cluster-stability-jaeger-transport-bundle"`
  - L28: `OUT_GLOB="och-preflight-cluster-stability-jaeger-transport-bundle-*.tar.gz"`
  - L73: `scripts/package-och-preflight-transport-bundle.sh \`
  - L150: `RECORD_PLATFORM_PORTING_BUNDLE=1 bash scripts/package-och-preflight-transport-bundle.sh`
  - L153: `tar -xzf /path/to/record-platform-och-preflight-scale-transport-v7b-<stamp>.tar.gz -C /path/to/dest`
  - L176: `• Meta: README_BUNDLE.txt, MANIFEST.txt, scripts/package-och-preflight-transport-bundle.sh`
  - L179: `RECORD_PLATFORM_PORTING_BUNDLE=1 bash scripts/package-och-preflight-transport-bundle.sh`
  - … *4 more in this file*
- `record-platform-och-preflight-scale-transport-v7b/scripts/package-quic-transport-porting-bundle.sh`
  - L65: `# Anchors: SRE packet-capture target + transport-quic prove block (see package-och-preflight-transport-bundle.sh).`
- `record-platform-och-preflight-scale-transport-v7b/scripts/run-preflight-scale-and-all-suites.sh`
  - L80: `#   - PREFLIGHT_KAFKA_TLS_PREFLIGHT_JOB=1 — after 6a2c, run infra/k8s/kafka-certs/kafka-tls-preflight-job.yaml (in-cluster mTLS to headless :9093). Default 0 (opt-in: slower, needs brokers + och-ka…`
  - L130: `#     OCH_EDGE_IP=<MetalLB-or-NodeIP> — when DNS fails, scripts/lib/edge-test-url.sh prints curl --resolve hints.`
  - L131: `#     OCH_AUTO_EDGE_HOSTS=1 — if DNS fails, append "$OCH_EDGE_IP hostname" to /etc/hosts (needs sudo on non-root).`
  - L132: `#       Discovers IP from kubectl LoadBalancer services when OCH_EDGE_IP unset.`
  - L138: `#     smoke (matches GitHub och-ci `transport-validation` job: py_compile + exit 2 / "no pcap provided").`
  - L263: `#     rebuild-och-images-and-rollout.sh; cert/JKS preflight bootstrap (step 1c).`
  - L266: `#   Rebuild after code: one backend SERVICES=<n> ./scripts/rebuild-och-images-and-rollout.sh or pnpm rebuild:service:*;`
  - L267: `#     several backends SERVICES="a b" .../rebuild-och-images-and-rollout.sh; webapp + default listings`
  - L374: `#   3a0   Auto housing secrets: ensure-housing-cluster-secrets.sh (service-tls/dev-root-ca, och-service-tls alias,`
  - L375: `#         och-kafka-ssl-secret). On by default; PREFLIGHT_AUTO_ENSURE_CLUSTER_SECRETS=0 or SKIP_AUTO_CLUSTER_SECRETS=1 to skip.`
  - L514: `OCH_PREFLIGHT_DEPLOY_ARR=()`
  - L516: `IFS=' ' read -r -a OCH_PREFLIGHT_DEPLOY_ARR <<< "$PREFLIGHT_APP_DEPLOYS"`
  - L789: `for _svc in "${OCH_PREFLIGHT_DEPLOY_ARR[@]}"; do`
  - L927: `say "9b. Canonical perf bundle (och-perf-canonical-10-v2 + summary.json + zip) → $PREFLIGHT_RUN_DIR"`
  - L968: `canon = os.path.join(run_dir, "och-perf-canonical-10-v2")`
  - … *10 more in this file*
- `record-platform-och-preflight-scale-transport-v7b/scripts/test-packet-capture-standalone.sh`
  - L90: `if [[ -f "$SCRIPT_DIR/lib/ensure-och-grpc-certs.sh" ]]; then`
  - L91: `# shellcheck source=scripts/lib/ensure-och-grpc-certs.sh`
  - L92: `source "$SCRIPT_DIR/lib/ensure-och-grpc-certs.sh"`
  - L93: `och_sync_grpc_certs_to_dir "$GRPC_CERTS_DIR" "$NS" 2>/dev/null || true`
- `record-platform-och-preflight-scale-transport-v7b/services/listings-service/vitest.integration.config.mts`
  - L10: `process.env.OCH_KAFKA_TOPIC_SUFFIX?.trim() ||`
  - L13: `process.env.OCH_KAFKA_TOPIC_SUFFIX = topicSuffix;`
  - L16: `OCH_GRPC_INSECURE_TEST_BIND: "1",`
  - L19: `OCH_KAFKA_TOPIC_SUFFIX: topicSuffix,`

## K8s `namespace:` lines (YAML)

*Raw namespace: declarations*

*None found in scanned text files.*

## Cert / SAN hints

*x509-ish strings mentioning OCH hosts*

*None found in scanned text files.*

## Hardcoded gateway / legacy ports

*4020-style ports (RP api-gateway default is :4000)*

**Hits:** 1 (capped per file in scanner)

- `record-platform-och-preflight-scale-transport-v7b/scripts/run-preflight-scale-and-all-suites.sh`
  - L78: `#   - PREFLIGHT_SKIP_EDGE_ROUTING_GATES=1 — skip 6b1–6b2 (Ingress /api+/auth→api-gateway:4020 order, DNS→caddy-h3 or ingress-nginx-controller LB). Fixes silent k6 0-byte runs from edge drift.`

## HOUSING / legacy env

*Environment variables and assignments*

**Hits:** 43 (capped per file in scanner)

- `record-platform-och-preflight-scale-transport-v7b/Makefile`
  - L363: `HOUSING_NS=$(HOUSING_NS) bash "$(REPO_ROOT)/scripts/diagnose-kafka-broker-dns.sh"`
  - L386: `HOUSING_NS=$(HOUSING_NS) KAFKA_BROKER_REPLICAS=$(KAFKA_BROKER_REPLICAS) bash "$(REPO_ROOT)/scripts/kafka-auto-heal-inter-broker-tls.sh"`
  - L396: `HOUSING_NS=$(HOUSING_NS) KAFKA_BROKER_REPLICAS=$(KAFKA_BROKER_REPLICAS) bash "$(REPO_ROOT)/scripts/kafka-auto-heal-inter-broker-tls.sh"`
  - L414: `HOUSING_NS=$(HOUSING_NS) KAFKA_BROKER_REPLICAS=$(KAFKA_BROKER_REPLICAS) bash "$(REPO_ROOT)/scripts/kafka-auto-heal-inter-broker-tls.sh"`
  - L430: `HOUSING_NS=$(HOUSING_NS) KAFKA_BROKER_REPLICAS=$(KAFKA_BROKER_REPLICAS) bash "$(REPO_ROOT)/scripts/kafka-auto-heal-inter-broker-tls.sh"`
  - L448: `HOUSING_NS=$(HOUSING_NS) KAFKA_BROKER_REPLICAS=$(KAFKA_BROKER_REPLICAS) bash "$(REPO_ROOT)/scripts/kafka-auto-heal-inter-broker-tls.sh"`
  - L469: `k8s-diagnose-restarts: ## Pods with restarts: namespace events, per-container describe + logs (HOUSING_NS=…)`
  - L521: `HOUSING_NS=$(HOUSING_NS) KAFKA_TLS_ATOMIC_BEFORE_REFRESH=$(KAFKA_TLS_ATOMIC_BEFORE_REFRESH) KAFKA_BROKER_REPLICAS=$(KAFKA_BROKER_REPLICAS) bash "$(SCRIPTS)/apply-kafka-kraft-staged.sh"`
  - L534: `KAFKA_BROKER_REPLICAS=$(KAFKA_BROKER_REPLICAS) HOUSING_NS=$(HOUSING_NS) bash "$(SCRIPTS)/kafka-tls-guard.sh"`
  - L538: `KAFKA_BROKER_REPLICAS=$(KAFKA_BROKER_REPLICAS) HOUSING_NS=$(HOUSING_NS) bash "$(SCRIPTS)/kafka-tls-rotate-atomic.sh"`
  - L545: `HOUSING_NS=$(HOUSING_NS) bash "$(SCRIPTS)/kafka-quorum-stable.sh"`
  - L549: `HOUSING_NS=$(HOUSING_NS) bash "$(SCRIPTS)/service-tls-alias-guard.sh"`
  - L553: `NS_ING=$(NS_ING) HOUSING_NS=$(HOUSING_NS) bash "$(SCRIPTS)/edge-readiness-gate.sh"`
  - L558: `NS_ING=$(NS_ING) HOUSING_NS=$(HOUSING_NS) OCH_ROLLOUT_STATUS_TIMEOUT=$(OCH_ROLLOUT_STATUS_TIMEOUT) SKIP_ENSURE_CLUSTER_SECRETS=$(SKIP_ENSURE_CLUSTER_SECRETS) bash "$(SCRIPTS)/rollout-restart-och-fu…`
  - L566: `HOUSING_NS=$(HOUSING_NS) bash "$(SCRIPTS)/ensure-housing-cluster-secrets.sh"`
  - … *4 more in this file*
- `record-platform-och-preflight-scale-transport-v7b/scripts/phase-barrier.sh`
  - L9: `NS="${HOUSING_NS:-record-platform}"`
- `record-platform-och-preflight-scale-transport-v7b/scripts/run-preflight-scale-and-all-suites.sh`
  - L499: `local _ns="${HOUSING_NS:-record-platform}"`
  - L507: `VERIFY_K8S_SERVICES="$PREFLIGHT_APP_DEPLOYS" HOUSING_NS="$_ns" \`
  - L581: `HOUSING_NS="${HOUSING_NS:-record-platform}" \`
  - L1526: `if HOUSING_NS="${HOUSING_NS:-record-platform}" FORCE_TLS_RESTART=0 "$SCRIPT_DIR/ensure-housing-cluster-secrets.sh"; then`
  - L1795: `_housing_ns="${HOUSING_NS:-record-platform}"`
  - L1943: `local _pns="${HOUSING_NS:-record-platform}"`
  - L1946: `METALLB_POOL="$_pool" HOUSING_NS="$_pns" KAFKA_BROKER_REPLICAS="${KAFKA_BROKER_REPLICAS:-3}" \`
  - L1968: `_kraft_ns="${HOUSING_NS:-record-platform}"`
  - L2575: `_rec_kraft_ns="${HOUSING_NS:-record-platform}"`
  - L2828: `_k8s_ns="${HOUSING_NS:-record-platform}"`
  - L2854: `_k8s_ns_b="${HOUSING_NS:-record-platform}"`
  - L2888: `_sk_ns="${HOUSING_NS:-record-platform}"`
  - L2896: `(cd "$REPO_ROOT" && HOUSING_NS="$_sk_ns" KAFKA_BROKER_REPLICAS="$_sk_rep" pnpm verify:kafka-tls-sans) || fail "6a2c verify:kafka-tls-sans failed — broker cert missing headless SANs (re-run: KAFKA_S…`
  - L2898: `HOUSING_NS="$_sk_ns" bash "$SCRIPT_DIR/verify-housing-kafka-bootstrap.sh" || fail "6a2c verify-housing-kafka-bootstrap failed"`
  - L2899: `HOUSING_NS="$_sk_ns" KAFKA_BROKER_REPLICAS="$_sk_rep" bash "$SCRIPT_DIR/verify-kafka-tls-sans.sh" || fail "6a2c verify-kafka-tls-sans failed"`
  - … *8 more in this file*

---

## Summary

Apply **`docs/bundles/OCH_TO_RP_CONVERSION_MATRIX.md`** when porting; prefer surgical patches over bulk replace.
