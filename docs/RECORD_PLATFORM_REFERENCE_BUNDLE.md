# Vitest / Playwright / event-layer / Kafka reference bundle

Full snapshot tarball (not committed to git) for continuing work offline or in a clean directory.

**See also:** **`docs/COMMAND_CENTER.md`** (all reference tarballs, ports, smoke). **Preflight/Kafka/Caddy** bundle docs are vendored under **`docs/bundles/preflight-kafka-caddy-20260409/`**.

## Artifact

| Field | Value |
|--------|--------|
| Path | `/Users/tom/record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409.tar.gz` |
| Size | ~120 MB compressed |
| SHA-256 | `362e531762ea6d44c723d7f01bad9a688a3c2096bd9999a333f0f2bfbc50a6a4` |

Verify before extract:

```bash
shasum -a 256 /Users/tom/record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409.tar.gz
```

## Extract

```bash
tar xzf /Users/tom/record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409.tar.gz
cd record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409
```

Read **`README-BUNDLE.md`** inside the archive first, then **`RECORD_PLATFORM_CONTINUATION.md`**, **`ANALYTICS_AND_OLLAMA.md`**.

```bash
pnpm install
```

**Note:** `certs/dev-root.pem` is not shipped; generate or copy from a trusted dev CA before strict-edge Playwright (see bundle README).

## Merge into this repo

To bring pieces into **`/Users/tom/record-platform`** (canonical tree), use selective `rsync` or manual copy of `services/`, `webapp/`, `tests/`, `proto/`, `scripts/`, etc., then run `pnpm install` at the repo root and fix any conflicts. Prefer git branches for large merges.

## Edge hostname (this repo)

Development HTTPS / Playwright / k6 use **`https://record.test`** with **`record.test` → MetalLB IP** in `/etc/hosts` (not `*.local`, to avoid mDNS; not `127.0.0.1` for the real edge). See `scripts/ensure-edge-hosts.sh` and `scripts/lib/edge-test-url.sh`.
