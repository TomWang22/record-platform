# OCH → RP rewrite scan: `och-preflight-cluster-stability-jaeger-transport-bundle-20260418-011502`

**Staging (read-only scan):** `/Users/tom/bundle-staging/och-preflight-cluster-stability-jaeger-transport-bundle-20260418-011502`

This report lists **detected** OCH-era strings. It does **not** apply edits.

---

## Namespace references

*Kubernetes / config namespace strings*

**Hits:** 87 (capped per file in scanner)

- `och-preflight-cluster-stability-jaeger-transport-bundle/Makefile`
  - L2: `# Off-Campus-Housing-Tracker — Unified Orchestration Makefile`
  - L30: `HOUSING_NS ?= off-campus-housing-tracker`
  - L62: `kubectl logs -n off-campus-housing-tracker -l app=api-gateway --tail=200`
  - L63: `kubectl logs -n off-campus-housing-tracker -l app=auth-service --tail=200`
  - L102: `# Default 1: append off-campus-housing.test → MetalLB IP via sudo when needed (set 0 for hints only).`
  - L154: `@echo "Off-Campus-Housing-Tracker — common make targets"`
  - L207: `@echo " Off-Campus-Housing-Tracker Make Menu"`
  - L490: `diagnose-k6-edge: ## DNS/TLS/curl checks for off-campus-housing.test (k6 edge timeouts)`
  - L499: `kafka-lb-reset: ## Delete kafka-0/1/2-external LoadBalancers only (namespace off-campus-housing-tracker)`
  - L501: `kubectl delete svc $$s -n off-campus-housing-tracker --ignore-not-found --request-timeout=30s; \`
  - L506: `@kubectl delete svc kafka -n off-campus-housing-tracker --ignore-not-found --request-timeout=30s`
  - L507: `@kubectl delete endpoints kafka -n off-campus-housing-tracker --ignore-not-found --request-timeout=30s 2>/dev/null || true`
  - L508: `@kubectl delete endpointslices -n off-campus-housing-tracker -l kubernetes.io/service-name=kafka --ignore-not-found --request-timeout=30s 2>/dev/null || true`
  - L593: `# ROLE: DEV — after deploy-dev (Caddy/ingress up): curl / API health via off-campus-housing.test`
  - L721: `curl --cacert certs/dev-root.pem -sS -I --http3 https://off-campus-housing.test/ >/dev/null || true`
  - … *9 more in this file*
- `och-preflight-cluster-stability-jaeger-transport-bundle/README_BUNDLE.txt`
  - L4: `This archive matches the Off-Campus-Housing-Tracker repo (no hostname/namespace rewrites).`
- `och-preflight-cluster-stability-jaeger-transport-bundle/docs/preflight-transport-phase-grep.txt`
  - L1: `99:#   Step 7 auto-wiring (no manual exports): E2E_API_BASE defaults to https://off-campus-housing.test; JAEGER_QUERY_BASE`
- `och-preflight-cluster-stability-jaeger-transport-bundle/infra/k8s/base/observability/prometheus-rule-quic-transport-invariant.example.yaml`
  - L9: `app.kubernetes.io/part-of: off-campus-housing-tracker`
- `och-preflight-cluster-stability-jaeger-transport-bundle/scripts/capture-quic-pcap.sh`
  - L20: `HOST="${HOST:-off-campus-housing.test}"`
- `och-preflight-cluster-stability-jaeger-transport-bundle/scripts/ci/verify-quic-hostname-invariant.sh`
  - L3: `# OCH edge contract: hostname off-campus-housing.test + --resolve / K6_RESOLVE to LB IP.`
  - L11: `echo "❌ Raw-IP https BASE_URL default in scripts/load (use https://off-campus-housing.test + resolve):"`
- `och-preflight-cluster-stability-jaeger-transport-bundle/scripts/lib/grpc-http3-health.sh`
  - L13: `local ns="${NS:-off-campus-housing-tracker}"`
  - L14: `local host="${HOST:-off-campus-housing.test}"`
  - L81: `local grpc_authority="${HOST:-off-campus-housing.test}"`
