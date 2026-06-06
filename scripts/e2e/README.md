# End-to-end (Playwright + HTTP matrix)

## Layout

| Path | Role |
|------|------|
| **`scripts/e2e/`** | Entrypoints that invoke **webapp** Playwright specs and document env vars. |
| **`scripts/tls/`** | TLS / CA / Kafka JKS staged verify (`record-platform-tls-three-stage-verify.sh`). |
| **`scripts/tests/`** | Bash integration suites (e.g. Kafka alignment). |
| **`webapp/e2e/`** | Browser specs (`@playwright/test`). |

## Playwright (service / edge health)

From repo root (requires devDependencies installed under `webapp/`):

```bash
./scripts/e2e/run-playwright-all.sh
```

Env:

- **`E2E_API_BASE`** — default `https://record.test` (SNI / TLS edge; see `docs/COMMAND_CENTER.md`).
- **`E2E_EXTRA_URLS`** — optional comma-separated absolute URLs (e.g. internal gateway smoke).

Install browsers once:

```bash
pnpm -C webapp exec playwright install
```

## Preflight

Full stack gate including Kafka **3-broker** DNS, listener exec probes, and optional TLS matrix:

```bash
METALLB_ENABLED=1 ./scripts/run-preflight-scale-and-all-suites.sh
# Optional deep TLS stages (can overlap 3b kafka-ssl — use SKIP flags):
# PREFLIGHT_TLS_THREE_STAGE=1 PREFLIGHT_TLS_THREE_STAGE_SKIP_STAGE2=1 ...
```

See **`docs/bundles/kafka-ops-certs-alignment-20260410/RECORD_PLATFORM_PREFLIGHT_KAFKA_OPS_SETUP.md`**.
