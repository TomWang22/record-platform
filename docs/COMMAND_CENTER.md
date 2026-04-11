# Command center — entrypoints, ports, edge, smoke, bundles

Single place for “what do I run?” and “which port?” so **README.md**, **manifests**, and **scripts** stay aligned.

## Canonical edge (dev)

| Item | Value |
|------|--------|
| HTTPS hostname | **`record.test`** (put **`METALLB_IP record.test`** in `/etc/hosts`; avoid `*.local` → mDNS on macOS) |
| Kubernetes namespace (workloads, Kafka clients) | **`record-platform`** — Makefile and scripts use **`HOUSING_NS`** with the same default (not `off-campus-housing-tracker`) |
| Edge URL | **`https://record.test`** (port **443**, TCP + QUIC/UDP) |
| TLS verify | `curl --cacert certs/dev-root.pem …` or trust dev-root CA in keychain (macOS k6) |
| Helpers | `./scripts/ensure-edge-hosts.sh`, `scripts/lib/edge-test-url.sh` |

E2E / Playwright / k6 use **HTTPS on the edge**, not a gateway port-forward. Legacy `http://127.0.0.1:4000` bases are rejected by edge helpers in favor of **`https://record.test`**.

## API Gateway port (not 4020)

| Path | Port | Notes |
|------|------|------|
| **api-gateway** Service (in-cluster) | **4000** | Matches **README** “Core Services” table and **Caddyfile** `reverse_proxy … api-gateway…:4000` |
| nginx ingress → api-gateway | **4000** | `infra/k8s/overlays/dev/ingress.yaml` |
| Caddy → api-gateway | **4000** | Repo root `Caddyfile` |

Older references to **4020** were a drift; scripts and gates now use **4000**.

## Smoke & health (quick)

| Goal | Command |
|------|---------|
| Namespace + records ping | `./scripts/smoke.sh record-platform` |
| In-cluster gateway / nginx / haproxy | `./scripts/smoke-edge.sh` (uses `http://api-gateway:4000/healthz`) |
| CI gateway smoke | `./scripts/ci/smoke-api-gateway.sh` (`API_GATEWAY_PORT` default **4000**) |
| Edge routing + TLS | `make verify-preflight-edge-routing` or `./scripts/verify-preflight-edge-routing.sh` |
| k6 edge hints | `./scripts/diagnose-k6-edge-connectivity.sh` |

## Full validation (preflight + suites)

| Goal | Command |
|------|---------|
| Full pipeline | `METALLB_ENABLED=1 ./scripts/run-preflight-scale-and-all-suites.sh` |
| Suites only | `./scripts/run-all-test-suites.sh` |
| Kafka KRaft (3 brokers, `record-platform`) | `kubectl apply -k infra/k8s/kafka-kraft-metallb/` — details **`docs/kafka/KRAFT_THREE_BROKER_TLS.md`**, **`infra/k8s/kafka-kraft-metallb/README.md`** |
| Kafka TLS JKS + `kafka-ssl-secret` | `./scripts/kafka-ssl-from-dev-root.sh` → artifacts under **`certs/kafka-ssl/`** (gitignored) |
| Kafka ops CronJobs | `kubectl apply -k infra/ops/` |
| Kafka replica guard (VAP) | `kubectl apply -f infra/policies/kafka-replica-guard.yaml` (optional; cluster must enforce VAP) |

## Caddy image (HTTP/3 + pcaps)

- **Dockerfile:** `docker/caddy-with-tcpdump/Dockerfile` — **xcaddy** build + **tcpdump** + **tshark** on Alpine runtime.
- **Docs:** `docs/bundles/preflight-kafka-caddy-20260409/CADDY_IMAGE_XCADDY_TCPDUMP_TSHARK.md`

## Reference tarballs (outside git; merge as needed)

Artifacts live under **`/Users/tom/`** (adjust paths for your machine). Verify SHA before extract.