- `och-preflight-cluster-stability-jaeger-transport-bundle/scripts/lib/packet-capture-v2.sh`
  - L500: `# Optional SNI proof (off-campus-housing.test)`
  - L502: `sni_count=$(tshark -r "$dir/node-capture.pcap" -Y "quic && tls.handshake.extensions_server_name contains off-campus-housing.test" 2>/dev/null | wc -l | tr -d '[:space:]')`
  - L504: `[[ "$sni_count" -gt 0 ]] && echo "  [packet-capture-v2] QUIC SNI off-campus-housing.test: $sni_count packets"`
- `och-preflight-cluster-stability-jaeger-transport-bundle/scripts/lib/packet-capture.sh`
  - L30: `# Host/VM capture (when applicable): use "(tcp or udp) and port 443 and dst host $TARGET_IP" so only traffic to MetalLB IP is captured (gold standard). Post-capture: verify with tshark -Y "udp.port…`
  - L357: `# Per-pod QUIC proof: stray UDP/443 vs pod IP + optional SNI (OCH: CAPTURE_EXPECTED_SNI default off-campus-housing.test)`
- `och-preflight-cluster-stability-jaeger-transport-bundle/scripts/lib/protocol-verification.sh`
  - L113: `# Count QUIC packets with SNI off-campus-housing.test (definitive proof traffic is for our domain; no background QUIC noise).`
  - L116: `local sni="${2:-off-campus-housing.test}"`
  - L126: `# Quote SNI for display filter (OCH: off-campus-housing.test; not record.local / RP)`
  - L153: `local sni="${CAPTURE_EXPECTED_SNI:-off-campus-housing.test}"`
  - L342: `# SNI validation: QUIC with off-campus-housing.test = definitive proof traffic belongs to our domain (no background noise).`
  - L347: `sni_total=$((sni_total + $(count_quic_sni_record_local_in_pcap "$pcap" "${CAPTURE_EXPECTED_SNI:-off-campus-housing.test}")))`
  - L349: `[[ "$sni_total" -gt 0 ]] && echo "  OK: $label QUIC SNI off-campus-housing.test: $sni_total packets (definitive proof traffic to our domain)"`
- `och-preflight-cluster-stability-jaeger-transport-bundle/scripts/package-och-preflight-transport-bundle.sh`
  - L4: `# 1) OCH upstream (default): off-campus-housing.test / off-campus-housing-tracker unchanged.`
  - L64: `perl -pi -e 's/off-campus-housing\.test/record.test/g' "$f"`
  - L65: `perl -pi -e 's/off-campus-housing-tracker/record-platform/g' "$f"`
  - L160: `This archive matches the Off-Campus-Housing-Tracker repo (no hostname/namespace rewrites).`
- `och-preflight-cluster-stability-jaeger-transport-bundle/scripts/package-quic-transport-porting-bundle.sh`
  - L81: `perl -pi -e 's/off-campus-housing\.test/record.test/g' "$f"`
  - L82: `perl -pi -e 's/off-campus-housing-tracker/record-platform/g' "$f"`
- `och-preflight-cluster-stability-jaeger-transport-bundle/scripts/phase-barrier.sh`
  - L9: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
- `och-preflight-cluster-stability-jaeger-transport-bundle/scripts/preflight-controlled-transport-otel-prove.sh`
  - L27: `HOST="${HOST:-off-campus-housing.test}"`
- `och-preflight-cluster-stability-jaeger-transport-bundle/scripts/run-preflight-scale-and-all-suites.sh`
  - L23: `# Preflight auto-checks local cert material and bootstraps missing files (dev-root.pem/key, off-campus-housing leaf,`
  - L49: `#   https://off-campus-housing.test. Step 7a runs ./scripts/lib/trust-dev-root-ca-macos.sh automatically`
  - L57: `#   - off-campus-housing-tracker: service 1, exporters 1, envoy-test 1, Caddy 2`
  - L58: `#   - Reissue CA + leaf (dev-root-ca / off-campus-housing-local-tls match); verify no curl 60`
  - L99: `#   Step 7 auto-wiring (no manual exports): E2E_API_BASE defaults to https://off-campus-housing.test; JAEGER_QUERY_BASE`
  - L103: `#   PREFLIGHT_STRICT_EDGE_RESOLVE=1 (default): curl --resolve off-campus-housing.test:443:<MetalLB IP> /api/readyz before suites.`
  - L129: `#   Edge hostname / headless DNS (Playwright + Node fetch require off-campus-housing.test → IP):`
  - L133: `#     HOUSING_NS — namespace for LB discovery (default off-campus-housing-tracker).`
  - L185: `#       # until kubectl top pods -n off-campus-housing-tracker | grep api-gateway | awk '{print $2}' | sed 's/m//' | awk '{exit !($1 < 150)}'; do sleep 2; done`
  - L218: `#     Second terminal (prove contention): kubectl top pods -n off-campus-housing-tracker; kubectl top nodes — watch CPU/mem >80%, Postgres/Envoy spikes.`
  - L271: `#   Preconditions: PR1 merged; off-campus-housing.test + certs/dev-root.pem; kubectl get pods -n off-campus-housing-tracker.`
  - L354: `#   In-pod Caddy: CAPTURE_STRICT_ENDPOINT_BPF=1 (default) → BPF (tcp|udp) dst podIP:443; post-verify stray UDP/443 (dst != pod) must be 0. CAPTURE_EXPECTED_SNI=off-campus-housing.test (OCH edge; no…`
  - L499: `local _ns="${HOUSING_NS:-off-campus-housing-tracker}"`
  - L526: `"$certs_dir/off-campus-housing.test.crt"`
  - L527: `"$certs_dir/off-campus-housing.test.key"`
  - … *10 more in this file*
