# Scripts layout (by function)

| Directory / prefix | Purpose |
|--------------------|---------|
| **`scripts/e2e/`** | Playwright orchestration (`run-playwright-all.sh`) — see **`scripts/e2e/README.md`**. |
| **`scripts/tls/`** | Staged TLS / Kafka JKS verification (`record-platform-tls-three-stage-verify.sh`). |
| **`scripts/tests/`** | Bash suites (Kafka alignment, integration). |
| **`scripts/lib/`** | Shared shell helpers (Kafka topics from proto, etc.). |
| **`scripts/outbox/`** | *(reserved)* operational wrappers; library code lives in **`@common/utils/outbox`**. |
| **`scripts/ci/`**, **`scripts/perf/`**, **`scripts/load/`** | CI, profiling, k6 / load. |

Top-level **`run-preflight-scale-and-all-suites.sh`** composes Kafka (3-broker KRaft), DNS, listener probes, Vitest, k6, and optional Playwright.