| Bundle | Path (example) | SHA-256 | Copied into repo |
|--------|----------------|---------|------------------|
| Preflight / Kafka KRaft / certs / Caddy | `record-platform-och-preflight-kafka-kraft-certs-caddy-reference-20260409.tar.gz` | `017dc4875ca3d0904be4e813bf2298e31b4ad2bc244dc58e39e2efc9865d4d28` | `docs/bundles/preflight-kafka-caddy-20260409/*.md` |
| Vitest / Playwright / event-layer / analytics | `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409.tar.gz` | `362e531762ea6d44c723d7f01bad9a688a3c2096bd9999a333f0f2bfbc50a6a4` | See `docs/RECORD_PLATFORM_REFERENCE_BUNDLE.md` |
| Full scripts/infra (OCH) | `record-platform-och-full-scripts-infra-reference-20260410-1245.tar.gz` | `e321f349d24cf61695c086d28ccd0812879ebbd1864a9902f56ce65fb93f1684` | Merged into tree as applicable (`docs/OCH_FULL_REFERENCE_BUNDLE_MERGE.md`) |
| Transport-watchdog, preflight, Kafka mesh, full scripts ref | `record-platform-och-transport-watchdog-preflight-kafka-mesh-full-scripts-reference-20260410.tar.gz` | `955d5eec9a6219973e124f33311a0f59c998ed9a68f9d7366982d567502ff5ae` | See `docs/SELF_BUILT_SERVICE_MESH.md`, `docs/runbooks/kafka-kraft-stale-dns-rca.md` |
| Final combined (Vitest, Kafka event-layer, chaos, golden, full tree) | `record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410.tar.gz` | `2ae24cbc99afae4b2d3036f5282048127ea5e2ee448113bf3b6cc846e0591765` | `README-BUNDLE.md`, `GOLDEN_SNAPSHOT_AND_CHAOS.md` in bundle; namespace **record-platform** |
| Kafka ops, certs alignment CronJob, preflight wiring | `record-platform-kafka-ops-certs-alignment-cron-preflight-20260410.tar.gz` | `a447077cb019ec7e1c2f51a49ae589ad11b376ed96cf1f7f586418b3d1eac150` | In-tree: `docs/bundles/kafka-ops-certs-alignment-20260410/`, `infra/ops/` (kustomize), `infra/k8s/kafka-ops/kafka-alignment-cronjob.yaml`, `infra/docker/kafka-alignment-cron/`, `monitoring/prometheus-rules/kafka-kraft-dns.yaml` |
| Makefile, golden snapshot, Kafka chaos (full scripts tree in tarball) | `record-platform-makefile-golden-snapshot-kafka-chaos-20260410.tar.gz` | `1154eb5fbf17f5f590e9c33118582b192fa268f3d1eb31b62836330579d8d0eb` | In-repo: `docs/bundles/makefile-golden-chaos-kafka-20260410/README-BUNDLE.md`, `infra/k8s/base/observability/prometheus-rules-kafka-health.yaml` (`make sync-prometheus-kafka-rules`), image scripts under `scripts/rebuild-all-record-platform-images-k3s.sh` |
| Kafka / MetalLB / TLS (reference) | `record-platform-kafka-metallb-tls-reference-20260409.tar.gz` | `467d021cb9ebeca7939aad2b236e1c755f9cd2283ad341d7737f04efdba15f30` | Reference-only; merge snippets if needed |
| Kafka observability / proto (reference) | `record-platform-kafka-observability-proto-reference-20260410.tar.gz` | `cccf91235608ce4b7d3b64db24defacd0bd3a5683e7695c8c5abbc73e83da912` | Reference-only; merge snippets if needed |
| Monitoring / tests / Vitest / Python tooling | `record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410.tar.gz` | `561d76b4f17b813659116772785d7770a6e5dd01a3f486b2fa4ad238a6593690` | Reference-only; merge snippets if needed |
| Standalone Kafka KRaft 3-broker + cert-manager | `record-platform-kafka-kraft-3broker-kafka-certs-20260410.tar.gz` | `e547496e053877dcbeec678e9b37a13b1f8c132e77285ceb893d4bf2b66359a9` | In-tree: `infra/k8s/kafka-kraft-metallb/`, `infra/k8s/kafka-certs/` (namespace **record-platform**, cert **usages** server+client auth); `docs/bundles/kafka-kraft-3broker-kafka-certs-20260410/README-BUNDLE.md` |