- `och-preflight-cluster-stability-jaeger-transport-bundle/scripts/run-transport-study-experiments.sh`
  - L160: `_code=$(curl -k -sS -o /dev/null -w "%{http_code}" --connect-timeout 3 --max-time 8 --resolve "off-campus-housing.test:${_np}:${_node_ip}" "https://off-campus-housing.test:${_np}/_caddy/healthz" 2>…`
  - L188: `info "  Point k6: BASE_URL=https://localhost:443 K6_RESOLVE=off-campus-housing.test:443:127.0.0.1"`
  - L238: `export HOST="${HOST:-off-campus-housing.test}"`
  - L326: `_h2=$(curl -sSI --http2 --max-time 15 --cacert "$_ca" "https://${HOST:-off-campus-housing.test}/api/healthz" 2>>"$_log" | head -n 12 || true)`
  - L328: `_h3=$(curl -sSI --http3 --max-time 15 --cacert "$_ca" "https://${HOST:-off-campus-housing.test}/api/healthz" 2>>"$_log" | head -n 12 || true)`
  - L353: `' "$_json" "${HOST:-off-campus-housing.test}" "${_h2n:-1}" "${_h3n:-1}" "$_h2_line" "$_h3_line" || true`
- `och-preflight-cluster-stability-jaeger-transport-bundle/scripts/seed-jaeger-via-edge-health.sh`
  - L7: `# Env: E2E_API_BASE (default https://off-campus-housing.test), NODE_EXTRA_CA_CERTS (default certs/dev-root.pem)`
- `och-preflight-cluster-stability-jaeger-transport-bundle/scripts/test-packet-capture-standalone.sh`
  - L24: `NS="off-campus-housing-tracker"`
  - L25: `HOST="${HOST:-off-campus-housing.test}"`

## SNI / hostnames

*Hosts, URLs, and dotted domains*

**Hits:** 61 (capped per file in scanner)

- `och-preflight-cluster-stability-jaeger-transport-bundle/Makefile`
  - L102: `# Default 1: append off-campus-housing.test → MetalLB IP via sudo when needed (set 0 for hints only).`
  - L490: `diagnose-k6-edge: ## DNS/TLS/curl checks for off-campus-housing.test (k6 edge timeouts)`
  - L593: `# ROLE: DEV — after deploy-dev (Caddy/ingress up): curl / API health via off-campus-housing.test`
  - L721: `curl --cacert certs/dev-root.pem -sS -I --http3 https://off-campus-housing.test/ >/dev/null || true`
  - L1121: `export E2E_API_BASE="https://off-campus-housing.test" && \`
  - L1139: `HOST=off-campus-housing.test TARGET_IP="$$_lb" PORT=443 STRICT_QUIC_VALIDATION=1 SSLKEYLOGFILE="$$_kl" \`
  - L1171: `HOST=off-campus-housing.test TARGET_IP="$$_lb" PORT=443 STRICT_QUIC_VALIDATION=1 SSLKEYLOGFILE="$$_kl" \`
  - L1206: `HOST=off-campus-housing.test TARGET_IP="$$_lb" PORT=443 STRICT_QUIC_VALIDATION=1 SSLKEYLOGFILE="$$_kl" \`
- `och-preflight-cluster-stability-jaeger-transport-bundle/docs/preflight-transport-phase-grep.txt`
  - L1: `99:#   Step 7 auto-wiring (no manual exports): E2E_API_BASE defaults to https://off-campus-housing.test; JAEGER_QUERY_BASE`
