# OCH platform reuse — preflight, KRaft Kafka (3 brokers), certs, alignment, Caddy

**Purpose:** Ship **everything outside the OCH repo** needed to reuse the **Colima/k3s + MetalLB + KRaft Kafka + strict TLS + preflight + alignment suite + Playwright preflight** workflow on **Record Platform** or another fork.

## What is inside

| Path | Role |
|------|------|
| **`scripts/`** | Full tree (~25 MB): **`run-preflight-scale-and-all-suites.sh`**, **`run-playwright-e2e-preflight.sh`** → **`webapp-playwright-strict-edge.sh`**, **`tests/kafka-alignment-suite.sh`**, cert helpers (**`dev-generate-certs.sh`**, **`kafka-ssl-from-dev-root.sh`**, **`reissue-ca-and-leaf-load-all-services.sh`**, …), **`verify-kafka-cluster.sh`**, **`kafka-runtime-sync.sh`**, **`kafka-sync-metallb.sh`**, k6/load, CI helpers, **`vendor/`** used by some tooling. |
| **`infra/k8s/`** | **KRaft + MetalLB 3-broker** bundle **`kafka-kraft-metallb/`**, **`kafka-certs/`** (cert-manager CRDs + TLS preflight Job), **`kafka-ops/`** (alignment CronJob, etc.), **MetalLB**, **Caddy** Deployments/Services/ConfigMaps, **`base/`** housing stack, **`overlays/`**, ingress/envoy refs. |
| **`docker/caddy-with-tcpdump/`** | Multi-stage **xcaddy** build + runtime **Alpine** with **tcpdump** + **tshark**. |
| **`Caddyfile`** | Reference edge config (paths in cluster use ConfigMaps in `infra/k8s/`). |
| **`certs/README.txt`** | Placeholder — **do not commit keys**; generate under `certs/` at repo root (see continuation doc). |
| **`proto/events/`** + **`proto/common.proto`** | Topic/proto alignment used by Kafka scripts (`verify-proto-*`, `create-kafka-event-topics-k8s.sh`). |
| **`Makefile`** | Targets such as **`kafka-sync-metallb`**, **`kafka-runtime-sync`**, **`kafka-alignment-suite`**, **`apply-kafka-kraft`**, etc. |
| **`package.json`** | Root **`pnpm verify:*`** scripts preflight and CI call (kafka bootstrap, TLS SANs, cluster checks). |
| **`pnpm-workspace.yaml`** | OCH layout — merge into your monorepo if you keep `tools/` + `services/` for those scripts. |

## Read next

1. **[PLATFORM_REUSE_AND_PREFLIGHT.md](./PLATFORM_REUSE_AND_PREFLIGHT.md)** — order of operations: cluster, certs, `kubectl apply -k infra/k8s/kafka-kraft-metallb`, topics, alignment suite, preflight env flags.  
2. **[CADDY_IMAGE_XCADDY_TCPDUMP_TSHARK.md](./CADDY_IMAGE_XCADDY_TCPDUMP_TSHARK.md)** — image layers: **xcaddy** builder, runtime **tcpdump** + **tshark**, rebuild/push/import.

## Quick pointers

- **Alignment suite (default mutating):**  
  `HOUSING_NS=record-platform ./scripts/tests/kafka-alignment-suite.sh`  
  Safe slice: `KAFKA_ALIGNMENT_TEST_MODE=0 …`. Skip in preflight: `PREFLIGHT_SKIP_KAFKA_ALIGNMENT_SUITE=1`.
- **Full preflight:**  
  `./scripts/run-preflight-scale-and-all-suites.sh`  
  (expects Node/pnpm, cluster, and local **`certs/dev-root.pem`** — see continuation doc.)
- **Playwright preflight only:**  
  `./scripts/run-playwright-e2e-preflight.sh`  
  (needs **webapp** + `pnpm install` in a full app checkout; pair this tarball with the **Vitest/Playwright** reference tarball if you split them.)

## Not included

- **`certs/*.pem` / `*.key` / JKS** — generate locally; never commit secrets.
- **`webapp/`**, **`services/`** — use your application tarball or main repo clone for E2E and Vitest.
- **Running cluster / container images** — you still build/import images (e.g. `caddy-with-tcpdump:dev`).

## License

Follow **Off-Campus-Housing-Tracker** upstream license.
