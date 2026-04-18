# Selective merge from home-directory tarballs (Record Platform)

All archives are under **`/Users/tom/record-platform*.tar.gz`** (adjust for your machine). **Never** extract a bundle **on top of the git repo root** — you will overwrite **`Makefile`**, **`Caddyfile`**, **`scripts/`**, and **`package.json`** in ways that are hard to review.

## Safe workflow

1. **Extract each tarball to a separate directory** (example):

   ```bash
   mkdir -p /tmp/rp-tarball-staging
   for f in /Users/tom/record-platform*.tar.gz; do
     tar xzf "$f" -C /tmp/rp-tarball-staging
   done
   ```

2. **Diff, then copy** only paths you intend to change:

   ```bash
   diff -ru /tmp/rp-tarball-staging/<bundle>/scripts/foo.sh ./scripts/foo.sh
   ```

3. **Prefer “add if missing”** over “replace if different” for large trees. The monorepo already diverged from OCH (services, **`record.test`**, **api-gateway :4000**, namespace **`record-platform`**).

## Archives audited (2026-04-10)

| Archive | Role |
|---------|------|
| `record-platform-och-preflight-kafka-kraft-certs-caddy-reference-20260409.tar.gz` | Preflight / Caddy / KRaft reference |
| `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409.tar.gz` | Vitest / Playwright / analytics |
| `record-platform-och-full-scripts-infra-reference-20260410-1245.tar.gz` | Full scripts + infra snapshot |
| `record-platform-och-transport-watchdog-preflight-kafka-mesh-full-scripts-reference-20260410.tar.gz` | Mesh / transport / scripts |
| `record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410.tar.gz` | Combined final reference |
| `record-platform-kafka-ops-certs-alignment-cron-preflight-20260410.tar.gz` | Kafka ops CronJobs, policies, alignment image |
| `record-platform-makefile-golden-snapshot-kafka-chaos-20260410.tar.gz` | Makefile + golden + chaos **`scripts/`** tree |
| `record-platform-kafka-metallb-tls-reference-20260409.tar.gz` | MetalLB / TLS reference |
| `record-platform-kafka-observability-proto-reference-20260410.tar.gz` | Observability / proto reference |
| `record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410.tar.gz` | Monitoring / tests / tooling |
| `record-platform-kafka-kraft-3broker-kafka-certs-20260410.tar.gz` | **Standalone** `kafka-kraft-metallb` + `kafka-certs` (cert-manager CRs, **record-platform**, EKU usages) — SHA **`e547496e053877dcbeec678e9b37a13b1f8c132e77285ceb893d4bf2b66359a9`** |

SHA-256 values: **`docs/COMMAND_CENTER.md`**.

## What we intentionally do **not** auto-merge

- **`Makefile`**, **`Caddyfile`**, root **`package.json`**, **`pnpm-lock.yaml`** from bundles — keep the repo as source of truth; port **targets** manually if needed.
- **Duplicate OCH microservices** in **`infra/k8s/base/`** (e.g. booking / media / messaging / notification / trust) when those services **do not exist** in this monorepo — avoids broken kustomize references and namespace drift.
- **`__pycache__`**, **`*.pyc`** — never commit.
- **Paths that exist but differ** (hundreds of files) — treat as **manual merge** after `diff`; bulk overwrite would erase Record Platform–specific edits.

## What was merged from audits (additive)

Cross-bundle comparison (`scripts/*.sh` **missing** in git): only **`scripts/diagnose-kafka-broker-dns.sh`** (from the makefile/golden/chaos bundle). **`make diagnose-kafka-broker-dns`** runs it.

From **`record-platform-makefile-golden-snapshot-kafka-chaos-20260410.tar.gz`**, these **chaos / resilience** scripts were **missing** in git and were added (additive): **`run-chaos-suite.sh`**, **`run-governed-chaos.sh`**, **`chaos-kafka-broker.sh`** (kill broker pod, default **kafka-1**), **`chaos-metallb-kafka-lb.sh`**, **`chaos-kafka-partition.sh`**, **`chaos-kafka-alignment-stochastic.sh`**, **`chaos-node-reboot.sh`**, **`chaos-expired-ca.sh`**, **`chaos-latency.sh`**, **`calc-failure-budget.py`**. They wire **`make chaos-suite`**, **`chaos-suite-kafka`**, **`governed-chaos`**, **`chaos-kafka-broker`**, **`kafka-health-chaos-cert`**, **`golden-snapshot`** (optional chaos). **`scripts/tests/kafka-alignment-suite.sh`** was already in-tree for **`make kafka-alignment-suite`** (3-broker alignment + EKU checks via **`verify-kafka-broker-keystore-jks.sh`** / **`verify-kafka-broker-tls-eku.sh`**).