- `och-preflight-cluster-stability-jaeger-transport-bundle/scripts/capture-quic-pcap.sh`
  - L20: `HOST="${HOST:-off-campus-housing.test}"`
- `och-preflight-cluster-stability-jaeger-transport-bundle/scripts/ci/verify-quic-hostname-invariant.sh`
  - L3: `# OCH edge contract: hostname off-campus-housing.test + --resolve / K6_RESOLVE to LB IP.`
  - L11: `echo "❌ Raw-IP https BASE_URL default in scripts/load (use https://off-campus-housing.test + resolve):"`
- `och-preflight-cluster-stability-jaeger-transport-bundle/scripts/lib/grpc-http3-health.sh`
  - L14: `local host="${HOST:-off-campus-housing.test}"`
  - L81: `local grpc_authority="${HOST:-off-campus-housing.test}"`
- `och-preflight-cluster-stability-jaeger-transport-bundle/scripts/lib/packet-capture-v2.sh`
  - L500: `# Optional SNI proof (off-campus-housing.test)`
  - L502: `sni_count=$(tshark -r "$dir/node-capture.pcap" -Y "quic && tls.handshake.extensions_server_name contains off-campus-housing.test" 2>/dev/null | wc -l | tr -d '[:space:]')`
  - L504: `[[ "$sni_count" -gt 0 ]] && echo "  [packet-capture-v2] QUIC SNI off-campus-housing.test: $sni_count packets"`
- `och-preflight-cluster-stability-jaeger-transport-bundle/scripts/lib/packet-capture.sh`
  - L30: `# Host/VM capture (when applicable): use "(tcp or udp) and port 443 and dst host $TARGET_IP" so only traffic to MetalLB IP is captured (gold standard). Post-capture: verify with tshark -Y "udp.port…`
  - L357: `# Per-pod QUIC proof: stray UDP/443 vs pod IP + optional SNI (OCH: CAPTURE_EXPECTED_SNI default off-campus-housing.test)`
- `och-preflight-cluster-stability-jaeger-transport-bundle/scripts/lib/protocol-verification.sh`
  - L113: `# Count QUIC packets with SNI off-campus-housing.test (definitive proof traffic is for our domain; no background QUIC noise).`
  - L116: `local sni="${2:-off-campus-housing.test}"`
  - L126: `# Quote SNI for display filter (OCH: off-campus-housing.test; not record.local / RP)`
  - L153: `local sni="${CAPTURE_EXPECTED_SNI:-off-campus-housing.test}"`
  - L342: `# SNI validation: QUIC with off-campus-housing.test = definitive proof traffic belongs to our domain (no background noise).`
  - L347: `sni_total=$((sni_total + $(count_quic_sni_record_local_in_pcap "$pcap" "${CAPTURE_EXPECTED_SNI:-off-campus-housing.test}")))`
  - L349: `[[ "$sni_total" -gt 0 ]] && echo "  OK: $label QUIC SNI off-campus-housing.test: $sni_total packets (definitive proof traffic to our domain)"`
- `och-preflight-cluster-stability-jaeger-transport-bundle/scripts/package-och-preflight-transport-bundle.sh`
  - L4: `# 1) OCH upstream (default): off-campus-housing.test / off-campus-housing-tracker unchanged.`
- `och-preflight-cluster-stability-jaeger-transport-bundle/scripts/preflight-controlled-transport-otel-prove.sh`
  - L27: `HOST="${HOST:-off-campus-housing.test}"`
