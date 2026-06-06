# OCH → RP rewrite scan: `record.test-och-housing-20260418-161510`

**Staging (read-only scan):** `/Users/tom/bundle-staging/record.test-och-housing-20260418-161510`

This report lists **detected** OCH-era strings. It does **not** apply edits.

---

## Namespace references

*Kubernetes / config namespace strings*

**Hits:** 86 (capped per file in scanner)

- `Makefile`
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
- `Runbook.md`
  - L32: `**Cluster**: Colima + k3s. **Primary path:** Colima + k3s with bridged networking and MetalLB; one-time host route to LB pool for HTTP/3 (see item 68). k3d remains supported with REQUIRE_COLIMA=0. …`
  - L43: `| 2 | Secrets | Missing Kubernetes secrets (redis-auth, kafka-ssl, off-campus-housing-local-tls, dev-root-ca) | Critical Issue #2 |`
  - L62: `| 37 | Rotation | DNS resolution (off-campus-housing.test) + shell substitution error in rotation-suite.sh | Issue #37 (January 31) |`
  - L87: `| 64 | Caddy / QUIC restore | Restore production Caddyfile (off-campus-housing.test, strict TLS) and make QUIC work again after debugging | Restore production Caddy + QUIC (below) |`
  - L146: `**Auth and gateway 500 – cert chain vs backend:** When using strict TLS/mTLS, 500 with `{"error":"internal"}` from the API gateway: (0) **First check gateway logs** for `Cannot set property path of…`
  - L149: `**Symptom:** Test 4c (gRPC via Caddy) fails with `upstream connect error or disconnect/reset before headers. reset reason: remote connection failure`. Manual grpcurl to auth-service (port-forward) …`
  - L206: `**Symptoms:** MetalLB verification step 6/6a or baseline HTTP/3 tests fail with `curl: (7) QUIC: connection to 127.0.0.1 port 18443 refused` or curl exit 28 (timeout). Host curl to LB IP works (HTT…`
  - L218: `**Full reset:** `./scripts/restore-k3d-quic-known-good.sh` (delete + recreate k3d with 30443 tcp+udp), then deploy base, `./scripts/ensure-caddy-http3-config.sh`, `./scripts/check-quic-invariants.s…`
  - L238: `--resolve off-campus-housing.test:443:<LB_OR_NODE_IP> \`
  - L239: `https://off-campus-housing.test/_caddy/healthz -v`
  - L261: `- **Fact:** `infra/k8s/base/haproxy` exposes one backend: **`api-gateway.off-campus-housing-tracker.svc.cluster.local:4020`** (`GET /readyz`).`
  - L269: `- **SAN note:** A leaf including **`DNS:*.off-campus-housing-tracker.svc.cluster.local`** **does** match **`media-service.off-campus-housing-tracker.svc.cluster.local`** for gRPC verify; that did *…`
  - L280: `Builds **`media-service:dev`**, **`docker save | colima ssh docker load`**, **`kubectl rollout restart deploy/media-service -n off-campus-housing-tracker`**.`
  - L281: `- **Wait:** `kubectl rollout status deploy/media-service -n off-campus-housing-tracker --timeout=180s` (readiness has **initialDelaySeconds ~30** + gRPC probe).`
  - L283: ``kubectl exec -n off-campus-housing-tracker deploy/api-gateway -- node -e "require('http').get('http://media-service.off-campus-housing-tracker.svc.cluster.local:4018/healthz',r=>{let d='';r.on('da…`
  - … *10 more in this file*
- `package.json`
  - L2: `"name": "off-campus-housing-tracker",`
  - L61: `"setup:full-stack": "bash scripts/setup-full-off-campus-housing-stack.sh",`
- `scripts/bring-up-external-infra.sh`
  - L19: `#   WAIT_K8S_KAFKA=1         — after compose up, wait for kafka-0..2 Ready in off-campus-housing-tracker (optional)`
  - L38: `HOUSING_NS="${HOUSING_NS:-off-campus-housing-tracker}"`
- `scripts/colima-apply-host-aliases.sh`
  - L13: `NS="off-campus-housing-tracker"`
- `scripts/get-pods-to-ready.sh`
  - L2: `# Get all off-campus-housing-tracker app pods to 1/1 Ready.`
  - L9: `# After running: wait for rollout (e.g. kubectl -n off-campus-housing-tracker rollout status deploy -l app -t 120s)`
  - L25: `say "=== Get off-campus-housing-tracker pods to 1/1 Ready ==="`
  - L45: `if kubectl get deployment "$d" -n off-campus-housing-tracker --request-timeout=5s >/dev/null 2>&1; then`
  - L46: `if kubectl -n off-campus-housing-tracker rollout status "deploy/$d" --timeout=120s 2>/dev/null; then`
  - L49: `warn "$d: rollout not complete (check: kubectl -n off-campus-housing-tracker get pods -l app=$d)"`
  - L63: `kubectl -n off-campus-housing-tracker get pods 2>/dev/null | head -30`
- `scripts/run-preflight-scale-and-all-suites.sh`
  - L23: `# Preflight auto-checks local cert material and bootstraps missing files (dev-root.pem/key, off-campus-housing leaf,`
  - L49: `#   https://off-campus-housing.test. Step 7a **detects** dev-root-ca in the login keychain (no writes).`
  - L56: `#   - off-campus-housing-tracker: service 1, exporters 1, envoy-test 1, Caddy 2`
  - L57: `#   - Reissue CA + leaf (dev-root-ca / off-campus-housing-local-tls match); verify no curl 60`
  - L98: `#   Step 7 auto-wiring (no manual exports): E2E_API_BASE defaults to https://off-campus-housing.test; JAEGER_QUERY_BASE`
  - L102: `#   PREFLIGHT_STRICT_EDGE_RESOLVE=1 (default): curl --resolve off-campus-housing.test:443:<MetalLB IP> /api/readyz before suites.`
  - L128: `#   Edge hostname / headless DNS (Playwright + Node fetch require off-campus-housing.test → IP):`
  - L132: `#     HOUSING_NS — namespace for LB discovery (default off-campus-housing-tracker).`
  - L185: `#       # until kubectl top pods -n off-campus-housing-tracker | grep api-gateway | awk '{print $2}' | sed 's/m//' | awk '{exit !($1 < 150)}'; do sleep 2; done`
  - L218: `#     Second terminal (prove contention): kubectl top pods -n off-campus-housing-tracker; kubectl top nodes — watch CPU/mem >80%, Postgres/Envoy spikes.`
  - L271: `#   Preconditions: PR1 merged; off-campus-housing.test + certs/dev-root.pem; kubectl get pods -n off-campus-housing-tracker.`
  - L354: `#   In-pod Caddy: CAPTURE_STRICT_ENDPOINT_BPF=1 (default) → BPF (tcp|udp) dst podIP:443; post-verify stray UDP/443 (dst != pod) must be 0. CAPTURE_EXPECTED_SNI=off-campus-housing.test (OCH edge; no…`
  - L515: `local _ns="${HOUSING_NS:-off-campus-housing-tracker}"`
  - L542: `"$certs_dir/off-campus-housing.test.crt"`
  - L543: `"$certs_dir/off-campus-housing.test.key"`
  - … *10 more in this file*

## SNI / hostnames

*Hosts, URLs, and dotted domains*

**Hits:** 58 (capped per file in scanner)

- `Makefile`
  - L102: `# Default 1: append off-campus-housing.test → MetalLB IP via sudo when needed (set 0 for hints only).`
  - L490: `diagnose-k6-edge: ## DNS/TLS/curl checks for off-campus-housing.test (k6 edge timeouts)`
  - L593: `# ROLE: DEV — after deploy-dev (Caddy/ingress up): curl / API health via off-campus-housing.test`
  - L721: `curl --cacert certs/dev-root.pem -sS -I --http3 https://off-campus-housing.test/ >/dev/null || true`
  - L1127: `export E2E_API_BASE="https://off-campus-housing.test" && \`
  - L1145: `HOST=off-campus-housing.test TARGET_IP="$$_lb" PORT=443 STRICT_QUIC_VALIDATION=1 SSLKEYLOGFILE="$$_kl" \`
  - L1177: `HOST=off-campus-housing.test TARGET_IP="$$_lb" PORT=443 STRICT_QUIC_VALIDATION=1 SSLKEYLOGFILE="$$_kl" \`
  - L1212: `HOST=off-campus-housing.test TARGET_IP="$$_lb" PORT=443 STRICT_QUIC_VALIDATION=1 SSLKEYLOGFILE="$$_kl" \`
- `Runbook.md`
  - L62: `| 37 | Rotation | DNS resolution (off-campus-housing.test) + shell substitution error in rotation-suite.sh | Issue #37 (January 31) |`
  - L87: `| 64 | Caddy / QUIC restore | Restore production Caddyfile (off-campus-housing.test, strict TLS) and make QUIC work again after debugging | Restore production Caddy + QUIC (below) |`
  - L206: `**Symptoms:** MetalLB verification step 6/6a or baseline HTTP/3 tests fail with `curl: (7) QUIC: connection to 127.0.0.1 port 18443 refused` or curl exit 28 (timeout). Host curl to LB IP works (HTT…`
  - L218: `**Full reset:** `./scripts/restore-k3d-quic-known-good.sh` (delete + recreate k3d with 30443 tcp+udp), then deploy base, `./scripts/ensure-caddy-http3-config.sh`, `./scripts/check-quic-invariants.s…`
  - L238: `--resolve off-campus-housing.test:443:<LB_OR_NODE_IP> \`
  - L239: `https://off-campus-housing.test/_caddy/healthz -v`
  - L283: ``kubectl exec -n off-campus-housing-tracker deploy/api-gateway -- node -e "require('http').get('http://media-service.off-campus-housing-tracker.svc.cluster.local:4018/healthz',r=>{let d='';r.on('da…`
  - L313: `export HOST=off-campus-housing.test`
  - L1222: `- -tls-server-name=off-campus-housing.test`
  - L1241: `- -tls-server-name=off-campus-housing.test`
  - L1257: `- -tls-server-name=off-campus-housing.test`
  - L1356: `- **gRPC:** Envoy NodePort 30000 with `grpcurl -cacert ... -authority off-campus-housing.test` must return `SERVING`. Authenticate and HealthCheck via Envoy = primary path.`
  - L1368: `2. Envoy must present cert for `off-campus-housing.test`; use `-authority off-campus-housing.test` in grpcurl.`
  - L1432: `- **Fix (in `run-all-test-suites.sh` pre-flight):** (1) **Validate after extraction:** Run `openssl verify -CAfile ca.crt tls.crt` when both exist; if it fails, clear `tls.crt` and `tls.key` and wa…`
  - L1436: `- **Envoy TLS hostname:** Envoy presents a cert for `off-campus-housing.test`; connecting to `127.0.0.1:30000` with strict TLS fails hostname verification. **Fix:** Use `-authority off-campus-housi…`
  - … *10 more in this file*
- `scripts/run-preflight-scale-and-all-suites.sh`
  - L49: `#   https://off-campus-housing.test. Step 7a **detects** dev-root-ca in the login keychain (no writes).`
  - L98: `#   Step 7 auto-wiring (no manual exports): E2E_API_BASE defaults to https://off-campus-housing.test; JAEGER_QUERY_BASE`
  - L102: `#   PREFLIGHT_STRICT_EDGE_RESOLVE=1 (default): curl --resolve off-campus-housing.test:443:<MetalLB IP> /api/readyz before suites.`
  - L128: `#   Edge hostname / headless DNS (Playwright + Node fetch require off-campus-housing.test → IP):`
  - L271: `#   Preconditions: PR1 merged; off-campus-housing.test + certs/dev-root.pem; kubectl get pods -n off-campus-housing-tracker.`
  - L354: `#   In-pod Caddy: CAPTURE_STRICT_ENDPOINT_BPF=1 (default) → BPF (tcp|udp) dst podIP:443; post-verify stray UDP/443 (dst != pod) must be 0. CAPTURE_EXPECTED_SNI=off-campus-housing.test (OCH edge; no…`
  - L542: `"$certs_dir/off-campus-housing.test.crt"`
  - L543: `"$certs_dir/off-campus-housing.test.key"`
  - L2733: `# 4e. k3d: verify HTTP/3 (QUIC) on NodePort from host (off-campus-housing.test + --resolve; host UDP often broken on macOS).`
  - L2741: `# QUIC invariant: use off-campus-housing.test URL + --resolve (no raw IP); PORT/HTTP3_RESOLVE_PORT for NodePort.`
  - L2743: `"https://off-campus-housing.test:30443/_caddy/healthz" 2>/dev/null) || true`
  - L2746: `ok "HTTP/3 (NodePort 30443) OK — QUIC reachable from host via off-campus-housing.test:30443"`
  - L2762: `if TARGET_IP="$_lb_ip" HOST="off-campus-housing.test" "$SCRIPT_DIR/verify-caddy-http3-in-cluster.sh" 2>/dev/null; then`
  - L3049: `_edge_host="${OCH_EDGE_HOSTNAME:-off-campus-housing.test}"`
  - L3176: `# Packet capture standard: (1) Host/VM: BPF (tcp|udp) dst TARGET_IP:443 if capturing before DNAT. (2) In-pod Caddy: BPF (tcp|udp) dst podIP:443, tcpdump -i eth0 (fallback any). (3) tshark: in-pod s…`
  - … *10 more in this file*

## OCH-prefixed identifiers

*Secrets, services, env keys with och- / och_*

**Hits:** 91 (capped per file in scanner)

- `Makefile`
  - L48: `metallb-fix hosts-sanity ensure-edge-hosts wait-for-caddy-ip preflight-gate preflight-strict preflight-lab preflight-strict-full-matrix validate-observability phase-barrier e2e-full-strict sslkeylo…`
  - L160: `@echo "  make dev-onboard      deps + zero-trust CA + up-fast + Kafka TLS + och-kafka-ssl-secret verify (Phase 10: alignment; SAFE_ONLY=1 → kafka-health); make setup alias"`
  - L161: `@echo "  make rollout-och-full  After Kafka/TLS secret fixes: ensure cluster secrets + restart all housing apps + Caddy (ordered)"`
  - L532: `kafka-tls-guard: ## Mounted CA + JKS uniformity across brokers, och-kafka CA, logs, verify-kafka-cluster (fail-fast)`
  - L547: `service-tls-alias-guard: ## Fail if service-tls vs och-service-tls ca.crt fingerprints differ`
  - L556: `rollout-och-full: ## ensure-housing-cluster-secrets then rollout-deferred-after-kafka-tls; skip secrets: SKIP_ENSURE_CLUSTER_SECRETS=1`
  - L557: `chmod +x "$(SCRIPTS)/ensure-housing-cluster-secrets.sh" "$(SCRIPTS)/rollout-deferred-after-kafka-tls.sh" "$(SCRIPTS)/rollout-restart-och-full-stack.sh"`
  - L558: `NS_ING=$(NS_ING) HOUSING_NS=$(HOUSING_NS) OCH_ROLLOUT_STATUS_TIMEOUT=$(OCH_ROLLOUT_STATUS_TIMEOUT) SKIP_ENSURE_CLUSTER_SECRETS=$(SKIP_ENSURE_CLUSTER_SECRETS) bash "$(SCRIPTS)/rollout-restart-och-fu…`
  - L598: `# Local path: Phase 0.25 deps + 0.5 dev-root CA → up-fast → Kafka apply → och-kafka-ssl-secret sync+verify → … (see script header).`
  - L875: `bash "$(SCRIPTS)/recycle-och-postgres-compose.sh"`
  - L1102: `validate-observability: ## Jaeger Step7 span-tree + overlap gates (needs JAEGER_QUERY_BASE; see docs/observability/och-observability-integrity-spec-v1.md)`
  - L1143: `_kl="$(REPO_ROOT)/bench_logs/sslkeys-och-transport-$$(date +%Y%m%d-%H%M%S).log" && \`
  - L1175: `_kl="$(REPO_ROOT)/bench_logs/sslkeys-och-transport-$$(date +%Y%m%d-%H%M%S).log" && \`
  - L1210: `_kl="$(REPO_ROOT)/bench_logs/sslkeys-och-transport-$$(date +%Y%m%d-%H%M%S).log" && \`
- `Runbook.md`
  - L17: `**Secret names (87):** Deployments must mount the TLS secret name present in the namespace (`och-service-tls` vs `service-tls`). Create an alias secret rather than changing global trust roots ad hoc.`
  - L21: `**Kafka (89):** Delete in-cluster Kafka if policy is external-only; ensure `kafka-external` Endpoints/Service and `kafka-ssl-secret` (or `och-kafka-ssl-secret`) match broker TLS.`
  - L110: `| 87 | K8s TLS secret | `api-gateway` (and others) mounted **service-tls** while overlay expected **och-service-tls** → TLS trust mismatch / mount failures | OCH edge & gateway debugging (below) |`
  - L120: `| 97 | Deploy | After media or gateway image changes: **`SERVICES=media-service ./scripts/rebuild-och-images-and-rollout.sh`** (+ wait rollout) | Same |`
  - L279: ``SERVICES=media-service ./scripts/rebuild-och-images-and-rollout.sh``
  - L285: `- **Full stack:** `./scripts/rebuild-och-images-and-rollout.sh` with no `SERVICES` rebuilds every image in `HOUSING_DOCKER_SERVICES_DEFAULT` (see `scripts/lib/och-housing-docker-services-default.sh…`
  - L306: `That target: resolves the LB IP, writes a fresh TLS key log under **`bench_logs/sslkeys-och-transport-<timestamp>.log`**, runs standalone capture with **`STRICT_QUIC_VALIDATION=1`**, then **asserts…`
  - L720: `2. **`HOUSING_NS=… bash scripts/service-tls-alias-guard.sh`** — **`service-tls`** and **`och-service-tls`** **`ca.crt`** fingerprints match (edge + in-cluster app server certs).`
  - L721: `3. **`make kafka-tls-guard`** — broker secret ↔ mount, JKS uniformity, **och-kafka** CA vs **kafka-ssl-secret**, PKIX log tail, **`make verify-kafka-cluster`**.`
  - L722: `4. **Kafka clients:** **`HOUSING_NS=… bash scripts/ensure-housing-cluster-secrets.sh`** then **roll out** Deployments that mount **`och-kafka-ssl-secret`** (or **`./scripts/rollout-deferred-after-k…`
  - L4037: `- **`service-tls` / `och-service-tls`**: `tls.crt` = **leaf only** (one PEM certificate). **`ca.crt`** = issuing CA (e.g. `dev-root.pem`). **`tls.key`** = leaf key. **Do not** concatenate CA into `…`
  - L4053: `3. **Harness**: `scripts/lib/grpc-utils.sh` — `och_list_app_deployments` / `is_grpc_tls` for dynamic counts and TLS heuristics; `scripts/wait-for-all-services-ready.sh` can auto-detect app deployme…`
  - L4316: `3. **`scripts/ensure-strict-tls-mtls-preflight.sh`** / **`scripts/ensure-housing-cluster-secrets.sh`** - Leaf + CA secrets and `och-service-tls` sync`
- `docs/observability/och-observability-integrity-spec-v1.md`
  - L71: `Validator output includes `specVersion: "och-observability-integrity-spec-v1"`.`
- `package.json`
  - L43: `"rebuild:och:rollout": "bash scripts/rebuild-och-images-and-rollout.sh",`
  - L46: `"rebuild:service:analytics": "SERVICES=analytics-service bash scripts/rebuild-och-images-and-rollout.sh",`
  - L47: `"rebuild:service:auth": "SERVICES=auth-service bash scripts/rebuild-och-images-and-rollout.sh",`
  - L48: `"rebuild:service:booking": "SERVICES=booking-service bash scripts/rebuild-och-images-and-rollout.sh",`
  - L49: `"rebuild:service:cron": "SERVICES=cron-jobs bash scripts/rebuild-och-images-and-rollout.sh",`
  - L50: `"rebuild:service:listings": "SERVICES=listings-service bash scripts/rebuild-och-images-and-rollout.sh",`
  - L51: `"rebuild:service:media": "SERVICES=media-service bash scripts/rebuild-och-images-and-rollout.sh",`
  - L52: `"rebuild:service:messaging": "SERVICES=messaging-service bash scripts/rebuild-och-images-and-rollout.sh",`
  - L53: `"rebuild:service:notification": "SERVICES=notification-service bash scripts/rebuild-och-images-and-rollout.sh",`
  - L54: `"rebuild:service:search": "SERVICES=listings-service bash scripts/rebuild-och-images-and-rollout.sh",`
  - L55: `"rebuild:service:trust": "SERVICES=trust-service bash scripts/rebuild-och-images-and-rollout.sh",`
  - L56: `"rebuild:service:watchdog": "SERVICES=transport-watchdog bash scripts/rebuild-och-images-and-rollout.sh",`
  - L57: `"rebuild:gateway:rollout": "SERVICES=api-gateway bash scripts/rebuild-och-images-and-rollout.sh",`
- `scripts/bring-up-external-infra.sh`
  - L10: `#   ./scripts/recycle-och-postgres-compose.sh`
  - L63: `if ! OCH_FORCE_COLIMA_DOCKER=1 OCH_KUBE_CONTEXT=colima och_ensure_colima_docker_context; then`
- `scripts/lib/ensure-colima-docker-context.sh`
  - L12: `#   export OCH_KUBE_CONTEXT="$(kubectl config current-context 2>/dev/null)"`
  - L13: `#   och_ensure_colima_docker_context || exit 1`
  - L16: `#   OCH_KUBE_CONTEXT — if unset, uses kubectl current-context (if *colima*, enforce socket)`
  - L17: `#   OCH_FORCE_COLIMA_DOCKER — 1: apply Colima docker context even if kube context name lacks "colima"`
  - L18: `#   OCH_COLIMA_FIX_DOCKER_CONTEXT — 0: do not rewrite the colima context's docker endpoint (default 1 when we recover via a socket)`
  - L20: `och_ensure_colima_docker_context() {`
  - L21: `local kube_ctx="${OCH_KUBE_CONTEXT:-$(kubectl config current-context 2>/dev/null || true)}"`
  - L22: `if [[ "${OCH_FORCE_COLIMA_DOCKER:-0}" != "1" ]] && [[ "$kube_ctx" != *colima* ]]; then`
  - L70: `if [[ "${OCH_COLIMA_FIX_DOCKER_CONTEXT:-1}" == "1" ]] && docker context update colima --docker "host=unix://${fixed_sock}" >/dev/null 2>&1; then`
  - L84: `OCH_FORCE_COLIMA_DOCKER=1 OCH_KUBE_CONTEXT=colima och_ensure_colima_docker_context || exit 1`
- `scripts/run-preflight-scale-and-all-suites.sh`
  - L79: `#   - PREFLIGHT_KAFKA_TLS_PREFLIGHT_JOB=1 — after 6a2c, run infra/k8s/kafka-certs/kafka-tls-preflight-job.yaml (in-cluster mTLS to headless :9093). Default 0 (opt-in: slower, needs brokers + och-ka…`
  - L129: `#     OCH_EDGE_IP=<MetalLB-or-NodeIP> — when DNS fails, scripts/lib/edge-test-url.sh prints curl --resolve hints.`
  - L130: `#     OCH_AUTO_EDGE_HOSTS=1 — if DNS fails, append "$OCH_EDGE_IP hostname" to /etc/hosts (needs sudo on non-root).`
  - L131: `#       Discovers IP from kubectl LoadBalancer services when OCH_EDGE_IP unset.`
  - L137: `#     smoke (matches GitHub och-ci `transport-validation` job: py_compile + exit 2 / "no pcap provided").`
  - L263: `#     rebuild-och-images-and-rollout.sh; cert/JKS preflight bootstrap (step 1c).`
  - L266: `#   Rebuild after code: one backend SERVICES=<n> ./scripts/rebuild-och-images-and-rollout.sh or pnpm rebuild:service:*;`
  - L267: `#     several backends SERVICES="a b" .../rebuild-och-images-and-rollout.sh; webapp + default listings`
  - L374: `#   3a0   Auto housing secrets: ensure-housing-cluster-secrets.sh (service-tls/dev-root-ca, och-service-tls alias,`
  - L375: `#         och-kafka-ssl-secret). On by default; PREFLIGHT_AUTO_ENSURE_CLUSTER_SECRETS=0 or SKIP_AUTO_CLUSTER_SECRETS=1 to skip.`
  - L530: `OCH_PREFLIGHT_DEPLOY_ARR=()`
  - L532: `IFS=' ' read -r -a OCH_PREFLIGHT_DEPLOY_ARR <<< "$PREFLIGHT_APP_DEPLOYS"`
  - L805: `for _svc in "${OCH_PREFLIGHT_DEPLOY_ARR[@]}"; do`
  - L943: `say "9b. Canonical perf bundle (och-perf-canonical-10-v2 + summary.json + zip) → $PREFLIGHT_RUN_DIR"`
  - L984: `canon = os.path.join(run_dir, "och-perf-canonical-10-v2")`
  - … *10 more in this file*
- `scripts/run-vitest-system.sh`
  - L9: `#   OCH_INTEGRATION_KAFKA_FROM_K8S_LB — default 1 (same as prior package.json inline)`
  - L15: `export OCH_INTEGRATION_KAFKA_FROM_K8S_LB="${OCH_INTEGRATION_KAFKA_FROM_K8S_LB:-1}"`
- `scripts/trace-validators/db-row-invariant.mjs`
  - L10: `specVersion: "och-observability-integrity-spec-v1",`
- `scripts/trace-validators/kafka-offset-invariant.mjs`
  - L11: `specVersion: "och-observability-integrity-spec-v1",`
- `scripts/trace-validators/packet-trace-correlation.mjs`
  - L11: `specVersion: "och-observability-integrity-spec-v1",`
- `scripts/trace-validators/run-step7-observability-gates.mjs`
  - L64: `const specVersion = "och-observability-integrity-spec-v1";`
- `scripts/trace-validators/step7-strict-span-invariant.mjs`
  - L4: `* See docs/observability/och-observability-integrity-spec-v1.md §3.`
- `scripts/trace-validators/trace-overlap-validator.mjs`
  - L4: `* See docs/observability/och-observability-integrity-spec-v1.md §4.`
- `vitest.system.config.mts`
  - L13: `process.env.OCH_REPO_ROOT?.trim() ||`
  - L24: `process.env.OCH_KAFKA_TOPIC_SUFFIX = `.sys-${process.pid}-${Date.now()}`;`
  - L29: `const suffixClean = process.env.OCH_KAFKA_TOPIC_SUFFIX.replace(/^\.+/u, "").replace(/[^a-zA-Z0-9_.-]/gu, "-");`
  - L30: `process.env.ANALYTICS_LISTING_KAFKA_GROUP ??= `och-sys-contract-${suffixClean}`;`
  - L47: `OCH_KAFKA_TOPIC_SUFFIX: process.env.OCH_KAFKA_TOPIC_SUFFIX!,`

## K8s `namespace:` lines (YAML)

*Raw namespace: declarations*

*None found in scanned text files.*

## Cert / SAN hints

*x509-ish strings mentioning OCH hosts*

**Hits:** 1 (capped per file in scanner)

- `Runbook.md`
  - L542: `-dname "CN=kafka.off-campus-housing-tracker.svc.cluster.local" -validity 3650`

## Hardcoded gateway / legacy ports

*4020-style ports (RP api-gateway default is :4000)*

**Hits:** 3 (capped per file in scanner)

- `Runbook.md`
  - L117: `| 94 | HAProxy | HAProxy backend is **only api-gateway:4020** — not media; mis-attributing k6 failures to “HAProxy → media” wastes time | Same |`
  - L261: `- **Fact:** `infra/k8s/base/haproxy` exposes one backend: **`api-gateway.off-campus-housing-tracker.svc.cluster.local:4020`** (`GET /readyz`).`
- `scripts/run-preflight-scale-and-all-suites.sh`
  - L77: `#   - PREFLIGHT_SKIP_EDGE_ROUTING_GATES=1 — skip 6b1–6b2 (Ingress /api+/auth→api-gateway:4020 order, DNS→caddy-h3 or ingress-nginx-controller LB). Fixes silent k6 0-byte runs from edge drift.`

## HOUSING / legacy env

*Environment variables and assignments*

**Hits:** 53 (capped per file in scanner)

- `Makefile`
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
- `Runbook.md`
  - L206: `**Symptoms:** MetalLB verification step 6/6a or baseline HTTP/3 tests fail with `curl: (7) QUIC: connection to 127.0.0.1 port 18443 refused` or curl exit 28 (timeout). Host curl to LB IP works (HTT…`
  - L218: `**Full reset:** `./scripts/restore-k3d-quic-known-good.sh` (delete + recreate k3d with 30443 tcp+udp), then deploy base, `./scripts/ensure-caddy-http3-config.sh`, `./scripts/check-quic-invariants.s…`
  - L238: `--resolve off-campus-housing.test:443:<LB_OR_NODE_IP> \`
  - L720: `2. **`HOUSING_NS=… bash scripts/service-tls-alias-guard.sh`** — **`service-tls`** and **`och-service-tls`** **`ca.crt`** fingerprints match (edge + in-cluster app server certs).`
  - L722: `4. **Kafka clients:** **`HOUSING_NS=… bash scripts/ensure-housing-cluster-secrets.sh`** then **roll out** Deployments that mount **`och-kafka-ssl-secret`** (or **`./scripts/rollout-deferred-after-k…`
  - L1528: `- **MetalLB (LoadBalancer for Caddy):** Preflight installs MetalLB (step 3c1) and applies Caddy as `LoadBalancer` (step 3c2). Caddy gets an external IP from the L2 pool (default `192.168.106.240-19…`
  - L1874: `curl -k https://off-campus-housing.test:30443/api/social/healthz`
  - L4675: `1. **DNS Resolution Fix**: Use `--resolve off-campus-housing.test:443:<ClusterIP>` in curl commands, or run health checks from within the Colima VM`
- `scripts/bring-up-external-infra.sh`
  - L38: `HOUSING_NS="${HOUSING_NS:-off-campus-housing-tracker}"`
- `scripts/run-preflight-scale-and-all-suites.sh`
  - L102: `#   PREFLIGHT_STRICT_EDGE_RESOLVE=1 (default): curl --resolve off-campus-housing.test:443:<MetalLB IP> /api/readyz before suites.`
  - L515: `local _ns="${HOUSING_NS:-off-campus-housing-tracker}"`
  - L523: `VERIFY_K8S_SERVICES="$PREFLIGHT_APP_DEPLOYS" HOUSING_NS="$_ns" \`
  - L597: `HOUSING_NS="${HOUSING_NS:-off-campus-housing-tracker}" \`
  - L1542: `if HOUSING_NS="${HOUSING_NS:-off-campus-housing-tracker}" FORCE_TLS_RESTART=0 "$SCRIPT_DIR/ensure-housing-cluster-secrets.sh"; then`
  - L1811: `_housing_ns="${HOUSING_NS:-off-campus-housing-tracker}"`
  - L1959: `local _pns="${HOUSING_NS:-off-campus-housing-tracker}"`
  - L1962: `METALLB_POOL="$_pool" HOUSING_NS="$_pns" KAFKA_BROKER_REPLICAS="${KAFKA_BROKER_REPLICAS:-3}" \`
  - L1984: `_kraft_ns="${HOUSING_NS:-off-campus-housing-tracker}"`
  - L2591: `_rec_kraft_ns="${HOUSING_NS:-off-campus-housing-tracker}"`
  - L2743: `"https://off-campus-housing.test:30443/_caddy/healthz" 2>/dev/null) || true`
  - L2746: `ok "HTTP/3 (NodePort 30443) OK — QUIC reachable from host via off-campus-housing.test:30443"`
  - L2844: `_k8s_ns="${HOUSING_NS:-off-campus-housing-tracker}"`
  - L2870: `_k8s_ns_b="${HOUSING_NS:-off-campus-housing-tracker}"`
  - L2904: `_sk_ns="${HOUSING_NS:-off-campus-housing-tracker}"`
  - … *10 more in this file*

---

## Summary

Apply **`docs/bundles/OCH_TO_RP_CONVERSION_MATRIX.md`** when porting; prefer surgical patches over bulk replace.
