# Phase 32D — Controlled Timing Attribution Micro-Soak

```text
Phase 32D: PASS
Matrix: 3888/3888
17-minute outlier reproduced: NO
Max wall latency: HTTP/1.1 9315ms, HTTP/2 7809ms, HTTP/3 9245ms
Attribution: window_reset_ms dominant component in micro-soak (not outlier tier)
Production enablement: NOT APPROVED
```

## 32D-0 — app timing exposure

Patched `POST /api/ai/rag/query` to inject redacted timing into `details`:

- `rag_total_ms`
- `server_total_ms`
- `retrieval_total_ms` (when hybrid/keyword latencies available)
- `kpi_query_write_ms` (server-side emit duration)

No raw prompt, response body, JWT, or private fields.

## Run

```bash
# deploy patched python-ai-service first
OUT=/tmp/phase32d-timing-attribution-micro-soak
node scripts/phase32d-controlled-timing-micro-soak-runner.mjs --out "$OUT"
bash scripts/phase32d-monitor-timing-micro-soak.sh "$OUT"
```

## Verify

```bash
make ai-platform-verify-phase32d-timing-micro-soak
node scripts/phase32d-summarize-timing-attribution.mjs --in /tmp/phase32d-timing-attribution-micro-soak --require-pass
```

## PASS gates

```text
3888/3888 matrix PASS
H1/H2/H3: 1296 each
Fallback=0, wrong protocol=0, wrong gate=0
Response/sentiment/red-team=100%, leakage=0
timing.wall_total_ms: 100%
timing.curl_time_total_ms: 100%
timing.rag_total_ms: 100% (else BLOCKED for app timing exposure)
timing.unattributed_ms: 100%
```

## Artifacts (/tmp only)

```text
phase32d-summary.json
phase32d-latency-by-protocol.json
phase32d-latency-by-case.json
phase32d-latency-by-timing-component.json
phase32d-outliers-top50.json
phase32d-attribution-verdict.json
```