- `och-preflight-cluster-stability-jaeger-transport-bundle/scripts/run-preflight-scale-and-all-suites.sh`
  - L49: `#   https://off-campus-housing.test. Step 7a runs ./scripts/lib/trust-dev-root-ca-macos.sh automatically`
  - L99: `#   Step 7 auto-wiring (no manual exports): E2E_API_BASE defaults to https://off-campus-housing.test; JAEGER_QUERY_BASE`
  - L103: `#   PREFLIGHT_STRICT_EDGE_RESOLVE=1 (default): curl --resolve off-campus-housing.test:443:<MetalLB IP> /api/readyz before suites.`
  - L129: `#   Edge hostname / headless DNS (Playwright + Node fetch require off-campus-housing.test → IP):`
  - L271: `#   Preconditions: PR1 merged; off-campus-housing.test + certs/dev-root.pem; kubectl get pods -n off-campus-housing-tracker.`
  - L354: `#   In-pod Caddy: CAPTURE_STRICT_ENDPOINT_BPF=1 (default) → BPF (tcp|udp) dst podIP:443; post-verify stray UDP/443 (dst != pod) must be 0. CAPTURE_EXPECTED_SNI=off-campus-housing.test (OCH edge; no…`
  - L526: `"$certs_dir/off-campus-housing.test.crt"`
  - L527: `"$certs_dir/off-campus-housing.test.key"`
  - L2717: `# 4e. k3d: verify HTTP/3 (QUIC) on NodePort from host (off-campus-housing.test + --resolve; host UDP often broken on macOS).`
  - L2725: `# QUIC invariant: use off-campus-housing.test URL + --resolve (no raw IP); PORT/HTTP3_RESOLVE_PORT for NodePort.`
  - L2727: `"https://off-campus-housing.test:30443/_caddy/healthz" 2>/dev/null) || true`
  - L2730: `ok "HTTP/3 (NodePort 30443) OK — QUIC reachable from host via off-campus-housing.test:30443"`
  - L2746: `if TARGET_IP="$_lb_ip" HOST="off-campus-housing.test" "$SCRIPT_DIR/verify-caddy-http3-in-cluster.sh" 2>/dev/null; then`
  - L3033: `_edge_host="${OCH_EDGE_HOSTNAME:-off-campus-housing.test}"`
  - L3160: `# Packet capture standard: (1) Host/VM: BPF (tcp|udp) dst TARGET_IP:443 if capturing before DNAT. (2) In-pod Caddy: BPF (tcp|udp) dst podIP:443, tcpdump -i eth0 (fallback any). (3) tshark: in-pod s…`
  - … *10 more in this file*
- `och-preflight-cluster-stability-jaeger-transport-bundle/scripts/run-transport-study-experiments.sh`
  - L160: `_code=$(curl -k -sS -o /dev/null -w "%{http_code}" --connect-timeout 3 --max-time 8 --resolve "off-campus-housing.test:${_np}:${_node_ip}" "https://off-campus-housing.test:${_np}/_caddy/healthz" 2>…`
  - L188: `info "  Point k6: BASE_URL=https://localhost:443 K6_RESOLVE=off-campus-housing.test:443:127.0.0.1"`
  - L238: `export HOST="${HOST:-off-campus-housing.test}"`
  - L326: `_h2=$(curl -sSI --http2 --max-time 15 --cacert "$_ca" "https://${HOST:-off-campus-housing.test}/api/healthz" 2>>"$_log" | head -n 12 || true)`
  - L328: `_h3=$(curl -sSI --http3 --max-time 15 --cacert "$_ca" "https://${HOST:-off-campus-housing.test}/api/healthz" 2>>"$_log" | head -n 12 || true)`
  - L353: `' "$_json" "${HOST:-off-campus-housing.test}" "${_h2n:-1}" "${_h3n:-1}" "$_h2_line" "$_h3_line" || true`
- `och-preflight-cluster-stability-jaeger-transport-bundle/scripts/seed-jaeger-via-edge-health.sh`
  - L7: `# Env: E2E_API_BASE (default https://off-campus-housing.test), NODE_EXTRA_CA_CERTS (default certs/dev-root.pem)`
- `och-preflight-cluster-stability-jaeger-transport-bundle/scripts/test-packet-capture-standalone.sh`
  - L25: `HOST="${HOST:-off-campus-housing.test}"`

## OCH-prefixed identifiers

*Secrets, services, env keys with och- / och_*

**Hits:** 86 (capped per file in scanner)

- `och-preflight-cluster-stability-jaeger-transport-bundle/MANIFEST.txt`
  - L37: `scripts/package-och-preflight-transport-bundle.sh`