From **`record-platform-kafka-kraft-3broker-kafka-certs-20260410.tar.gz`**: **`infra/k8s/kafka-kraft-metallb/`** matched git (already correct); **`infra/k8s/kafka-certs/`** was updated — **`Certificate`** CRs and namespace **`record-platform`**, **`usages`** include **server auth** + **client auth**; preflight Job uses **`kafka-ssl-secret`**.

From the **final combined** reference bundle, **missing** and **safe** infra pieces:

- **`infra/k8s/overlays/kafka-host-compose/`** — documented in **`infra/k8s/kafka-kraft-metallb/kustomization.yaml`** for host Compose Kafka; `kubectl apply -k infra/k8s/overlays/kafka-host-compose/` + **`scripts/patch-kafka-external-host.sh`**.
- **`infra/k8s/monitoring/kafka-election-exporter-stub.yaml`** + **`README.md`** — stub only; documents exporter options.

Already merged earlier from the **kafka-ops** bundle: **`infra/ops/`**, **`infra/policies/kafka-replica-guard.yaml`**, **`infra/k8s/kafka-ops/kafka-alignment-cronjob.yaml`**, **`monitoring/prometheus-rules/kafka-kraft-dns.yaml`**.

**2026-04-18 transport + Jaeger (additive, no wholesale `run-preflight` replace):** from **`~/record-platform-och-preflight-scale-transport-v7b-20260418-011819.tar.gz`** (canonical script set) plus vendored metadata from **`~/och-preflight-cluster-stability-jaeger-transport-bundle-20260418-011502.tar.gz`** — Jaeger LB/liveness/trace helpers, **`cluster-stability-guard.sh`**, **`phase-barrier.sh`**, **`preflight-controlled-transport-otel-prove.sh`**, **`run-transport-study-experiments.sh`**, **`transport-study-v7b.mjs`**, **`schemas/transport-study-v7b.schema.json`**, **`infra/observability/trace-flows.json`**, tuned **`jaeger-deploy.yaml`** collector queue/resources. **`scripts/lib/quic_command_center/`** and **`scripts/lib/quic-forensic/`** remain under **`scripts/lib/`** (not top-level `scripts/quic-*`). Edge SNI defaults stay **`record.test`**. **KRaft:** continue to use **`infra/k8s/kafka-kraft-metallb/`** (**3** replicas; **`KAFKA_BROKER_REPLICAS`** in **`Makefile`**).

**2026-04-18 Kafka KRaft 3-broker + chaos suite bundle:** **`~/kafka-kraft-3broker-chaos-suite-bundle-20260418-022748.tar.gz`** — merged **`infra/k8s/kafka-kraft-metallb/`**, **`infra/k8s/kafka-certs/`** (cert-manager CRs, preflight Job → **`kafka-ssl-secret`**), **`infra/k8s/kafka-ops/`**, **`infra/docker/kafka-alignment-cron/`**, **`prometheus-rules-kafka-health.yaml`**, **`.github/workflows/kafka-cluster-verify.yml`**, alignment + chaos **`scripts/`** (and **`certs/README.txt`**). Rewrites: **`off-campus-housing-tracker` → `record-platform`**, **`och-kafka-ssl-secret` → `kafka-ssl-secret`**, dev leaf **`off-campus-housing.test` → `record.test`** in **`scripts/dev-generate-certs.sh`**. Vendored under **`docs/bundles/kafka-kraft-3broker-chaos-suite-20260418-022748/`**.

Second pass (**add-if-missing** from **`record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410.tar.gz`**): **`docker/envoy-with-tcpdump/README.md`**; **`infra/k8s/base/README.md`**; **`infra/k8s/base/config/proto/`** (README + **booking / common / media / messaging / notification / trust** protos + **`events/`** subtree); **`infra/k8s/base/config/strict-envelope.json`** and **`transport-routing-defaults.json`**; **`infra/k8s/base/docs/grpc-probes-mtls-template.yaml`**; **`infra/k8s/observability/chaos-nightly-cronjob.yaml`**; **`infra/k8s/overlays/dev/patches/`** — **`analytics-analytics-sync-env.yaml`**, **`e2e-high-cap-mode-env.yaml`**, **`gateway-traffic-shaper-cluster-weight.yaml`**, **`hpa-api-gateway-single-replica.yaml`**, **`listings-analytics-sync-env.yaml`**, **`webapp-local-image-pull.yaml`**; **`infra/k8s/reference/envoy-quic-downstream.example.yaml`**; **`scripts/resilience-interactive-menu.sh`** (**`make resilience-menu`**). Use **`git add -f`** for paths matching **`*.yaml` / `*.sh` / `*.json`** if your **`.gitignore`** hides them.

## Makefile / golden / chaos bundle (read-only extract)

```bash
tar xzf /path/to/record-platform-makefile-golden-snapshot-kafka-chaos-20260410.tar.gz
cd record-platform-makefile-golden-chaos-kafka-20260410
```

Use that tree to **read** scripts; integrate into git **one file at a time** or rely on **`docs/kafka/KRAFT_THREE_BROKER_TLS.md`** for the supported KRaft + TLS layout.
