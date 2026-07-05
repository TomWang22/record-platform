# Phase 22E — protocol parity KPI and telemetry audit

**Status:** PASS  
**Validated:** 2026-07-05

---

## Verdict

```text
Phase 22E: PASS — KPI/telemetry audit for Phase 22C protocol-parity matrix
Live matrix: NOT RUN
KPI readiness: COMPLETE
```

---

## KPI summary (Phase 22C matrix)

Source: `bench_logs/ai-platform/phase22/phase22c-matrix-summary.json` (local, not committed)

| Metric | Value |
| ------ | ----- |
| Protocol matrix total | 7200/7200 |
| HTTP 200 | 7200/7200 |
| response_pass_rate | 1.0 |
| sentiment_pass_rate | 1.0 |
| red_team_safety_pass_rate | 1.0 |
| grounding_pass_rate | 1.0 |
| fallback_count | 0 |
| leakage_failures | 0 |
| keyword_default during matrix | 0 |

### Gate counts

```text
preview_opt_in: 6000
allowlist: 1200
```

### HTTP 200 by protocol

```text
h1-explicit: 2400
h2: 2400
h3: 2400
```

### Latency (rag_total_ms)

| Protocol | p50 | p95 | max |
| -------- | --- | --- | --- |
| h1-explicit | 127.0 | 475.1 | 5535.9 |
| h2 | 124.1 | 504.7 | 5523.9 |
| h3 | 124.6 | 708.9 | 6335.8 |

---

## KPI categories (readiness)

| Category | Phase 22C evidence |
| -------- | ------------------- |
| Recommendation usefulness over time | 100% rubric pass rate (response/sentiment/red-team) |
| Search/retrieval latency | Baseline captured per protocol and case |
| Ingestion pipeline success | Defined; instrumentation gaps documented in `PHASE_22_KPI_OBSERVABILITY_READINESS.md` |
| Data-to-searchable time | Defined; no invented data |
| Operational health | Archive PASS, env unchanged, 0 fallback, 0 leakage |

Summarizer: `scripts/summarize-phase22-ai-kpis-readonly.mjs`

---

## Evidence separation

Phase 22C **7200** probes are labeled protocol-parity matrix evidence. Phase 21 **57105** HTTP/1.1 cumulative matrix unchanged and not merged.

---

## Telemetry notes

No new telemetry WARNs introduced by Phase 22C runner. Matrix used read-only curl probes; no runtime/env/image changes.

OCH / Playwright C-suite: not re-run in Phase 22C scope (unchanged from Phase 21 closeout).