- `och-preflight-cluster-stability-jaeger-transport-bundle/Makefile`
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
- `och-preflight-cluster-stability-jaeger-transport-bundle/README_BUNDLE.txt`
  - L20: `• Meta: README_BUNDLE.txt, MANIFEST.txt, scripts/package-och-preflight-transport-bundle.sh`
  - L23: `RECORD_PLATFORM_PORTING_BUNDLE=1 bash scripts/package-och-preflight-transport-bundle.sh`
  - L26: `bash scripts/package-och-preflight-transport-bundle.sh`
  - L27: `OCH_PREFLIGHT_BUNDLE_DIR=/tmp bash scripts/package-och-preflight-transport-bundle.sh`
  - L30: `tar -xzf /path/to/och-preflight-cluster-stability-jaeger-transport-bundle-<stamp>.tar.gz -C /path/to/dest`
- `och-preflight-cluster-stability-jaeger-transport-bundle/infra/k8s/base/observability/kustomization.yaml`
  - L10: `- prometheus-rules-och-slo.yaml`
  - L27: `#   och-slo-prometheusrule.yaml     — Prometheus Operator PrometheusRule`
- `och-preflight-cluster-stability-jaeger-transport-bundle/infra/k8s/base/observability/prometheus-rule-quic-transport-invariant.example.yaml`
  - L6: `name: och-quic-transport-invariant`
  - L12: `- name: och-quic-transport`
- `och-preflight-cluster-stability-jaeger-transport-bundle/scripts/lib/grpc-http3-health.sh`
  - L68: `if [[ -f "$lib_dir/ensure-och-grpc-certs.sh" ]]; then`
  - L69: `# shellcheck source=scripts/lib/ensure-och-grpc-certs.sh`
  - L70: `source "$lib_dir/ensure-och-grpc-certs.sh"`
  - L71: `och_sync_grpc_certs_to_dir "$grpc_certs_dir" "$ns" || true`
- `och-preflight-cluster-stability-jaeger-transport-bundle/scripts/lib/packet-capture-v2.sh`
  - L17: `#      CAPTURE_V2_NODE_PCAP_BASENAME — file under VM $HOME for L1 tcpdump -w (default och-node-capture-v2.pcap; /tmp and /var/tmp may deny non-root).`
  - L55: `: "${CAPTURE_V2_NODE_PCAP_BASENAME:=och-node-capture-v2.pcap}"`
  - L137: `local _vm_bn="${CAPTURE_V2_NODE_PCAP_BASENAME:-och-node-capture-v2.pcap}"`
  - L331: `local _vm_bn_stop="${_CAPTURE_V2_NODE_VM_BN:-${CAPTURE_V2_NODE_PCAP_BASENAME:-och-node-capture-v2.pcap}}"`
- `och-preflight-cluster-stability-jaeger-transport-bundle/scripts/package-och-preflight-transport-bundle.sh`
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
  - L66: `perl -pi -e 's/och-quic/record-platform-quic/g' "$f"`
  - L73: `scripts/package-och-preflight-transport-bundle.sh \`
  - L150: `RECORD_PLATFORM_PORTING_BUNDLE=1 bash scripts/package-och-preflight-transport-bundle.sh`
  - L153: `tar -xzf /path/to/record-platform-och-preflight-scale-transport-v7b-<stamp>.tar.gz -C /path/to/dest`
  - L176: `• Meta: README_BUNDLE.txt, MANIFEST.txt, scripts/package-och-preflight-transport-bundle.sh`
  - … *5 more in this file*
- `och-preflight-cluster-stability-jaeger-transport-bundle/scripts/package-quic-transport-porting-bundle.sh`
  - L65: `# Anchors: SRE packet-capture target + transport-quic prove block (see package-och-preflight-transport-bundle.sh).`
  - L83: `perl -pi -e 's/och-quic/record-platform-quic/g' "$f"`
- `och-preflight-cluster-stability-jaeger-transport-bundle/scripts/run-preflight-scale-and-all-suites.sh`
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
- `och-preflight-cluster-stability-jaeger-transport-bundle/scripts/test-packet-capture-standalone.sh`
  - L90: `if [[ -f "$SCRIPT_DIR/lib/ensure-och-grpc-certs.sh" ]]; then`
  - L91: `# shellcheck source=scripts/lib/ensure-och-grpc-certs.sh`
  - L92: `source "$SCRIPT_DIR/lib/ensure-och-grpc-certs.sh"`
  - L93: `och_sync_grpc_certs_to_dir "$GRPC_CERTS_DIR" "$NS" 2>/dev/null || true`
- `och-preflight-cluster-stability-jaeger-transport-bundle/services/listings-service/vitest.integration.config.mts`
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