**Tarball merge status (this monorepo):** Do **not** unpack every `.tar.gz` on top of git — you would overwrite **`Makefile`**, **`scripts/`**, and **`Caddyfile`**. The rows above describe what is **already vendored or merged** (docs under `docs/bundles/…`, Kafka ops paths, observability rules, Record Platform image scripts). Treat remaining home-directory archives as **reference** unless you are doing a deliberate, reviewed `rsync`. Canonical runtime defaults are **`record.test`**, **api-gateway :4000**, namespace **`record-platform`**. Full audit of **all** `~/record-platform*.tar.gz` files and safe-merge rules: **`docs/bundles/TARBALL_SELECTIVE_MERGE.md`**.

**Extract preflight/Kafka/Caddy bundle:**

```bash
tar xzf /path/to/record-platform-och-preflight-kafka-kraft-certs-caddy-reference-20260409.tar.gz
cd record-platform-och-preflight-kafka-kraft-certs-caddy-reference-20260409
less README-BUNDLE.md
```

**Extract Makefile / golden snapshot / Kafka chaos bundle:**

```bash
tar xzf /path/to/record-platform-makefile-golden-snapshot-kafka-chaos-20260410.tar.gz
cd record-platform-makefile-golden-chaos-kafka-20260410
```

**Merge tip:** After extract, use selective `rsync` or `cp` for `infra/k8s/`, `scripts/`, and root `Caddyfile` / `Makefile` — resolve conflicts in git. This repo already carries the **record.test** hostname, **4000** gateway port, and **record-platform** namespace defaults; prefer this repo when in doubt.

**Tarballs under `/Users/tom/` (SHA verified 2026-04-10):** the table above lists the bundles we track; additional archives in home should be checksummed with `shasum -a 256 /Users/tom/record-platform*.tar.gz` before extract and the table updated if you add new drops.

## Related docs

- `README.md` — narrative, recruiter summary, recovery sections  
- `docs/RECORD_PLATFORM_REFERENCE_BUNDLE.md` — Playwright/Vitest bundle  
- `docs/OCH_FULL_REFERENCE_BUNDLE_MERGE.md` — full infra tarball  
- `docs/OUTBOX_BY_DATABASE.md` — Kafka + outbox layout  
- `docs/GDPR_ACCOUNT_DELETION_AND_ANONYMIZATION.md` — lifecycle topic + anonymization playbook  
- `docs/SERVICE_SLO_SLA.md` — Prometheus SLO examples (`monitoring/prometheus-rules/service-slos.yaml`)  
- `docs/bundles/kafka-ops-certs-alignment-20260410/RECORD_PLATFORM_PREFLIGHT_KAFKA_OPS_SETUP.md` — TLS → topics → ops CronJobs  
- `scripts/SCRIPTS_LAYOUT.md` — scripts organized by function (`e2e/`, `tls/`, `tests/`, …)  
- `docs/bundles/makefile-golden-chaos-kafka-20260410/README-BUNDLE.md` — golden snapshot + chaos Make targets  
- `docs/kafka/KRAFT_THREE_BROKER_TLS.md` — 3-broker KRaft, `certs/kafka-ssl/`, serverAuth+clientAuth, ops/policy, tarball extract note  
- `docs/bundles/TARBALL_SELECTIVE_MERGE.md` — audit of all `~/record-platform*.tar.gz` archives; safe selective merge rules  
- `docs/bundles/kafka-kraft-3broker-kafka-certs-20260410/README-BUNDLE.md` — standalone 3-broker + `kafka-certs` tarball (SHA in table above)  
- `PLATFORM_REUSE_AND_PREFLIGHT.md` (under `docs/bundles/…`) — preflight env flags and reuse  