- `och-preflight-cluster-stability-jaeger-transport-bundle/scripts/run-preflight-scale-and-all-suites.sh`
  - L78: `#   - PREFLIGHT_SKIP_EDGE_ROUTING_GATES=1 — skip 6b1–6b2 (Ingress /api+/auth→api-gateway:4020 order, DNS→caddy-h3 or ingress-nginx-controller LB). Fixes silent k6 0-byte runs from edge drift.`

## HOUSING / legacy env

*Environment variables and assignments*

**Hits:** 50 (capped per file in scanner)

- `och-preflight-cluster-stability-jaeger-transport-bundle/Makefile`
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
- `och-preflight-cluster-stability-jaeger-transport-bundle/scripts/lib/packet-capture-v2.sh`
  - L504: `[[ "$sni_count" -gt 0 ]] && echo "  [packet-capture-v2] QUIC SNI off-campus-housing.test: $sni_count packets"`
- `och-preflight-cluster-stability-jaeger-transport-bundle/scripts/lib/protocol-verification.sh`
  - L342: `# SNI validation: QUIC with off-campus-housing.test = definitive proof traffic belongs to our domain (no background noise).`
  - L349: `[[ "$sni_total" -gt 0 ]] && echo "  OK: $label QUIC SNI off-campus-housing.test: $sni_total packets (definitive proof traffic to our domain)"`
- `och-preflight-cluster-stability-jaeger-transport-bundle/scripts/phase-barrier.sh`
  - L9: `NS="${HOUSING_NS:-off-campus-housing-tracker}"`
- `och-preflight-cluster-stability-jaeger-transport-bundle/scripts/run-preflight-scale-and-all-suites.sh`
  - L103: `#   PREFLIGHT_STRICT_EDGE_RESOLVE=1 (default): curl --resolve off-campus-housing.test:443:<MetalLB IP> /api/readyz before suites.`
  - L499: `local _ns="${HOUSING_NS:-off-campus-housing-tracker}"`
  - L507: `VERIFY_K8S_SERVICES="$PREFLIGHT_APP_DEPLOYS" HOUSING_NS="$_ns" \`
  - L581: `HOUSING_NS="${HOUSING_NS:-off-campus-housing-tracker}" \`
  - L1526: `if HOUSING_NS="${HOUSING_NS:-off-campus-housing-tracker}" FORCE_TLS_RESTART=0 "$SCRIPT_DIR/ensure-housing-cluster-secrets.sh"; then`
  - L1795: `_housing_ns="${HOUSING_NS:-off-campus-housing-tracker}"`
  - L1943: `local _pns="${HOUSING_NS:-off-campus-housing-tracker}"`
  - L1946: `METALLB_POOL="$_pool" HOUSING_NS="$_pns" KAFKA_BROKER_REPLICAS="${KAFKA_BROKER_REPLICAS:-3}" \`
  - L1968: `_kraft_ns="${HOUSING_NS:-off-campus-housing-tracker}"`
  - L2575: `_rec_kraft_ns="${HOUSING_NS:-off-campus-housing-tracker}"`
  - L2727: `"https://off-campus-housing.test:30443/_caddy/healthz" 2>/dev/null) || true`
  - L2730: `ok "HTTP/3 (NodePort 30443) OK — QUIC reachable from host via off-campus-housing.test:30443"`
  - L2828: `_k8s_ns="${HOUSING_NS:-off-campus-housing-tracker}"`
  - L2854: `_k8s_ns_b="${HOUSING_NS:-off-campus-housing-tracker}"`
  - L2888: `_sk_ns="${HOUSING_NS:-off-campus-housing-tracker}"`
  - … *10 more in this file*
- `och-preflight-cluster-stability-jaeger-transport-bundle/scripts/run-transport-study-experiments.sh`
  - L160: `_code=$(curl -k -sS -o /dev/null -w "%{http_code}" --connect-timeout 3 --max-time 8 --resolve "off-campus-housing.test:${_np}:${_node_ip}" "https://off-campus-housing.test:${_np}/_caddy/healthz" 2>…`
  - L188: `info "  Point k6: BASE_URL=https://localhost:443 K6_RESOLVE=off-campus-housing.test:443:127.0.0.1"`

---

## Summary

Apply **`docs/bundles/OCH_TO_RP_CONVERSION_MATRIX.md`** when porting; prefer surgical patches over bulk replace.
